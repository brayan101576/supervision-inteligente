"""Carga visitas de ejemplo para la demo, usando la API real (login incluido).

Uso (con el backend corriendo):
    .\\venv\\Scripts\\python.exe seed_demo.py
Toma como centro el punto de tu última visita, así que primero haz al menos una visita real.
"""
import json
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

API = "http://localhost:8000"
CENTRO_ID = "123e4567-e89b-12d3-a456-426614174000"
ACTIVIDADES = ["Limpieza de áreas comunes", "Recolección de residuos", "Desinfección"]


def llamar(ruta, cuerpo=None, token=None):
    req = urllib.request.Request(
        API + ruta,
        data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def main():
    coord = llamar("/api/login-coordinador", {"usuario": "coordinador", "pin": "coord123"})["token"]
    existentes = llamar("/api/visitas", token=coord)
    base = next((v for v in existentes if v["lat"] is not None), None)
    if not base:
        raise SystemExit("Haz primero una visita real desde el celular para fijar el centro.")
    lat0, lon0 = base["lat"], base["lon"]

    tokens = {
        "brayan": llamar("/api/login", {"usuario": "brayan", "pin": "1234"})["token"],
        "maria": llamar("/api/login", {"usuario": "maria", "pin": "5678"})["token"],
    }
    ahora = datetime.now(timezone.utc)

    # (supervisor, horas atrás, estado, prioridad, observaciones, cumplidas, desplazamiento en grados)
    casos = [
        ("maria", 6, "Completado", None, "Todo en orden.", [1, 1, 1], 0.0002),
        ("brayan", 5, "Completado", None, "Se verificó el área de piscina.", [1, 1, 0], -0.0003),
        ("maria", 4, "Novedad", "Alta", "Fuga de agua en el baño del piso 2.", [1, 0, 1], 0.0001),
        ("brayan", 3, "Novedad", "Media", "Falta dotación de insumos de aseo.", [0, 1, 1], 0.0004),
        ("maria", 2, "Completado", None, "Sin observaciones.", [1, 1, 1], -0.0001),
        ("brayan", 1, "Completado", None, "Visita a un centro lejano (posible fraude).", [1, 1, 1], 0.02),  # fuera de rango
    ]
    for sup, horas, estado, prioridad, obs, cumpl, dlat in casos:
        llegada = ahora - timedelta(hours=horas)
        llamar("/api/sync-visitas", {
            "id": str(uuid.uuid4()),
            "centro_costo_id": CENTRO_ID,
            "id_supervisor": sup,
            "estado": estado,
            "observaciones": obs,
            "latitud": lat0 + dlat,
            "longitud": lon0,
            "fecha": llegada.isoformat(),
            "fecha_salida": (llegada + timedelta(minutes=25)).isoformat(),
            "actividades": json.dumps([{"nombre": n, "cumplida": bool(c)} for n, c in zip(ACTIVIDADES, cumpl)]),
            "prioridad": prioridad,
        }, token=tokens[sup])
        print(f"OK  {sup:7} {estado:10} hace {horas}h")
    print("Listo. Recarga el panel.")


if __name__ == "__main__":
    main()
