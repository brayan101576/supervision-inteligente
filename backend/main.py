import base64
import csv
import io
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID
from typing import List
from fastapi import FastAPI, Depends, Header, HTTPException, Query, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from geoalchemy2.elements import WKTElement
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from database import SessionLocal
import models
from marca_agua import estampar, formatear_fecha
import schemas

app = FastAPI(title="API Supervisión Inteligente")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CENTRO_DEMO_ID = "123e4567-e89b-12d3-a456-426614174000"
RADIO_MAXIMO_M = float(os.getenv("RADIO_MAXIMO_M", "150"))

# Solo para el hackathon: en producción irían en la base de datos con hash.
USUARIOS = {
    "brayan": "1234",
    "maria": "5678",
}
COORDINADORES = {
    "coordinador": "coord123",
}
SECRETO = os.getenv("TOKEN_SECRET", "cambiar-en-produccion").encode()


def _firmar(usuario: str) -> str:
    return hmac.new(SECRETO, usuario.encode(), hashlib.sha256).hexdigest()


def get_usuario(authorization: str = Header(default="")) -> str:
    try:
        usuario, firma = authorization.removeprefix("Bearer ").split(".", 1)
        if usuario in USUARIOS and hmac.compare_digest(firma, _firmar(usuario)):
            return usuario
    except ValueError:
        pass
    raise HTTPException(status_code=401, detail="No autenticado")


@app.post("/api/login")
def login(datos: schemas.LoginIn):
    if USUARIOS.get(datos.usuario) != datos.pin:
        raise HTTPException(status_code=401, detail="Usuario o PIN incorrecto")
    return {"token": f"{datos.usuario}.{_firmar(datos.usuario)}", "usuario": datos.usuario}



@app.on_event("startup")
def sembrar_centro_demo():
    db = SessionLocal()
    try:
        if not db.get(models.CentroCosto, CENTRO_DEMO_ID):
            db.add(models.CentroCosto(
                id=CENTRO_DEMO_ID,
                nombre="Centro Principal",
                ubicacion=WKTElement("POINT(-74.8070 11.0041)", srid=4326),
            ))
            db.commit()
        # Centros de ejemplo cercanos al principal, para tener varios en la demo
        if db.query(models.CentroCosto).count() < 3:
            for nombre, dlat, dlon in (("Edificio Torre Norte", 0.004, 0.002), ("Conjunto Villa Real", -0.003, 0.004)):
                db.execute(text(
                    "INSERT INTO centros_costo (id, nombre, ubicacion) "
                    "SELECT gen_random_uuid(), :n, ST_Translate(ubicacion, :dx, :dy) FROM centros_costo WHERE id = :c"
                ), {"n": nombre, "dx": dlon, "dy": dlat, "c": CENTRO_DEMO_ID})
            db.commit()
    finally:
        db.close()


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        texto = json.dumps(message, default=str)
        for connection in list(self.active_connections):
            try:
                await connection.send_text(texto)
            except Exception:
                self.disconnect(connection)


manager = ConnectionManager()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _utc(dt):
    if dt is None:
        return None
    if dt.tzinfo:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _guardar_visita(db: Session, visita: schemas.VisitaSync):
    punto = WKTElement(f"POINT({visita.longitud} {visita.latitud})", srid=4326)
    distancia = db.query(
        func.ST_DistanceSphere(models.CentroCosto.ubicacion, punto)
    ).filter(models.CentroCosto.id == visita.centro_costo_id).scalar()
    fuera = distancia is not None and distancia > RADIO_MAXIMO_M
    evidencia = visita.evidencia
    if evidencia:
        centro = db.get(models.CentroCosto, visita.centro_costo_id)
        dist_txt = f"a {round(distancia)} m del centro" if distancia is not None else "distancia desconocida"
        try:
            evidencia = estampar(evidencia, [
                f"{visita.id_supervisor}  |  {formatear_fecha(visita.fecha_foto or visita.fecha_salida)}",
                f"GPS {visita.latitud:.5f}, {visita.longitud:.5f}  |  {centro.nombre if centro else 'Centro'}  |  {dist_txt}",
            ])
        except Exception as e:  # una foto dañada no debe impedir guardar la visita
            print("No se pudo estampar la foto:", e)
    campos = dict(
        distancia_m=distancia,
        fuera_de_rango=fuera,
        estado=visita.estado,
        observaciones=visita.observaciones,
        ubicacion=punto,
        fecha_salida=_utc(visita.fecha_salida),
        actividades=visita.actividades,
        evidencia=evidencia,
        prioridad=visita.prioridad,
    )
    visita_db = db.get(models.VisitaSupervision, visita.id)
    if visita_db:
        for k, v in campos.items():
            setattr(visita_db, k, v)
    else:
        extra = {"fecha_llegada": _utc(visita.fecha)} if visita.fecha else {}
        db.add(models.VisitaSupervision(
            id=visita.id,
            centro_costo_id=visita.centro_costo_id,
            id_supervisor=visita.id_supervisor,
            **campos, **extra,
        ))
    if visita.asignacion_id:
        asig = db.get(models.Asignacion, visita.asignacion_id)
        if asig and asig.supervisor == visita.id_supervisor:
            asig.estado = "Realizada"
            asig.visita_id = visita.id
    db.commit()
    return distancia, fuera


@app.post("/api/sync-visitas")
async def sincronizar_visita(
    visita: schemas.VisitaSync,
    db: Session = Depends(get_db),
    usuario: str = Depends(get_usuario),
):
    visita.id_supervisor = usuario  # el servidor manda: no se confía en lo que diga el celular
    distancia, fuera = await run_in_threadpool(_guardar_visita, db, visita)

    await manager.broadcast({
        "tipo": "novedad" if visita.estado == "Novedad" else ("ubicacion" if fuera else "visita"),
        "fuera_de_rango": fuera,
        "distancia_m": round(distancia) if distancia is not None else None,
        "id": str(visita.id),
        "supervisor": visita.id_supervisor,
        "estado": visita.estado,
        "observaciones": visita.observaciones,
        "prioridad": visita.prioridad,
        "tiene_evidencia": bool(visita.evidencia),
        "lat": visita.latitud,
        "lon": visita.longitud,
    })
    return {"mensaje": "Sincronización exitosa", "id": str(visita.id)}


def _usuario_coordinador(credencial: str):
    try:
        usuario, firma = credencial.split(".", 1)
        if usuario in COORDINADORES and hmac.compare_digest(firma, _firmar("coord:" + usuario)):
            return usuario
    except ValueError:
        pass
    return None


def get_coordinador(authorization: str = Header(default=""), token: str = Query(default="")) -> str:
    """Acepta el token en el encabezado o en ?token= (las imágenes y descargas no pueden enviar encabezados)."""
    usuario = _usuario_coordinador(authorization.removeprefix("Bearer ") or token)
    if not usuario:
        raise HTTPException(status_code=401, detail="No autenticado")
    return usuario


@app.post("/api/login-coordinador")
def login_coordinador(datos: schemas.LoginIn):
    if COORDINADORES.get(datos.usuario) != datos.pin:
        raise HTTPException(status_code=401, detail="Usuario o clave incorrectos")
    return {"token": f"{datos.usuario}.{_firmar('coord:' + datos.usuario)}", "usuario": datos.usuario}


@app.get("/api/centros")
def listar_centros(db: Session = Depends(get_db), usuario: str = Depends(get_usuario)):
    filas = db.query(
        models.CentroCosto,
        func.ST_Y(models.CentroCosto.ubicacion),
        func.ST_X(models.CentroCosto.ubicacion),
    ).all()
    return [
        {"id": str(c.id), "nombre": c.nombre, "lat": lat, "lon": lon, "radio_m": RADIO_MAXIMO_M}
        for c, lat, lon in filas
    ]


@app.get("/api/visitas")
def listar_visitas(db: Session = Depends(get_db), coord: str = Depends(get_coordinador)):
    filas = db.query(
        models.VisitaSupervision,
        func.ST_Y(models.VisitaSupervision.ubicacion),
        func.ST_X(models.VisitaSupervision.ubicacion),
    ).order_by(models.VisitaSupervision.fecha_llegada.desc()).limit(200).all()
    return [
        {
            "id": str(v.id),
            "supervisor": v.id_supervisor,
            "estado": v.estado,
            "observaciones": v.observaciones,
            "prioridad": v.prioridad,
            "actividades": v.actividades,
            "tiene_evidencia": bool(v.evidencia),
            "fecha": v.fecha_llegada,
            "fecha_salida": v.fecha_salida,
            "cerrada": v.cerrada,
            "fuera_de_rango": v.fuera_de_rango,
            "distancia_m": round(v.distancia_m) if v.distancia_m is not None else None,
            "lat": lat,
            "lon": lon,
        }
        for v, lat, lon in filas
    ]


@app.get("/api/visitas/{visita_id}/evidencia")
def ver_evidencia(visita_id: UUID, db: Session = Depends(get_db), coord: str = Depends(get_coordinador)):
    v = db.get(models.VisitaSupervision, visita_id)
    if not v or not v.evidencia:
        raise HTTPException(status_code=404, detail="Sin evidencia")
    return Response(content=base64.b64decode(v.evidencia), media_type="image/jpeg")


def _cerrar(db: Session, visita_id):
    v = db.get(models.VisitaSupervision, visita_id)
    if not v:
        return False
    v.cerrada = True
    db.commit()
    return True


@app.patch("/api/visitas/{visita_id}/cerrar")
async def cerrar_novedad(visita_id: UUID, db: Session = Depends(get_db), coord: str = Depends(get_coordinador)):
    if not await run_in_threadpool(_cerrar, db, visita_id):
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    await manager.broadcast({"tipo": "cierre", "id": str(visita_id)})
    return {"mensaje": "Novedad cerrada"}


def _eliminar(db: Session, visita_id):
    v = db.get(models.VisitaSupervision, visita_id)
    if not v:
        return False
    db.delete(v)
    db.commit()
    return True


@app.delete("/api/visitas/{visita_id}")
async def eliminar_visita(visita_id: UUID, db: Session = Depends(get_db), coord: str = Depends(get_coordinador)):
    if not await run_in_threadpool(_eliminar, db, visita_id):
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    await manager.broadcast({"tipo": "eliminada", "id": str(visita_id)})
    return {"mensaje": "Visita eliminada"}


@app.get("/api/panel/centros")
def centros_panel(db: Session = Depends(get_db), coord: str = Depends(get_coordinador)):
    filas = db.query(
        models.CentroCosto,
        func.ST_Y(models.CentroCosto.ubicacion),
        func.ST_X(models.CentroCosto.ubicacion),
    ).order_by(models.CentroCosto.nombre).all()
    return [
        {"id": str(c.id), "nombre": c.nombre, "lat": lat, "lon": lon, "radio_m": RADIO_MAXIMO_M}
        for c, lat, lon in filas
    ]


@app.get("/api/panel/supervisores")
def supervisores_panel(coord: str = Depends(get_coordinador)):
    return sorted(USUARIOS.keys())


def _fila_asignacion(a: models.Asignacion, nombre_centro: str):
    ahora = datetime.utcnow()
    estado = a.estado
    if estado == "Pendiente" and a.programada < ahora:
        estado = "Vencida"
    return {
        "id": str(a.id),
        "centro_id": str(a.centro_costo_id),
        "centro": nombre_centro,
        "supervisor": a.supervisor,
        "programada": a.programada,
        "estado": estado,
    }


@app.get("/api/asignaciones")
def listar_asignaciones(db: Session = Depends(get_db), coord: str = Depends(get_coordinador)):
    filas = db.query(models.Asignacion, models.CentroCosto.nombre).join(
        models.CentroCosto, models.CentroCosto.id == models.Asignacion.centro_costo_id
    ).order_by(models.Asignacion.programada.desc()).limit(200).all()
    return [_fila_asignacion(a, n) for a, n in filas]


def _crear_asignacion(db: Session, datos: schemas.AsignacionIn):
    centro = db.get(models.CentroCosto, datos.centro_costo_id)
    if not centro:
        raise HTTPException(status_code=404, detail="Centro no encontrado")
    db.add(models.Asignacion(
        centro_costo_id=datos.centro_costo_id,
        supervisor=datos.supervisor,
        programada=_utc(datos.programada),
    ))
    db.commit()


@app.post("/api/asignaciones")
async def crear_asignacion(datos: schemas.AsignacionIn, db: Session = Depends(get_db), coord: str = Depends(get_coordinador)):
    if datos.supervisor not in USUARIOS:
        raise HTTPException(status_code=400, detail="Supervisor no válido")
    await run_in_threadpool(_crear_asignacion, db, datos)
    await manager.broadcast({"tipo": "asignacion"})
    return {"mensaje": "Visita asignada"}


def _borrar_asignacion(db: Session, asignacion_id):
    a = db.get(models.Asignacion, asignacion_id)
    if not a:
        return False
    db.delete(a)
    db.commit()
    return True


@app.delete("/api/asignaciones/{asignacion_id}")
async def cancelar_asignacion(asignacion_id: UUID, db: Session = Depends(get_db), coord: str = Depends(get_coordinador)):
    if not await run_in_threadpool(_borrar_asignacion, db, asignacion_id):
        raise HTTPException(status_code=404, detail="Asignación no encontrada")
    await manager.broadcast({"tipo": "asignacion"})
    return {"mensaje": "Asignación cancelada"}


@app.get("/api/mis-asignaciones")
def mis_asignaciones(db: Session = Depends(get_db), usuario: str = Depends(get_usuario)):
    """Visitas pendientes del supervisor que inició sesión (la app las guarda para usarlas sin internet)."""
    filas = db.query(models.Asignacion, models.CentroCosto.nombre).join(
        models.CentroCosto, models.CentroCosto.id == models.Asignacion.centro_costo_id
    ).filter(
        models.Asignacion.supervisor == usuario, models.Asignacion.estado == "Pendiente"
    ).order_by(models.Asignacion.programada).all()
    return [_fila_asignacion(a, n) for a, n in filas]


@app.get("/api/reporte.csv")
def reporte_csv(
    supervisor: Optional[str] = None,
    centro: Optional[str] = None,
    desde: Optional[str] = None,   # AAAA-MM-DD, hora de Colombia
    hasta: Optional[str] = None,
    db: Session = Depends(get_db),
    coord: str = Depends(get_coordinador),
):
    q = db.query(models.VisitaSupervision, models.CentroCosto.nombre).outerjoin(
        models.CentroCosto, models.CentroCosto.id == models.VisitaSupervision.centro_costo_id
    ).order_by(models.VisitaSupervision.fecha_llegada.desc())
    if supervisor:
        q = q.filter(models.VisitaSupervision.id_supervisor == supervisor)
    if centro:
        q = q.filter(models.VisitaSupervision.centro_costo_id == centro)
    try:
        # Las fechas llegan en hora de Colombia (UTC-5); en la base están en UTC
        if desde:
            q = q.filter(models.VisitaSupervision.fecha_llegada >= datetime.fromisoformat(desde) + timedelta(hours=5))
        if hasta:
            q = q.filter(models.VisitaSupervision.fecha_llegada < datetime.fromisoformat(hasta) + timedelta(days=1, hours=5))
    except ValueError:
        raise HTTPException(status_code=400, detail="Fecha inválida")
    salida = io.StringIO()
    w = csv.writer(salida, delimiter=";")
    w.writerow(["Fecha llegada (UTC)", "Fecha salida (UTC)", "Supervisor", "Centro de costo", "Estado", "Prioridad",
                "Actividades cumplidas", "Actividades totales", "Distancia al centro (m)",
                "Fuera de rango", "Novedad cerrada", "Con evidencia fotográfica", "Observaciones"])
    for v, nombre_centro in q.all():
        try:
            acts = json.loads(v.actividades) if v.actividades else []
        except ValueError:
            acts = []
        w.writerow([
            v.fecha_llegada, v.fecha_salida, v.id_supervisor, nombre_centro or "", v.estado, v.prioridad or "",
            sum(1 for a in acts if a.get("cumplida")), len(acts),
            round(v.distancia_m) if v.distancia_m is not None else "",
            "Sí" if v.fuera_de_rango else "No", "Sí" if v.cerrada else "No",
            "Sí" if v.evidencia else "No",
            (v.observaciones or "").replace(chr(10), " "),
        ])
    # BOM para que Excel respete las tildes
    return Response(
        content="﻿" + salida.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=reporte_supervision.csv"},
    )


@app.websocket("/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket):
    if not _usuario_coordinador(websocket.query_params.get("token", "")):
        await websocket.close(code=1008)
        return
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
