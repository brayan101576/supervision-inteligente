import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Tooltip } from 'react-leaflet';
import {
  ShieldAlert, Download, CheckCircle, Trash2, Radar, LogOut, ClipboardCheck, Siren,
  MapPinOff, ShieldCheck, Camera, MapPin, Zap, Image as ImagenIcono,
  CalendarClock, CalendarPlus, UserCheck, X,
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './panel.css';

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const CENTRO_MAPA = [11.0041, -74.8070];
const ORDEN_PRIORIDAD = { Alta: 0, Media: 1, Baja: 2 };

const COLOR = {
  verde: '#34d399',
  rojo: '#fb7185',
  ambar: '#fbbf24',
  cian: '#22d3ee',
  violeta: '#a78bfa',
};

const parseActividades = (txt) => {
  try { return txt ? JSON.parse(txt) : []; } catch { return []; }
};
// El servidor guarda las horas en UTC sin zona; se agrega la Z para mostrarlas en hora local.
const formatearFecha = (f) => (f ? new Date(f.endsWith('Z') ? f : f + 'Z').toLocaleString() : "—");
const inicial = (nombre) => (nombre || "?").charAt(0);
// ¿La fecha (UTC sin zona) ocurrió en las últimas N horas?
const esReciente = (f, horas) => !!f && Date.now() - new Date(f.endsWith('Z') ? f : f + 'Z').getTime() < horas * 3600 * 1000;
const COLOR_ESTADO_ASIGNACION = { Pendiente: '#22d3ee', Vencida: '#fb7185', Realizada: '#34d399' };

// ---------- Solo presentación ----------

// Color según el estado de la visita
const colorDeVisita = (v) => {
  if (v.estado === "Novedad" && !v.cerrada) return COLOR.rojo;
  if (v.fuera_de_rango) return COLOR.ambar;
  if (v.estado === "Novedad") return COLOR.cian;
  return COLOR.verde;
};
const colorDeAlerta = (a) => {
  if (a.estado === "Novedad") {
    if (a.prioridad === "Alta") return COLOR.rojo;
    if (a.prioridad === "Baja") return COLOR.cian;
  }
  return COLOR.ambar;
};

const iconos = {};
const iconoMarcador = (color, fuerte) => {
  const clave = color + (fuerte ? "f" : "");
  if (!iconos[clave]) {
    iconos[clave] = L.divIcon({
      className: "",
      html: `<div class="cm-pin ${fuerte ? "fuerte" : ""}" style="--c:${color}"><span class="onda"></span><span class="nucleo"></span></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      popupAnchor: [0, -10],
    });
  }
  return iconos[clave];
};

// Número que "corre" hasta su valor
function useNumeroAnimado(objetivo) {
  const [valor, setValor] = useState(0);
  const actual = useRef(0);
  useEffect(() => {
    const desde = actual.current;
    const t0 = performance.now();
    let cuadro;
    const paso = (t) => {
      const p = Math.min(1, (t - t0) / 900);
      const v = Math.round(desde + (objetivo - desde) * (1 - Math.pow(1 - p, 3)));
      actual.current = v;
      setValor(v);
      if (p < 1) cuadro = requestAnimationFrame(paso);
    };
    cuadro = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(cuadro);
  }, [objetivo]);
  return valor;
}

function Kpi({ titulo, valor, sufijo = "", color, Icono, anillo }) {
  const mostrado = useNumeroAnimado(valor);
  const circunferencia = 2 * Math.PI * 30;
  return (
    <div className="cm-vidrio cm-kpi" style={{ '--c': color }}>
      <div>
        <div className="cm-kpi-icono"><Icono size={20} /></div>
        <div className="cm-kpi-valor">{mostrado}{sufijo}</div>
        <div className="cm-kpi-titulo">{titulo}</div>
      </div>
      {anillo && (
        <svg className="cm-anillo" width="76" height="76" viewBox="0 0 76 76" style={{ '--c': color }}>
          <circle className="fondo" cx="38" cy="38" r="30" />
          <circle
            className="valor" cx="38" cy="38" r="30" transform="rotate(-90 38 38)"
            strokeDasharray={circunferencia}
            strokeDashoffset={circunferencia * (1 - Math.min(valor, 100) / 100)}
          />
        </svg>
      )}
    </div>
  );
}

function Reloj() {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="cm-reloj">
      <b>{ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</b>
      <span>{ahora.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
    </div>
  );
}

// ---------- Panel del coordinador ----------

function Panel({ token, usuario, onSalir }) {
  const [visitas, setVisitas] = useState([]);
  const [conectado, setConectado] = useState(false);
  const [filtroSupervisor, setFiltroSupervisor] = useState("");
  const [centros, setCentros] = useState([]);
  const [supervisoresLista, setSupervisoresLista] = useState([]);
  const [asignaciones, setAsignaciones] = useState([]);
  const [filtroCentro, setFiltroCentro] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [nueva, setNueva] = useState({ supervisor: "", centro: "", cuando: "" });
  const [errorAsignar, setErrorAsignar] = useState("");

  const auth = { Authorization: `Bearer ${token}` };

  const cargar = useCallback(() => {
    const cab = { headers: { Authorization: `Bearer ${token}` } };
    fetch(`${API}/api/visitas`, cab)
      .then((r) => {
        if (r.status === 401) { onSalir(); return null; }
        return r.json();
      })
      .then((datos) => datos && setVisitas(datos))
      .catch(() => {});
    fetch(`${API}/api/asignaciones`, cab).then((r) => r.ok ? r.json() : []).then(setAsignaciones).catch(() => {});
    fetch(`${API}/api/panel/centros`, cab).then((r) => r.ok ? r.json() : []).then(setCentros).catch(() => {});
    fetch(`${API}/api/panel/supervisores`, cab).then((r) => r.ok ? r.json() : []).then(setSupervisoresLista).catch(() => {});
  }, [token, onSalir]);

  const asignarVisita = async (e) => {
    e.preventDefault();
    setErrorAsignar("");
    const res = await fetch(`${API}/api/asignaciones`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supervisor: nueva.supervisor,
        centro_costo_id: nueva.centro,
        programada: new Date(nueva.cuando).toISOString(),
      }),
    });
    if (!res.ok) { setErrorAsignar("No se pudo asignar la visita."); return; }
    setNueva({ supervisor: "", centro: "", cuando: "" });
    cargar();
  };

  const cancelarAsignacion = async (id) => {
    await fetch(`${API}/api/asignaciones/${id}`, { method: 'DELETE', headers: auth });
    cargar();
  };

  useEffect(() => {
    cargar();
    const ws = new WebSocket(`${API.replace(/^http/, "ws")}/ws/dashboard?token=${encodeURIComponent(token)}`);
    ws.onopen = () => setConectado(true);
    ws.onclose = () => setConectado(false);
    ws.onmessage = () => cargar(); // cualquier evento: se recarga la lista completa
    return () => ws.close();
  }, [cargar, token]);

  const cerrarNovedad = async (id) => {
    await fetch(`${API}/api/visitas/${id}/cerrar`, { method: 'PATCH', headers: auth });
    cargar();
  };

  const eliminarVisita = async (v) => {
    const detalle = `${v.supervisor} — ${formatearFecha(v.fecha)}`;
    if (!window.confirm(`¿Eliminar definitivamente esta visita?

${detalle}

Esta acción no se puede deshacer.`)) return;
    await fetch(`${API}/api/visitas/${v.id}`, { method: 'DELETE', headers: auth });
    cargar();
  };

  const supervisores = [...new Set(visitas.map((v) => v.supervisor))];
  const visibles = visitas.filter((v) => !filtroSupervisor || v.supervisor === filtroSupervisor);

  const alertas = visitas
    .filter((v) => (v.estado === "Novedad" || v.fuera_de_rango) && !v.cerrada)
    .sort((a, b) => (ORDEN_PRIORIDAD[a.prioridad] ?? 3) - (ORDEN_PRIORIDAD[b.prioridad] ?? 3));

  const actividades = visitas.flatMap((v) => parseActividades(v.actividades));
  const cumplimiento = actividades.length
    ? Math.round((actividades.filter((a) => a.cumplida).length / actividades.length) * 100)
    : 0;

  const fueraDeRango = visitas.filter((v) => v.fuera_de_rango).length;
  const pendientes = asignaciones.filter((a) => a.estado !== "Realizada");
  const supervisoresActivos = new Set(visitas.filter((v) => esReciente(v.fecha, 12)).map((v) => v.supervisor)).size;
  const supervisoresAsignados = new Set(pendientes.map((a) => a.supervisor)).size;
  const urlEvidencia = (id) => `${API}/api/visitas/${id}/evidencia?token=${encodeURIComponent(token)}`;

  return (
    <div className="cm-app">
      <header className="cm-vidrio cm-header">
        <div className="cm-marca">
          <div className="cm-logo"><Radar size={26} /></div>
          <div>
            <h1 className="cm-titulo">SUPERVISIÓN INTELIGENTE</h1>
            <p className="cm-subtitulo">Centro de mando · Operaciones en campo</p>
          </div>
        </div>
        <div className="cm-derecha">
          <Reloj />
          <div className={`cm-vivo ${conectado ? "" : "off"}`}>
            <span className="cm-punto" />
            {conectado ? "EN VIVO" : "SIN CONEXIÓN"}
          </div>
          <div className="cm-usuario">
            <div className="cm-avatar">{inicial(usuario)}</div>
            <span>{usuario}</span>
            <button className="cm-btn-salir" onClick={onSalir}><LogOut size={14} /> Salir</button>
          </div>
        </div>
      </header>

      <section className="cm-kpis">
        <Kpi titulo="Visitas realizadas" valor={visitas.length} color={COLOR.cian} Icono={ClipboardCheck} />
        <Kpi titulo="Visitas pendientes" valor={pendientes.length} color={COLOR.violeta} Icono={CalendarClock} />
        <Kpi titulo="Supervisores activos (12 h)" valor={supervisoresActivos} color={COLOR.verde} Icono={UserCheck} />
        <Kpi titulo="Novedades abiertas" valor={alertas.length} color={COLOR.rojo} Icono={Siren} />
        <Kpi titulo="Fuera de rango" valor={fueraDeRango} color={COLOR.ambar} Icono={MapPinOff} />
        <Kpi titulo="Cumplimiento de actividades" valor={cumplimiento} sufijo="%" color={COLOR.verde} Icono={ShieldCheck} anillo />
      </section>

      <section className="cm-grid">
        <div className="cm-vidrio cm-mapa">
          <div className="cm-mapa-etiqueta"><MapPin size={13} color={COLOR.cian} /> Mapa operativo</div>
          <div className="cm-leyenda">
            <span><i style={{ background: COLOR.verde }} />Visita completada</span>
            <span><i style={{ background: COLOR.rojo }} />Novedad abierta</span>
            <span><i style={{ background: COLOR.ambar }} />Fuera de rango</span>
            <span><i style={{ background: COLOR.cian }} />Novedad cerrada</span>
          </div>
          <MapContainer center={CENTRO_MAPA} zoom={13} style={{ width: '100%', height: '100%' }}>
            <TileLayer
              attribution="Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
              maxZoom={16}
            />
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
              maxZoom={16}
            />
            {centros.map((c) => (
              <Circle
                key={c.id}
                center={[c.lat, c.lon]}
                radius={c.radio_m}
                pathOptions={{ color: COLOR.cian, weight: 1.5, dashArray: '5 6', fillColor: COLOR.cian, fillOpacity: 0.07 }}
              >
                <Tooltip sticky>{c.nombre} · radio {c.radio_m} m</Tooltip>
              </Circle>
            ))}
            {[...visitas].filter((v) => v.lat != null).reverse().map((v, i) => {
              const color = colorDeVisita(v);
              return (
                <Marker
                  key={v.id}
                  position={[v.lat, v.lon]}
                  zIndexOffset={i}
                  icon={iconoMarcador(color, v.estado === "Novedad" && !v.cerrada)}
                >
                  <Popup minWidth={230}>
                    <div className="cm-pop-nombre">{v.supervisor}</div>
                    <span className="cm-chip cm-pop-estado" style={{ '--c': color }}>
                      {v.estado}{v.prioridad ? ` · prioridad ${v.prioridad}` : ""}
                    </span>
                    {v.fuera_de_rango && (
                      <div className="cm-pop-alerta">🚨 FUERA DE RANGO: a {v.distancia_m} m del centro</div>
                    )}
                    {v.observaciones && <div className="cm-pop-obs">“{v.observaciones}”</div>}
                    {parseActividades(v.actividades).map((a) => (
                      <div className="cm-pop-act" key={a.nombre}>{a.cumplida ? "✅" : "❌"} {a.nombre}</div>
                    ))}
                    {v.tiene_evidencia && (
                      <img className="cm-pop-foto" src={urlEvidencia(v.id)} alt="evidencia" />
                    )}
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>

        <div className="cm-vidrio cm-feed">
          <div className="cm-feed-cab">
            <Zap size={20} color={COLOR.ambar} />
            <h2>Novedades y alertas</h2>
            <span className={`cm-contador ${alertas.length === 0 ? "cero" : ""}`}>{alertas.length}</span>
          </div>
          <div className="cm-feed-lista">
            {alertas.length === 0 ? (
              <div className="cm-vacio">
                <div className="cm-vacio-icono"><ShieldCheck size={34} /></div>
                Sin novedades abiertas.<br />Todo bajo control.
              </div>
            ) : (
              alertas.map((a) => {
                const color = colorDeAlerta(a);
                return (
                  <div
                    key={a.id}
                    className={`cm-alerta ${a.estado === "Novedad" && a.prioridad === "Alta" ? "alta" : ""}`}
                    style={{ '--c': color }}
                  >
                    <div className="cm-alerta-icono">
                      {a.estado === "Novedad" ? <ShieldAlert size={18} /> : <MapPinOff size={18} />}
                    </div>
                    <div className="cm-alerta-cuerpo">
                      <div className="cm-alerta-nombre">
                        {a.supervisor}
                        {a.estado === "Novedad" && (
                          <span className="cm-chip" style={{ '--c': color }}>{a.prioridad || "Media"}</span>
                        )}
                      </div>
                      {a.fuera_de_rango && (
                        <div className="cm-alerta-linea" style={{ color: COLOR.ambar }}>🚨 Fuera de rango ({a.distancia_m} m)</div>
                      )}
                      {a.observaciones && <div className="cm-alerta-linea">{a.observaciones}</div>}
                      <div className="cm-alerta-linea">{formatearFecha(a.fecha)}</div>
                    </div>
                    <button className="cm-btn-cerrar" onClick={() => cerrarNovedad(a.id)}>
                      <CheckCircle size={14} /> Cerrar
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      <section className="cm-vidrio cm-historial">
        <div className="cm-historial-cab">
          <h2><CalendarClock size={18} /> Programación de visitas</h2>
          <span className="cm-nota">{supervisoresAsignados} supervisor(es) con visitas asignadas · {pendientes.length} pendiente(s)</span>
        </div>
        <form className="cm-asignar" onSubmit={asignarVisita}>
          <select className="cm-select" required value={nueva.supervisor} onChange={(e) => setNueva({ ...nueva, supervisor: e.target.value })}>
            <option value="">Supervisor…</option>
            {supervisoresLista.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="cm-select" required value={nueva.centro} onChange={(e) => setNueva({ ...nueva, centro: e.target.value })}>
            <option value="">Centro de costo…</option>
            {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <input className="cm-select" type="datetime-local" required value={nueva.cuando} onChange={(e) => setNueva({ ...nueva, cuando: e.target.value })} />
          <button className="cm-btn-descarga cm-btn-plano"><CalendarPlus size={16} /> Asignar visita</button>
        </form>
        {errorAsignar && <div className="cm-login-error">{errorAsignar}</div>}
        <div className="cm-asignaciones">
          {asignaciones.length === 0 && <div className="cm-nota">Aún no hay visitas programadas.</div>}
          {asignaciones.map((a) => (
            <div key={a.id} className="cm-asignacion" style={{ '--c': COLOR_ESTADO_ASIGNACION[a.estado] }}>
              <div className="cm-avatar">{inicial(a.supervisor)}</div>
              <div className="cm-asignacion-texto">
                <b>{a.supervisor}</b> → {a.centro}
                <span>{formatearFecha(a.programada)}</span>
              </div>
              <span className="cm-chip" style={{ '--c': COLOR_ESTADO_ASIGNACION[a.estado] }}>{a.estado}</span>
              {a.estado !== "Realizada" && (
                <button className="cm-btn-eliminar" title="Cancelar asignación" onClick={() => cancelarAsignacion(a.id)}><X size={15} /></button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="cm-vidrio cm-historial" style={{ marginTop: 18 }}>
        <div className="cm-historial-cab">
          <div>
            <h2>Historial de visitas</h2>
            <span className="cm-nota">Los filtros de centro y fechas se aplican al reporte descargado.</span>
          </div>
          <div className="cm-controles">
            <select className="cm-select" value={filtroSupervisor} onChange={(e) => setFiltroSupervisor(e.target.value)}>
              <option value="">Todos los supervisores</option>
              {supervisores.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="cm-select" value={filtroCentro} onChange={(e) => setFiltroCentro(e.target.value)}>
              <option value="">Todos los centros</option>
              {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <input className="cm-select" type="date" title="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
            <input className="cm-select" type="date" title="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            <a
              className="cm-btn-descarga"
              href={`${API}/api/reporte.csv?token=${encodeURIComponent(token)}${filtroSupervisor ? `&supervisor=${encodeURIComponent(filtroSupervisor)}` : ""}${filtroCentro ? `&centro=${filtroCentro}` : ""}${desde ? `&desde=${desde}` : ""}${hasta ? `&hasta=${hasta}` : ""}`}
            >
              <Download size={16} /> Descargar reporte
            </a>
          </div>
        </div>
        <div className="cm-tabla-wrap">
          <table className="cm-tabla">
            <thead>
              <tr>
                {["Llegada", "Salida", "Supervisor", "Estado", "Actividades", "Distancia", "Evidencia", ""].map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.map((v, i) => {
                const acts = parseActividades(v.actividades);
                const cumplidas = acts.filter((a) => a.cumplida).length;
                const pct = acts.length ? (cumplidas / acts.length) * 100 : 0;
                const colorActs = pct === 100 ? COLOR.verde : pct >= 50 ? COLOR.ambar : COLOR.rojo;
                return (
                  <tr key={v.id} style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                    <td>{formatearFecha(v.fecha)}</td>
                    <td>{formatearFecha(v.fecha_salida)}</td>
                    <td>
                      <div className="cm-sup">
                        <div className="cm-avatar">{inicial(v.supervisor)}</div>
                        {v.supervisor}
                      </div>
                    </td>
                    <td>
                      <span className="cm-chip" style={{ '--c': colorDeVisita(v) }}>
                        {v.estado}{v.estado === "Novedad" && (v.cerrada ? " (cerrada)" : " (abierta)")}
                      </span>
                    </td>
                    <td>
                      {acts.length ? (
                        <>
                          <span className="cm-barra" style={{ '--c': colorActs }}><i style={{ width: `${pct}%` }} /></span>
                          {cumplidas}/{acts.length}
                        </>
                      ) : "—"}
                    </td>
                    <td style={{ color: v.fuera_de_rango ? COLOR.ambar : undefined, fontWeight: v.fuera_de_rango ? 700 : 400 }}>
                      {v.distancia_m != null ? `${v.distancia_m} m${v.fuera_de_rango ? " 🚨" : ""}` : "—"}
                    </td>
                    <td>
                      {v.tiene_evidencia
                        ? <a className="cm-enlace" href={urlEvidencia(v.id)} target="_blank" rel="noreferrer"><ImagenIcono size={14} /> Ver foto</a>
                        : "—"}
                    </td>
                    <td>
                      <button className="cm-btn-eliminar" title="Eliminar visita" onClick={() => eliminarVisita(v)}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------- Inicio de sesión ----------

const CLAVE_SESION = "sesion_coordinador";

function Login({ onEntrar }) {
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/login-coordinador`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: usuario.trim().toLowerCase(), pin: clave }),
      });
      if (!res.ok) {
        setError("Usuario o clave incorrectos.");
      } else {
        onEntrar(await res.json());
      }
    } catch {
      setError("No se pudo conectar con el servidor.");
    }
    setEnviando(false);
  };

  return (
    <div className="cm-login">
      <div className="cm-login-izq">
        <div className="cm-radar">
          <span /><span /><span /><span />
          <i style={{ left: '38%', top: '30%' }} />
          <i style={{ left: '62%', top: '52%', animationDelay: '.7s' }} />
          <i style={{ left: '30%', top: '64%', animationDelay: '1.3s', background: COLOR.ambar }} />
        </div>
        <div className="cm-logo"><Radar size={26} /></div>
        <h1>Cada visita,<br /><em>verificada.</em></h1>
        <p>Control en tiempo real de supervisores en campo: ubicación, evidencia y novedades en una sola pantalla.</p>
        <div className="cm-login-puntos">
          <div><MapPin size={18} /> Validación de ubicación por GPS</div>
          <div><Camera size={18} /> Evidencia fotográfica con marca de agua</div>
          <div><Zap size={18} /> Alertas instantáneas, incluso con operación sin conexión</div>
        </div>
      </div>

      <div className="cm-login-der">
        <form className="cm-vidrio cm-login-form" onSubmit={enviar}>
          <h2>Bienvenido</h2>
          <p>Ingresa al panel del coordinador de operaciones</p>
          <label className="cm-campo">
            <span>Usuario</span>
            <input autoFocus value={usuario} onChange={(e) => setUsuario(e.target.value)} />
          </label>
          <label className="cm-campo">
            <span>Clave</span>
            <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} />
          </label>
          {error && <div className="cm-login-error">{error}</div>}
          <button className="cm-login-boton" disabled={enviando || !usuario || !clave}>
            {enviando ? "Entrando..." : "Iniciar sesión"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [sesion, setSesion] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(CLAVE_SESION)); } catch { return null; }
  });

  const entrar = (datos) => {
    try { sessionStorage.setItem(CLAVE_SESION, JSON.stringify(datos)); } catch { /* sin almacenamiento */ }
    setSesion(datos);
  };
  const salir = useCallback(() => {
    try { sessionStorage.removeItem(CLAVE_SESION); } catch { /* sin almacenamiento */ }
    setSesion(null);
  }, []);

  return sesion
    ? <Panel token={sesion.token} usuario={sesion.usuario} onSalir={salir} />
    : <Login onEntrar={entrar} />;
}
