import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Tooltip } from 'react-leaflet';
import {
  ShieldAlert, Download, CheckCircle, Trash2, Radar, LogOut, ClipboardCheck, Siren,
  MapPinOff, ShieldCheck, Camera, MapPin, Zap, Image as ImagenIcono,
  CalendarClock, CalendarPlus, UserCheck, X, LayoutDashboard, Map as MapaIcono, BarChart3,
  ClipboardList, Sun, Moon, Maximize2, Minimize2, Crosshair, Search, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight, Printer, Presentation, Bell, PanelLeftClose, PanelLeftOpen,
  Navigation, Clock, Check, Sparkles,
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './panel.css';

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const CENTRO_MAPA = [11.0041, -74.8070];
const ORDEN_PRIORIDAD = { Alta: 0, Media: 1, Baja: 2 };
// Modo demostración: solo con ?demo=1 en la dirección. Usa datos de ejemplo locales, sin servidor.
const DEMO = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo');

const COLOR = {
  verde: 'var(--verde)',
  rojo: 'var(--rojo)',
  ambar: 'var(--ambar)',
  cian: 'var(--cian)',
  violeta: 'var(--violeta)',
  azul: 'var(--azul)',
};

const CATEGORIAS = {
  ok: { nombre: 'Completadas', color: COLOR.verde },
  abierta: { nombre: 'Novedad abierta', color: COLOR.rojo },
  rango: { nombre: 'Fuera de rango', color: COLOR.ambar },
  cerrada: { nombre: 'Novedad cerrada', color: COLOR.cian },
};

const ESTILOS_MAPA = {
  oscuro: [
    { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', maxZoom: 16 },
    { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', maxZoom: 16 },
  ],
  calles: [
    { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', maxZoom: 19 },
  ],
  satelite: [
    { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 18 },
    { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', maxZoom: 18 },
  ],
};

const SECCIONES = [
  { id: 'resumen', nombre: 'Resumen', Icono: LayoutDashboard },
  { id: 'analisis', nombre: 'Análisis', Icono: BarChart3 },
  { id: 'mapa', nombre: 'Mapa', Icono: MapaIcono },
  { id: 'alertas', nombre: 'Alertas', Icono: Siren },
  { id: 'programacion', nombre: 'Programación', Icono: CalendarClock },
  { id: 'historial', nombre: 'Historial', Icono: ClipboardList },
];

const parseActividades = (txt) => {
  try { return txt ? JSON.parse(txt) : []; } catch { return []; }
};
// El servidor guarda las horas en UTC sin zona; se agrega la Z para mostrarlas en hora local.
const aFecha = (f) => (f ? new Date(f.endsWith('Z') ? f : f + 'Z') : null);
const formatearFecha = (f) => (f ? aFecha(f).toLocaleString() : "—");
const inicial = (nombre) => (nombre || "?").charAt(0);
// ¿La fecha (UTC sin zona) ocurrió en las últimas N horas?
const esReciente = (f, horas) => !!f && Date.now() - aFecha(f).getTime() < horas * 3600 * 1000;
const COLOR_ESTADO_ASIGNACION = { Pendiente: COLOR.cian, Vencida: COLOR.rojo, Realizada: COLOR.verde };

const hace = (f) => {
  const d = aFecha(f);
  if (!d) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "hace unos segundos";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
};
const duracion = (a, b) => {
  const x = aFecha(a), y = aFecha(b);
  if (!x || !y) return "—";
  const m = Math.max(0, Math.round((y - x) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const pctActividades = (v) => {
  const a = parseActividades(v.actividades);
  return a.length ? (a.filter((x) => x.cumplida).length / a.length) * 100 : 0;
};
const aInputLocal = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Categoría visual de una visita
const categoria = (v) => {
  if (v.estado === "Novedad" && !v.cerrada) return 'abierta';
  if (v.fuera_de_rango) return 'rango';
  if (v.estado === "Novedad") return 'cerrada';
  return 'ok';
};
const colorDeVisita = (v) => CATEGORIAS[categoria(v)].color;
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

// Visitas agrupadas por hora (12 h, 24 h) o por día (7 d)
function serieVisitas(visitas, rango) {
  const ahora = Date.now();
  const horas = rango === '7d' ? 168 : rango === '24h' ? 24 : 12;
  const paso = rango === '7d' ? 24 : 1;
  const n = horas / paso;
  const inicio = ahora - horas * 3600e3;
  const cubos = Array.from({ length: n }, (_, i) => {
    const d = new Date(inicio + (i + 1) * paso * 3600e3);
    return {
      total: 0,
      etiqueta: rango === '7d' ? d.toLocaleDateString('es-CO', { weekday: 'short' }) : `${d.getHours()}h`,
    };
  });
  visitas.forEach((v) => {
    const d = aFecha(v.fecha);
    if (!d) return;
    const i = Math.floor((d.getTime() - inicio) / (paso * 3600e3));
    if (i >= 0 && i < n) cubos[i].total += 1;
  });
  return cubos;
}

// ---------- Datos de ejemplo (solo modo demostración) ----------
const FOTO_DEMO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='480'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#164e63'/><stop offset='1' stop-color='#312e81'/></linearGradient></defs><rect width='640' height='480' fill='url(#g)'/><text x='320' y='230' fill='#ffffff66' font-size='28' text-anchor='middle' font-family='sans-serif'>Foto de evidencia (demo)</text><rect y='414' width='640' height='66' fill='#000000b0'/><text x='16' y='441' fill='#fff' font-size='18' font-family='sans-serif'>brayan | 01/10/2026 13:12:35</text><text x='16' y='466' fill='#fff' font-size='16' font-family='sans-serif'>GPS 11.00900, -74.78821 | Centro Principal | a 12 m del centro</text></svg>`
);

function datosDemo() {
  const ahora = Date.now();
  const iso = (h) => new Date(ahora - h * 3600e3).toISOString().replace('Z', '');
  const nombres = ['Limpieza de áreas comunes', 'Recolección de residuos', 'Desinfección'];
  const acts = (c) => JSON.stringify(nombres.map((nombre, i) => ({ nombre, cumplida: !!c[i] })));
  const [lat0, lon0] = [11.0090, -74.7882];
  const V = (i, supervisor, h, estado, prioridad, obs, c, dlat, dlon, dist, extra = {}) => ({
    id: `demo-${i}`, supervisor, estado, prioridad, observaciones: obs, actividades: acts(c),
    tiene_evidencia: i % 3 === 0, fecha: iso(h), fecha_salida: iso(h - 0.4), cerrada: false,
    fuera_de_rango: false, distancia_m: dist, lat: lat0 + dlat, lon: lon0 + dlon, ...extra,
  });
  const visitas = [
    V(0, 'brayan', 0.4, 'Completado', null, 'Todo en orden.', [1, 1, 1], 0.0002, 0.0001, 12),
    V(1, 'maria', 1.1, 'Novedad', 'Alta', 'Fuga de agua en el baño del piso 2.', [1, 0, 1], 0.0040, 0.0020, 38),
    V(2, 'brayan', 1.9, 'Completado', null, 'Se verificó la piscina.', [1, 1, 0], -0.0003, 0.0004, 22),
    V(3, 'maria', 2.7, 'Completado', null, 'Sin observaciones.', [1, 1, 1], 0.0043, 0.0023, 30),
    V(4, 'brayan', 3.5, 'Completado', null, 'Visita desde un lugar lejano.', [1, 1, 1], 0.0200, 0.0010, 2210, { fuera_de_rango: true }),
    V(5, 'maria', 4.2, 'Novedad', 'Media', 'Falta dotación de insumos de aseo.', [0, 1, 1], -0.0030, 0.0040, 61),
    V(6, 'brayan', 5.0, 'Completado', null, 'Todo en orden.', [1, 1, 1], 0.0001, -0.0002, 9),
    V(7, 'maria', 6.3, 'Completado', null, 'Falta recolección en el piso 3.', [1, 0, 1], 0.0038, 0.0018, 44),
    V(8, 'brayan', 7.4, 'Novedad', 'Baja', 'Luminaria dañada en el parqueadero.', [1, 1, 1], -0.0002, 0.0003, 17, { cerrada: true }),
    V(9, 'maria', 9.0, 'Completado', null, 'Sin observaciones.', [1, 1, 1], -0.0028, 0.0038, 52),
    V(10, 'brayan', 11.0, 'Completado', null, 'Todo en orden.', [1, 1, 1], 0.0004, 0.0001, 25),
    V(11, 'maria', 14.0, 'Completado', null, 'Sin observaciones.', [1, 1, 0], 0.0041, 0.0021, 33),
    V(12, 'brayan', 20.0, 'Completado', null, 'Todo en orden.', [1, 1, 1], 0.0003, 0.0002, 14),
    V(13, 'maria', 30.0, 'Completado', null, 'Todo en orden.', [1, 1, 1], -0.0031, 0.0041, 48),
    V(14, 'brayan', 52.0, 'Completado', null, 'Todo en orden.', [1, 1, 1], 0.0002, 0.0001, 11),
    V(15, 'maria', 76.0, 'Novedad', 'Alta', 'Puerta principal sin cerradura.', [1, 1, 0], 0.0042, 0.0019, 36, { cerrada: true }),
    V(16, 'brayan', 100.0, 'Completado', null, 'Todo en orden.', [1, 1, 1], -0.0001, 0.0002, 15),
  ];
  const centros = [
    { id: 'c1', nombre: 'Centro Principal', lat: lat0, lon: lon0, radio_m: 150 },
    { id: 'c2', nombre: 'Edificio Torre Norte', lat: lat0 + 0.004, lon: lon0 + 0.002, radio_m: 150 },
    { id: 'c3', nombre: 'Conjunto Villa Real', lat: lat0 - 0.003, lon: lon0 + 0.004, radio_m: 150 },
  ];
  const A = (i, centro, supervisor, h, estado) => ({ id: `asig-${i}`, centro_id: `c${centro}`, centro: centros[centro - 1].nombre, supervisor, programada: iso(h), estado });
  const asignaciones = [
    A(1, 1, 'brayan', -2, 'Pendiente'), A(2, 2, 'maria', -5, 'Pendiente'), A(3, 3, 'brayan', -26, 'Pendiente'),
    A(4, 2, 'maria', 6, 'Vencida'), A(5, 3, 'brayan', 30, 'Vencida'),
    A(6, 1, 'brayan', 0.5, 'Realizada'), A(7, 2, 'maria', 1.2, 'Realizada'), A(8, 3, 'maria', 2.8, 'Realizada'),
  ];
  return { visitas, centros, asignaciones, supervisores: ['brayan', 'maria'] };
}

// ---------- Componentes visuales ----------

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

const brillo = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
};

function Sparkline({ valores }) {
  const max = Math.max(1, ...valores);
  const n = valores.length;
  const pts = valores.map((v, i) => [(i / Math.max(1, n - 1)) * 100, 28 - (v / max) * 24]);
  const linea = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
  return (
    <svg className="cm-spark" viewBox="0 0 100 32" preserveAspectRatio="none">
      <defs>
        <linearGradient id="cm-spark-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--c)', stopOpacity: 0.45 }} />
          <stop offset="1" style={{ stopColor: 'var(--c)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={`${linea} L100,32 L0,32 Z`} fill="url(#cm-spark-g)" />
      <path d={linea} fill="none" stroke="var(--c)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Kpi({ titulo, valor, sufijo = "", color, Icono, anillo, serie, sub, retraso = 0 }) {
  const mostrado = useNumeroAnimado(valor);
  const circunferencia = 2 * Math.PI * 30;
  return (
    <div className="cm-vidrio cm-kpi cm-brillo" style={{ '--c': color, animationDelay: `${retraso}ms` }} onMouseMove={brillo}>
      <div className="cm-kpi-fila">
        <div className="cm-kpi-icono"><Icono size={20} /></div>
        {anillo && (
          <svg className="cm-anillo" width="64" height="64" viewBox="0 0 76 76">
            <circle className="fondo" cx="38" cy="38" r="30" />
            <circle
              className="valor" cx="38" cy="38" r="30" transform="rotate(-90 38 38)"
              strokeDasharray={circunferencia}
              strokeDashoffset={circunferencia * (1 - Math.min(valor, 100) / 100)}
            />
          </svg>
        )}
      </div>
      <div className="cm-kpi-valor">{mostrado}{sufijo}</div>
      <div className="cm-kpi-titulo">{titulo}</div>
      <div className="cm-kpi-sub">{sub}</div>
      {serie && <Sparkline valores={serie} />}
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

function AreaVisitas({ serie }) {
  const [hover, setHover] = useState(null);
  const W = 560, H = 200, pl = 30, pr = 12, pt = 16, pb = 28;
  const n = serie.length;
  const max = Math.max(1, ...serie.map((s) => s.total));
  const tope = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const x = (i) => pl + ((W - pl - pr) * i) / Math.max(1, n - 1);
  const y = (v) => pt + (H - pt - pb) * (1 - v / tope);
  const pts = serie.map((s, i) => [x(i), y(s.total)]);
  const d = pts.map((p, i) => {
    if (i === 0) return `M${p[0]},${p[1]}`;
    const q = pts[i - 1];
    const cx = (p[0] + q[0]) / 2;
    return `C${cx},${q[1]} ${cx},${p[1]} ${p[0]},${p[1]}`;
  }).join(' ');
  const area = `${d} L${x(n - 1)},${H - pb} L${x(0)},${H - pb} Z`;
  const cada = Math.ceil(n / 8);
  const total = serie.reduce((a, s) => a + s.total, 0);
  if (total === 0) return <div className="cm-vacio-graf">Sin visitas en este periodo.</div>;
  const h = hover !== null ? serie[hover] : null;
  return (
    <svg className="cm-area" viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <linearGradient id="cm-area-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--cian)', stopOpacity: 0.5 }} />
          <stop offset="1" style={{ stopColor: 'var(--cian)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((k) => (
        <g key={k}>
          <line className="rejilla" x1={pl} x2={W - pr} y1={y((tope / 4) * k)} y2={y((tope / 4) * k)} />
          <text className="eje" x={pl - 8} y={y((tope / 4) * k) + 3} textAnchor="end">{(tope / 4) * k}</text>
        </g>
      ))}
      <path d={area} fill="url(#cm-area-g)" />
      <path className="linea" d={d} />
      {serie.map((s, i) => (i % cada === 0 || i === n - 1) && (
        <text key={i} className="eje" x={x(i)} y={H - 8} textAnchor="middle">{s.etiqueta}</text>
      ))}
      {serie.map((s, i) => (
        <rect key={i} x={x(i) - (W - pl - pr) / n / 2} y={pt} width={(W - pl - pr) / n} height={H - pt - pb} fill="transparent"
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
      ))}
      {h && (
        <g pointerEvents="none">
          <line className="guia" x1={x(hover)} x2={x(hover)} y1={pt} y2={H - pb} />
          <circle className="punto" cx={x(hover)} cy={y(h.total)} r="5" />
          <rect className="cm-tip" x={Math.min(Math.max(x(hover) - 50, 4), W - 104)} y={Math.max(y(h.total) - 40, 2)} width="100" height="28" rx="8" />
          <text className="cm-tip-txt" x={Math.min(Math.max(x(hover) - 50, 4), W - 104) + 50} y={Math.max(y(h.total) - 40, 2) + 18} textAnchor="middle">
            {h.etiqueta}: {h.total} {h.total === 1 ? 'visita' : 'visitas'}
          </text>
        </g>
      )}
    </svg>
  );
}

function Donut({ datos, onElegir, elegida }) {
  const [hover, setHover] = useState(null);
  const total = datos.reduce((a, d) => a + d.valor, 0);
  const R = 54, C = 2 * Math.PI * R;
  const segs = datos.reduce((acc, d) => {
    const dash = total ? (d.valor / total) * C : 0;
    const previo = acc.length ? acc[acc.length - 1].fin : 0;
    return [...acc, { ...d, dash, inicio: previo, fin: previo + dash }];
  }, []);
  const activo = segs.find((s) => s.clave === hover);
  return (
    <div className="cm-donut">
      <svg width="170" height="170" viewBox="0 0 140 140">
        <circle className="fondo" cx="70" cy="70" r={R} />
        {segs.map((s) => s.valor > 0 && (
          <circle
            key={s.clave} className="seg" cx="70" cy="70" r={R}
            stroke={s.color} strokeWidth={hover === s.clave || elegida === s.clave ? 17 : 12}
            opacity={hover && hover !== s.clave ? 0.35 : 1}
            strokeDasharray={`${Math.max(0, s.dash - 1.5)} ${C - Math.max(0, s.dash - 1.5)}`}
            strokeDashoffset={-s.inicio} transform="rotate(-90 70 70)"
            onMouseEnter={() => setHover(s.clave)} onMouseLeave={() => setHover(null)}
            onClick={() => onElegir && onElegir(s.clave)}
          />
        ))}
        <text className="gran" x="70" y="72">{activo ? activo.valor : total}</text>
        <text className="peq" x="70" y="88">{activo ? activo.nombre : 'visitas'}</text>
      </svg>
      <div className="cm-leyenda-lista">
        {segs.map((s) => (
          <div key={s.clave} className={`cm-leyenda-item ${elegida === s.clave ? 'on' : ''}`} style={{ '--c': s.color }}
            onMouseEnter={() => setHover(s.clave)} onMouseLeave={() => setHover(null)} onClick={() => onElegir && onElegir(s.clave)}>
            <i /> {s.nombre} <b>{s.valor}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function Barras({ datos }) {
  if (datos.length === 0) return <div className="cm-vacio-graf">Sin datos todavía.</div>;
  return (
    <div className="cm-barras">
      {datos.map((d) => (
        <div className="cm-barra-fila" key={d.nombre} style={{ '--c': d.color }}>
          <span className="nom" title={d.nombre}>{d.nombre}</span>
          <div className="cm-pista"><i style={{ width: `${Math.max(3, d.pct)}%` }} /></div>
          <b>{d.texto}</b>
        </div>
      ))}
    </div>
  );
}

function Confeti({ onFin }) {
  const [piezas] = useState(() => Array.from({ length: 32 }, (_, i) => ({
    k: ['var(--verde)', 'var(--cian)', 'var(--ambar)', 'var(--violeta)', 'var(--rojo)'][i % 5],
    dx: `${Math.round((Math.random() - 0.5) * 760)}px`,
    dy: `${Math.round(-120 + Math.random() * 520)}px`,
    r: `${Math.round(Math.random() * 720 - 360)}deg`,
  })));
  useEffect(() => {
    const t = setTimeout(onFin, 1500);
    return () => clearTimeout(t);
  }, [onFin]);
  return (
    <div className="cm-confeti">
      {piezas.map((p, i) => <i key={i} style={{ '--k': p.k, '--dx': p.dx, '--dy': p.dy, '--r': p.r }} />)}
    </div>
  );
}

function Aviso({ aviso, onCerrar, onClic }) {
  useEffect(() => {
    const t = setTimeout(() => onCerrar(aviso.clave), 7000);
    return () => clearTimeout(t);
  }, [aviso.clave, onCerrar]);
  return (
    <div className="cm-aviso" style={{ '--c': aviso.color }} onClick={() => { onClic(); onCerrar(aviso.clave); }}>
      <Bell size={22} />
      <div><b>{aviso.titulo}</b><span>{aviso.detalle}</span></div>
    </div>
  );
}

function Detalle({ v, urlEvidencia, onCerrarPanel, onResolver, onEliminar, onVerMapa, onFoto }) {
  const color = colorDeVisita(v);
  const acts = parseActividades(v.actividades);
  const hechas = acts.filter((a) => a.cumplida).length;
  const resoluble = (v.estado === "Novedad" || v.fuera_de_rango) && !v.cerrada;
  return (
    <>
      <div className="cm-velo" onClick={onCerrarPanel} />
      <aside className="cm-cajon" role="dialog" aria-label="Detalle de la visita">
        <div className="cm-cajon-cab">
          <div className="cm-avatar">{inicial(v.supervisor)}</div>
          <div style={{ flex: 1 }}>
            <h3>{v.supervisor}</h3>
            <small>{formatearFecha(v.fecha)} · {hace(v.fecha)}</small>
          </div>
          <button className="cm-btn-icono" onClick={onCerrarPanel} aria-label="Cerrar detalle"><X size={18} /></button>
        </div>
        <div className="cm-cajon-cuerpo">
          <div style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="cm-chip" style={{ '--c': color }}>{CATEGORIAS[categoria(v)].nombre}</span>
            {v.prioridad && <span className="cm-chip" style={{ '--c': colorDeAlerta(v) }}>Prioridad {v.prioridad}</span>}
          </div>
          {v.tiene_evidencia && (
            <div className="cm-foto-grande" onClick={() => onFoto(urlEvidencia(v.id))} title="Ampliar foto">
              <img src={urlEvidencia(v.id)} alt="Evidencia de la visita" />
            </div>
          )}
          <div className="cm-datos">
            <div className="cm-dato"><span>Llegada</span><b>{formatearFecha(v.fecha)}</b></div>
            <div className="cm-dato"><span>Salida</span><b>{formatearFecha(v.fecha_salida)}</b></div>
            <div className="cm-dato"><span>Duración</span><b>{duracion(v.fecha, v.fecha_salida)}</b></div>
            <div className="cm-dato">
              <span>Distancia al centro</span>
              <b style={{ color: v.fuera_de_rango ? COLOR.ambar : undefined }}>{v.distancia_m != null ? `${v.distancia_m} m` : "—"}</b>
            </div>
            <div className="cm-dato"><span>Latitud</span><b>{v.lat != null ? v.lat.toFixed(5) : "—"}</b></div>
            <div className="cm-dato"><span>Longitud</span><b>{v.lon != null ? v.lon.toFixed(5) : "—"}</b></div>
          </div>
          {acts.length > 0 && (
            <>
              <div className="cm-subtitulo">Actividades · {hechas} de {acts.length} cumplidas</div>
              {acts.map((a) => (
                <div className="cm-act" key={a.nombre} style={{ '--c': a.cumplida ? COLOR.verde : COLOR.rojo }}>
                  {a.cumplida ? <Check size={16} /> : <X size={16} />} {a.nombre}
                </div>
              ))}
            </>
          )}
          {v.observaciones && (
            <>
              <div className="cm-subtitulo">Observaciones</div>
              <div className="cm-cita">“{v.observaciones}”</div>
            </>
          )}
        </div>
        <div className="cm-cajon-pie">
          {v.lat != null && <button className="cm-btn-sec" onClick={() => onVerMapa(v)}><Navigation size={15} /> Ver en el mapa</button>}
          {resoluble && <button className="cm-btn-cta" onClick={() => onResolver(v.id)}><CheckCircle size={15} /> Cerrar novedad</button>}
          <button className="cm-btn-eliminar" style={{ width: 'auto', padding: '0 14px', gap: 6, display: 'inline-flex', alignItems: 'center' }} onClick={() => onEliminar(v)}>
            <Trash2 size={15} /> Eliminar
          </button>
        </div>
      </aside>
    </>
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

  // Estado puramente visual
  const [cargado, setCargado] = useState(false);
  const [tema, setTema] = useState(() => {
    try { return localStorage.getItem('cm-tema') || 'oscuro'; } catch { return 'oscuro'; }
  });
  const [colapsado, setColapsado] = useState(false);
  const [presentacion, setPresentacion] = useState(false);
  const [activa, setActiva] = useState('resumen');
  const [rango, setRango] = useState('24h');
  const [estiloMapa, setEstiloMapa] = useState('oscuro');
  const [mapaCompleto, setMapaCompleto] = useState(false);
  const [capaCentros, setCapaCentros] = useState(true);
  const [tiposVisibles, setTiposVisibles] = useState({ ok: true, abierta: true, rango: true, cerrada: true });
  const [filtroAlerta, setFiltroAlerta] = useState('todas');
  const [busqueda, setBusqueda] = useState("");
  const [estadoTabla, setEstadoTabla] = useState('todas');
  const [orden, setOrden] = useState({ col: 'fecha', dir: 'desc' });
  const [pagina, setPagina] = useState(0);
  const [detalleId, setDetalleId] = useState(null);
  const [fotoAbierta, setFotoAbierta] = useState(null);
  const [avisos, setAvisos] = useState([]);
  const [fiesta, setFiesta] = useState(false);
  const mapaRef = useRef(null);
  const demoRef = useRef(null);
  const vistos = useRef(null);

  const auth = { Authorization: `Bearer ${token}` };

  const cargar = useCallback(() => {
    if (DEMO) {
      if (!demoRef.current) demoRef.current = datosDemo();
      const d = demoRef.current;
      setVisitas(d.visitas); setCentros(d.centros); setAsignaciones(d.asignaciones);
      setSupervisoresLista(d.supervisores); setCargado(true);
      return;
    }
    const cab = { headers: { Authorization: `Bearer ${token}` } };
    fetch(`${API}/api/visitas`, cab)
      .then((r) => {
        if (r.status === 401) { onSalir(); return null; }
        return r.json();
      })
      .then((datos) => { if (datos) { setVisitas(datos); setCargado(true); } })
      .catch(() => {});
    fetch(`${API}/api/asignaciones`, cab).then((r) => r.ok ? r.json() : []).then(setAsignaciones).catch(() => {});
    fetch(`${API}/api/panel/centros`, cab).then((r) => r.ok ? r.json() : []).then(setCentros).catch(() => {});
    fetch(`${API}/api/panel/supervisores`, cab).then((r) => r.ok ? r.json() : []).then(setSupervisoresLista).catch(() => {});
  }, [token, onSalir]);

  const asignarVisita = async (e) => {
    e.preventDefault();
    setErrorAsignar("");
    if (DEMO) {
      const c = centros.find((x) => x.id === nueva.centro);
      setAsignaciones((a) => [{ id: `asig-n${Date.now()}`, centro_id: nueva.centro, centro: c ? c.nombre : '', supervisor: nueva.supervisor, programada: new Date(nueva.cuando).toISOString().replace('Z', ''), estado: 'Pendiente' }, ...a]);
      setNueva({ supervisor: "", centro: "", cuando: "" });
      return;
    }
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
    if (DEMO) { setAsignaciones((a) => a.filter((x) => x.id !== id)); return; }
    await fetch(`${API}/api/asignaciones/${id}`, { method: 'DELETE', headers: auth });
    cargar();
  };

  useEffect(() => {
    cargar();
    if (DEMO) { setConectado(true); return undefined; }
    const ws = new WebSocket(`${API.replace(/^http/, "ws")}/ws/dashboard?token=${encodeURIComponent(token)}`);
    ws.onopen = () => setConectado(true);
    ws.onclose = () => setConectado(false);
    ws.onmessage = () => cargar(); // cualquier evento: se recarga la lista completa
    return () => ws.close();
  }, [cargar, token]);

  const cerrarNovedad = async (id) => {
    if (DEMO) setVisitas((vs) => vs.map((v) => (v.id === id ? { ...v, cerrada: true } : v)));
    else {
      await fetch(`${API}/api/visitas/${id}/cerrar`, { method: 'PATCH', headers: auth });
      cargar();
    }
    setFiesta(true);
  };

  const eliminarVisita = async (v) => {
    const detalle = `${v.supervisor} — ${formatearFecha(v.fecha)}`;
    if (!window.confirm(`¿Eliminar definitivamente esta visita?

${detalle}

Esta acción no se puede deshacer.`)) return;
    setDetalleId(null);
    if (DEMO) { setVisitas((vs) => vs.filter((x) => x.id !== v.id)); return; }
    await fetch(`${API}/api/visitas/${v.id}`, { method: 'DELETE', headers: auth });
    cargar();
  };

  const supervisores = [...new Set(visitas.map((v) => v.supervisor))];

  const alertas = useMemo(() => visitas
    .filter((v) => (v.estado === "Novedad" || v.fuera_de_rango) && !v.cerrada)
    .sort((a, b) => (ORDEN_PRIORIDAD[a.prioridad] ?? 3) - (ORDEN_PRIORIDAD[b.prioridad] ?? 3)), [visitas]);

  const actividades = visitas.flatMap((v) => parseActividades(v.actividades));
  const cumplimiento = actividades.length
    ? Math.round((actividades.filter((a) => a.cumplida).length / actividades.length) * 100)
    : 0;

  const fueraDeRango = visitas.filter((v) => v.fuera_de_rango).length;
  const pendientes = asignaciones.filter((a) => a.estado !== "Realizada");
  const supervisoresActivos = new Set(visitas.filter((v) => esReciente(v.fecha, 12)).map((v) => v.supervisor)).size;
  const supervisoresAsignados = new Set(pendientes.map((a) => a.supervisor)).size;
  const urlEvidencia = (id) => (DEMO ? FOTO_DEMO : `${API}/api/visitas/${id}/evidencia?token=${encodeURIComponent(token)}`);

  // ----- Datos para las gráficas (solo cálculo visual sobre los datos existentes) -----
  const serie = useMemo(() => serieVisitas(visitas, rango), [visitas, rango]);
  const serieMini = useMemo(() => serieVisitas(visitas, '12h').map((s) => s.total), [visitas]);
  const porCategoria = useMemo(() => Object.keys(CATEGORIAS).map((clave) => ({
    clave, nombre: CATEGORIAS[clave].nombre, color: CATEGORIAS[clave].color,
    valor: visitas.filter((v) => categoria(v) === clave).length,
  })), [visitas]);
  const porSupervisor = useMemo(() => {
    const mapa = {};
    visitas.forEach((v) => { (mapa[v.supervisor] = mapa[v.supervisor] || []).push(v); });
    const filas = Object.entries(mapa).map(([nombre, vs]) => {
      const acts = vs.flatMap((v) => parseActividades(v.actividades));
      const pct = acts.length ? Math.round((acts.filter((a) => a.cumplida).length / acts.length) * 100) : 0;
      return { nombre, n: vs.length, pct };
    });
    const max = Math.max(1, ...filas.map((f) => f.n));
    const colores = [COLOR.cian, COLOR.violeta, COLOR.verde, COLOR.ambar];
    return filas.map((f, i) => ({ nombre: f.nombre, pct: (f.n / max) * 100, color: colores[i % 4], texto: `${f.n} · ${f.pct}%` }));
  }, [visitas]);
  const porActividad = useMemo(() => {
    const mapa = {};
    actividades.forEach((a) => {
      mapa[a.nombre] = mapa[a.nombre] || { hechas: 0, total: 0 };
      mapa[a.nombre].total += 1;
      if (a.cumplida) mapa[a.nombre].hechas += 1;
    });
    return Object.entries(mapa).map(([nombre, m]) => {
      const pct = Math.round((m.hechas / m.total) * 100);
      return { nombre, pct, color: pct >= 90 ? COLOR.verde : pct >= 70 ? COLOR.ambar : COLOR.rojo, texto: `${pct}%` };
    });
  }, [actividades]);
  const porDistancia = useMemo(() => {
    const tramos = [
      { nombre: '0 a 50 m', f: (d) => d <= 50, color: COLOR.verde },
      { nombre: '50 a 150 m', f: (d) => d > 50 && d <= 150, color: COLOR.cian },
      { nombre: '150 a 500 m', f: (d) => d > 150 && d <= 500, color: COLOR.ambar },
      { nombre: 'Más de 500 m', f: (d) => d > 500, color: COLOR.rojo },
    ];
    const conDato = visitas.filter((v) => v.distancia_m != null);
    const cuentas = tramos.map((t) => conDato.filter((v) => t.f(v.distancia_m)).length);
    const max = Math.max(1, ...cuentas);
    return conDato.length ? tramos.map((t, i) => ({ nombre: t.nombre, pct: (cuentas[i] / max) * 100, color: t.color, texto: String(cuentas[i]) })) : [];
  }, [visitas]);

  // ----- Avisos emergentes cuando aparece una alerta nueva -----
  useEffect(() => {
    if (!cargado) return;
    const ids = new Set(alertas.map((a) => a.id));
    if (vistos.current) {
      const nuevas = alertas.filter((a) => !vistos.current.has(a.id));
      if (nuevas.length) {
        setAvisos((av) => [...av, ...nuevas.map((a) => ({
          clave: `${a.id}-${Date.now()}`, id: a.id, color: colorDeAlerta(a),
          titulo: a.estado === "Novedad" ? `Nueva novedad · ${a.supervisor}` : `Visita fuera de rango · ${a.supervisor}`,
          detalle: a.observaciones || (a.distancia_m != null ? `A ${a.distancia_m} m del centro` : 'Revisa el detalle'),
        }))]);
      }
    }
    vistos.current = ids;
  }, [alertas, cargado]);

  // ----- Interfaz: tema, secciones, mapa -----
  const cambiarTema = () => {
    const siguiente = tema === 'oscuro' ? 'claro' : 'oscuro';
    setTema(siguiente);
    try { localStorage.setItem('cm-tema', siguiente); } catch { /* sin almacenamiento */ }
  };
  const irA = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  useEffect(() => {
    const obs = new IntersectionObserver((entradas) => {
      entradas.forEach((e) => { if (e.isIntersecting) setActiva(e.target.id); });
    }, { rootMargin: '-35% 0px -55% 0px' });
    SECCIONES.forEach((s) => { const el = document.getElementById(s.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const tecla = (e) => {
      if (e.key !== 'Escape') return;
      if (fotoAbierta) setFotoAbierta(null);
      else if (detalleId) setDetalleId(null);
      else if (mapaCompleto) setMapaCompleto(false);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [fotoAbierta, detalleId, mapaCompleto]);

  useEffect(() => {
    const t = setTimeout(() => mapaRef.current?.invalidateSize(), 350);
    return () => clearTimeout(t);
  }, [mapaCompleto]);

  const visitasMapa = useMemo(() => visitas.filter((v) => v.lat != null && tiposVisibles[categoria(v)]), [visitas, tiposVisibles]);
  const centrar = () => {
    const puntos = [...visitasMapa.map((v) => [v.lat, v.lon]), ...(capaCentros ? centros.map((c) => [c.lat, c.lon]) : [])];
    if (puntos.length && mapaRef.current) mapaRef.current.fitBounds(L.latLngBounds(puntos).pad(0.3), { maxZoom: 16 });
  };
  // Al cargar los datos por primera vez, el mapa se encuadra solo sobre las visitas y los centros
  const centrarRef = useRef(centrar);
  useEffect(() => { centrarRef.current = centrar; });
  const encuadrado = useRef(false);
  useEffect(() => {
    if (!cargado || encuadrado.current) return undefined;
    const t = setTimeout(() => { centrarRef.current(); encuadrado.current = true; }, 700);
    return () => clearTimeout(t);
  }, [cargado]);
  const verEnMapa = (v) => {
    setDetalleId(null);
    irA('mapa');
    setTimeout(() => mapaRef.current?.flyTo([v.lat, v.lon], 17, { duration: 1.2 }), 400);
  };

  // ----- Alertas, tabla y paginación (filtros visuales) -----
  const alertasVista = alertas.filter((a) => {
    if (filtroAlerta === 'todas') return true;
    if (filtroAlerta === 'rango') return a.fuera_de_rango;
    return a.estado === "Novedad" && a.prioridad === filtroAlerta;
  });
  const cuentaAlertas = {
    todas: alertas.length,
    Alta: alertas.filter((a) => a.estado === "Novedad" && a.prioridad === 'Alta').length,
    Media: alertas.filter((a) => a.estado === "Novedad" && a.prioridad === 'Media').length,
    Baja: alertas.filter((a) => a.estado === "Novedad" && a.prioridad === 'Baja').length,
    rango: alertas.filter((a) => a.fuera_de_rango).length,
  };

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    let r = visitas.filter((v) => !filtroSupervisor || v.supervisor === filtroSupervisor);
    if (estadoTabla !== 'todas') r = r.filter((v) => categoria(v) === estadoTabla);
    if (q) r = r.filter((v) => `${v.supervisor} ${v.estado} ${v.observaciones || ''} ${v.prioridad || ''}`.toLowerCase().includes(q));
    const claves = {
      fecha: (v) => aFecha(v.fecha)?.getTime() ?? 0,
      supervisor: (v) => v.supervisor,
      distancia: (v) => v.distancia_m ?? -1,
      actividades: (v) => pctActividades(v),
    };
    const k = claves[orden.col];
    const dir = orden.dir === 'asc' ? 1 : -1;
    return [...r].sort((a, b) => { const A = k(a), B = k(b); return (A > B ? 1 : A < B ? -1 : 0) * dir; });
  }, [visitas, filtroSupervisor, estadoTabla, busqueda, orden]);
  const porPagina = 8;
  const paginas = Math.max(1, Math.ceil(filas.length / porPagina));
  const pag = Math.min(pagina, paginas - 1);
  const filasPagina = filas.slice(pag * porPagina, pag * porPagina + porPagina);
  const ordenar = (col) => setOrden((o) => (o.col === col ? { col, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' }));
  const flecha = (col) => (orden.col === col ? (orden.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : null);

  const detalle = visitas.find((v) => v.id === detalleId);
  const cerrarAviso = useCallback((clave) => setAvisos((av) => av.filter((a) => a.clave !== clave)), []);
  const enHora = visitas.filter((v) => esReciente(v.fecha, 1)).length;
  const vencidas = asignaciones.filter((a) => a.estado === 'Vencida').length;
  const altas = alertas.filter((a) => a.prioridad === 'Alta').length;
  const nombreSup = supervisoresLista.length || supervisores.length;

  const atajosHora = [
    { t: '+1 h', f: () => new Date(Date.now() + 3600e3) },
    { t: '+3 h', f: () => new Date(Date.now() + 3 * 3600e3) },
    { t: 'Mañana 8:00', f: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d; } },
  ];

  return (
    <div className="cm-app" data-tema={tema} data-pres={presentacion ? 1 : 0}>
      <div className="cm-aurora" /><div className="cm-aurora b" />

      <aside className={`cm-lateral ${colapsado ? 'min' : ''}`}>
        <div className="cm-marca">
          <div className="cm-logo"><Radar size={24} /></div>
          <div className="cm-marca-texto"><b>SUPERVISIÓN</b><span>Inteligente</span></div>
        </div>
        <nav className="cm-nav">
          {SECCIONES.map(({ id, nombre, Icono }) => (
            <button key={id} className={`cm-nav-btn ${activa === id ? 'on' : ''}`} onClick={() => irA(id)} title={nombre}>
              <Icono size={18} />
              <span className="cm-nav-texto">{nombre}</span>
              {id === 'alertas' && alertas.length > 0 && <span className="cm-nav-insignia">{alertas.length}</span>}
            </button>
          ))}
        </nav>
        <div className="cm-lateral-pie">
          <button className={`cm-herr ${presentacion ? 'on' : ''}`} onClick={() => setPresentacion((p) => !p)} title="Modo presentación">
            <Presentation size={17} /><span className="cm-nav-texto">Modo presentación</span>
          </button>
          <button className="cm-herr" onClick={cambiarTema} title="Cambiar tema">
            {tema === 'oscuro' ? <Sun size={17} /> : <Moon size={17} />}<span className="cm-nav-texto">{tema === 'oscuro' ? 'Tema claro' : 'Tema oscuro'}</span>
          </button>
          <button className="cm-herr" onClick={() => setColapsado((c) => !c)} title="Contraer menú">
            {colapsado ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}<span className="cm-nav-texto">Contraer menú</span>
          </button>
        </div>
      </aside>

      <main className="cm-principal">
        <header className="cm-top">
          <div>
            <h1>Centro de <em>mando</em></h1>
            <p>Supervisión inteligente de servicios en campo</p>
          </div>
          <div className="cm-top-der">
            <Reloj />
            <div className={`cm-vivo ${DEMO ? 'demo' : conectado ? '' : 'off'}`}>
              <span className="cm-punto" />
              {DEMO ? 'DEMO' : conectado ? 'EN VIVO' : 'SIN CONEXIÓN'}
            </div>
            <button className="cm-btn-icono" onClick={() => irA('alertas')} title="Ir a las alertas" aria-label="Alertas">
              <Bell size={18} />
              {alertas.length > 0 && <span className="cm-nav-insignia">{alertas.length}</span>}
            </button>
            <button className="cm-btn-icono" onClick={() => window.print()} title="Imprimir informe" aria-label="Imprimir"><Printer size={18} /></button>
            <div className="cm-usuario">
              <div className="cm-avatar">{inicial(usuario)}</div>
              <span>{usuario}</span>
              <button className="cm-btn-salir" onClick={onSalir}><LogOut size={14} /> Salir</button>
            </div>
          </div>
        </header>

        <section id="resumen" className="cm-seccion">
          {!cargado && !DEMO ? (
            <div className="cm-kpis">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="cm-esqueleto" style={{ height: 168 }} />)}</div>
          ) : (
            <div className="cm-kpis">
              <Kpi titulo="Visitas realizadas" valor={visitas.length} color={COLOR.cian} Icono={ClipboardCheck} serie={serieMini} sub={`${enHora} en la última hora`} retraso={0} />
              <Kpi titulo="Visitas pendientes" valor={pendientes.length} color={COLOR.violeta} Icono={CalendarClock} sub={`${vencidas} vencida(s)`} retraso={60} />
              <Kpi titulo="Supervisores activos (12 h)" valor={supervisoresActivos} color={COLOR.verde} Icono={UserCheck} sub={`de ${nombreSup} supervisores`} retraso={120} />
              <Kpi titulo="Novedades abiertas" valor={alertas.length} color={COLOR.rojo} Icono={Siren} sub={`${altas} de prioridad alta`} retraso={180} />
              <Kpi titulo="Fuera de rango" valor={fueraDeRango} color={COLOR.ambar} Icono={MapPinOff} sub={visitas.length ? `${Math.round((fueraDeRango / visitas.length) * 100)}% de las visitas` : ' '} retraso={240} />
              <Kpi titulo="Cumplimiento de actividades" valor={cumplimiento} sufijo="%" color={COLOR.verde} Icono={ShieldCheck} anillo sub={`${actividades.filter((a) => a.cumplida).length} de ${actividades.length} actividades`} retraso={300} />
            </div>
          )}
        </section>

        <section id="analisis" className="cm-seccion">
          <h2 className="cm-titulo-seccion"><span className="cm-icono-titulo"><BarChart3 size={16} /></span> Análisis <small>Haz clic en la gráfica de estado para filtrar el historial</small></h2>
          <div className="cm-grafs">
            <div className="cm-vidrio cm-graf ancha cm-brillo" onMouseMove={brillo}>
              <div className="cm-graf-cab">
                <h3>Visitas en el tiempo<small>Pasa el cursor sobre la línea para ver cada valor</small></h3>
                <div className="cm-segmento">
                  {[['12h', '12 h'], ['24h', '24 h'], ['7d', '7 días']].map(([k, t]) => (
                    <button key={k} className={rango === k ? 'on' : ''} onClick={() => setRango(k)}>{t}</button>
                  ))}
                </div>
              </div>
              <AreaVisitas key={rango + visitas.length} serie={serie} />
            </div>
            <div className="cm-vidrio cm-graf cm-brillo" onMouseMove={brillo}>
              <div className="cm-graf-cab"><h3>Estado de las visitas<small>Clic en un tramo para filtrar</small></h3></div>
              <Donut
                datos={porCategoria}
                elegida={estadoTabla}
                onElegir={(c) => { setEstadoTabla((e) => (e === c ? 'todas' : c)); setPagina(0); irA('historial'); }}
              />
            </div>
            <div className="cm-vidrio cm-graf cm-brillo" onMouseMove={brillo}>
              <div className="cm-graf-cab"><h3>Visitas por supervisor<small>Cantidad · cumplimiento</small></h3></div>
              <Barras datos={porSupervisor} />
            </div>
            <div className="cm-vidrio cm-graf cm-brillo" onMouseMove={brillo}>
              <div className="cm-graf-cab"><h3>Cumplimiento por actividad<small>Verde 90% o más · ámbar 70% o más</small></h3></div>
              <Barras datos={porActividad} />
            </div>
            <div className="cm-vidrio cm-graf cm-brillo" onMouseMove={brillo}>
              <div className="cm-graf-cab"><h3>Distancia al centro<small>Visitas por tramo de distancia</small></h3></div>
              <Barras datos={porDistancia} />
            </div>
          </div>
        </section>

        <section id="mapa" className="cm-seccion">
          <h2 className="cm-titulo-seccion"><span className="cm-icono-titulo" style={{ '--c': COLOR.verde }}><MapPin size={16} /></span> Mapa operativo <small>Círculos punteados: radio de validación de cada centro</small></h2>
          <div className="cm-mapa-fila">
            <div className={`cm-vidrio cm-mapa-wrap ${mapaCompleto ? 'full' : ''}`}>
              <div className="cm-mapa-barra">
                {Object.entries(CATEGORIAS).map(([clave, c]) => (
                  <button key={clave} className={`cm-chip-mapa ${tiposVisibles[clave] ? '' : 'apagado'}`} style={{ '--c': c.color }}
                    onClick={() => setTiposVisibles((t) => ({ ...t, [clave]: !t[clave] }))}>
                    <i />{c.nombre}
                  </button>
                ))}
                <button className={`cm-chip-mapa ${capaCentros ? 'on' : ''}`} onClick={() => setCapaCentros((c) => !c)}>Centros</button>
                <div className="cm-segmento">
                  {[['oscuro', 'Oscuro'], ['calles', 'Calles'], ['satelite', 'Satélite']].map(([k, t]) => (
                    <button key={k} className={estiloMapa === k ? 'on' : ''} onClick={() => setEstiloMapa(k)}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="cm-mapa-herr">
                <button className="cm-btn-icono" onClick={() => setMapaCompleto((m) => !m)} title="Pantalla completa" aria-label="Pantalla completa">
                  {mapaCompleto ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button className="cm-btn-icono" onClick={centrar} title="Centrar el mapa" aria-label="Centrar"><Crosshair size={18} /></button>
              </div>
              <MapContainer ref={mapaRef} center={CENTRO_MAPA} zoom={13} style={{ width: '100%', height: '100%' }}>
                {ESTILOS_MAPA[estiloMapa].map((t) => (
                  <TileLayer key={estiloMapa + t.url} attribution="Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors" url={t.url} maxZoom={t.maxZoom} />
                ))}
                {capaCentros && centros.map((c) => (
                  <Circle
                    key={c.id}
                    center={[c.lat, c.lon]}
                    radius={c.radio_m}
                    pathOptions={{ color: '#22d3ee', weight: 1.5, dashArray: '5 6', fillColor: '#22d3ee', fillOpacity: 0.08 }}
                  >
                    <Tooltip sticky>{c.nombre} · radio {c.radio_m} m</Tooltip>
                  </Circle>
                ))}
                {[...visitasMapa].reverse().map((v, i) => {
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
                        <span className="cm-chip" style={{ '--c': color, margin: '4px 0 8px' }}>
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
                        <button className="cm-pop-btn" onClick={() => setDetalleId(v.id)}>Ver detalle completo</button>
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>
            </div>

            <div id="alertas" className="cm-vidrio cm-feed">
              <div className="cm-feed-cab">
                <Zap size={20} color="var(--ambar)" />
                <h3>Novedades y alertas</h3>
                <span className={`cm-contador ${alertas.length === 0 ? "cero" : ""}`}>{alertas.length}</span>
              </div>
              <div className="cm-filtros">
                {[['todas', 'Todas', COLOR.cian], ['Alta', 'Alta', COLOR.rojo], ['Media', 'Media', COLOR.ambar], ['Baja', 'Baja', COLOR.cian], ['rango', 'Fuera de rango', COLOR.ambar]].map(([k, t, c]) => (
                  <button key={k} className={`cm-filtro ${filtroAlerta === k ? 'on' : ''}`} style={{ '--c': c }} onClick={() => setFiltroAlerta(k)}>
                    {t} <b>{cuentaAlertas[k]}</b>
                  </button>
                ))}
              </div>
              <div className="cm-feed-lista">
                {alertasVista.length === 0 ? (
                  <div className="cm-vacio">
                    <div className="cm-vacio-icono"><ShieldCheck size={34} /></div>
                    {alertas.length === 0 ? <>Sin novedades abiertas.<br />Todo bajo control.</> : 'Ninguna alerta con este filtro.'}
                  </div>
                ) : (
                  alertasVista.map((a) => {
                    const color = colorDeAlerta(a);
                    return (
                      <div
                        key={a.id}
                        className={`cm-alerta ${a.estado === "Novedad" && a.prioridad === "Alta" ? "alta" : ""}`}
                        style={{ '--c': color }}
                        onClick={() => setDetalleId(a.id)}
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
                          <div className="cm-alerta-linea"><Clock size={11} style={{ verticalAlign: -1 }} /> {hace(a.fecha)}</div>
                        </div>
                        <button className="cm-btn-cerrar" onClick={(e) => { e.stopPropagation(); cerrarNovedad(a.id); }}>
                          <CheckCircle size={14} /> Cerrar
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </section>

        <section id="programacion" className="cm-seccion">
          <h2 className="cm-titulo-seccion">
            <span className="cm-icono-titulo" style={{ '--c': COLOR.violeta }}><CalendarClock size={16} /></span> Programación de visitas
            <small>{supervisoresAsignados} supervisor(es) con visitas asignadas · {pendientes.length} pendiente(s)</small>
          </h2>
          <div className="cm-vidrio cm-prog">
            <form className="cm-form-prog-wrap" onSubmit={asignarVisita}>
              <div className="cm-form-prog">
                <div>
                  <span className="cm-campo-titulo">1 · Supervisor</span>
                  <div className="cm-filtros">
                    {supervisoresLista.map((s) => (
                      <button type="button" key={s} className={`cm-filtro ${nueva.supervisor === s ? 'on' : ''}`} onClick={() => setNueva({ ...nueva, supervisor: s })}>
                        <span className="cm-avatar" style={{ width: 20, height: 20, fontSize: 10 }}>{inicial(s)}</span> {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="cm-campo-titulo">2 · Centro de costo</span>
                  <div className="cm-filtros">
                    {centros.map((c) => (
                      <button type="button" key={c.id} className={`cm-filtro ${nueva.centro === c.id ? 'on' : ''}`} onClick={() => setNueva({ ...nueva, centro: c.id })}>
                        <MapPin size={12} /> {c.nombre}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="cm-campo-titulo">3 · Fecha y hora</span>
                  <input className="cm-input" type="datetime-local" required value={nueva.cuando} onChange={(e) => setNueva({ ...nueva, cuando: e.target.value })} />
                  <div className="cm-form-acciones">
                    {atajosHora.map((a) => (
                      <button type="button" key={a.t} className="cm-filtro" onClick={() => setNueva({ ...nueva, cuando: aInputLocal(a.f()) })}>{a.t}</button>
                    ))}
                  </div>
                </div>
              </div>
              <button className="cm-btn-cta" disabled={!nueva.supervisor || !nueva.centro || !nueva.cuando}><CalendarPlus size={16} /> Asignar visita</button>
              {errorAsignar && <div className="cm-login-error" style={{ marginTop: 10 }}>{errorAsignar}</div>}
            </form>
            <div className="cm-kanban" style={{ marginTop: 18 }}>
              {['Pendiente', 'Vencida', 'Realizada'].map((estado) => {
                const lista = asignaciones.filter((a) => a.estado === estado);
                return (
                  <div className="cm-columna" key={estado} style={{ '--c': COLOR_ESTADO_ASIGNACION[estado] }}>
                    <div className="cm-columna-cab"><i />{estado}s<b>{lista.length}</b></div>
                    {lista.length === 0 && <div className="cm-nota">Nada por aquí.</div>}
                    {lista.map((a) => (
                      <div key={a.id} className="cm-tarjeta">
                        <div className="cm-avatar" style={{ width: 30, height: 30, fontSize: 12 }}>{inicial(a.supervisor)}</div>
                        <div className="cm-tarjeta-texto">
                          <b>{a.supervisor}</b> → {a.centro}
                          <span>{formatearFecha(a.programada)}</span>
                        </div>
                        {a.estado !== "Realizada" && (
                          <button className="cm-btn-eliminar" style={{ width: 28, height: 28 }} title="Cancelar asignación" onClick={() => cancelarAsignacion(a.id)}><X size={14} /></button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="historial" className="cm-seccion">
          <h2 className="cm-titulo-seccion">
            <span className="cm-icono-titulo" style={{ '--c': COLOR.azul }}><ClipboardList size={16} /></span> Historial de visitas
            <small>Clic en una fila para ver el detalle</small>
          </h2>
          <div className="cm-vidrio cm-historial">
            <div className="cm-historial-cab">
              <div className="cm-filtros">
                {[['todas', 'Todas', COLOR.cian], ...Object.entries(CATEGORIAS).map(([k, c]) => [k, c.nombre, c.color])].map(([k, t, c]) => (
                  <button key={k} className={`cm-filtro ${estadoTabla === k ? 'on' : ''}`} style={{ '--c': c }} onClick={() => { setEstadoTabla(k); setPagina(0); }}>
                    {t} <b>{k === 'todas' ? visitas.length : visitas.filter((v) => categoria(v) === k).length}</b>
                  </button>
                ))}
              </div>
              <div className="cm-controles">
                <div className="cm-busqueda">
                  <Search size={15} />
                  <input className="cm-input" placeholder="Buscar supervisor, estado, texto…" value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPagina(0); }} />
                </div>
                <select className="cm-input" value={filtroSupervisor} onChange={(e) => { setFiltroSupervisor(e.target.value); setPagina(0); }}>
                  <option value="">Todos los supervisores</option>
                  {supervisores.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="cm-controles" style={{ marginBottom: 12 }}>
              <span className="cm-nota">Reporte:</span>
              <select className="cm-input" value={filtroCentro} onChange={(e) => setFiltroCentro(e.target.value)}>
                <option value="">Todos los centros</option>
                {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <input className="cm-input" type="date" title="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
              <input className="cm-input" type="date" title="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
              <a
                className="cm-btn-cta"
                href={`${API}/api/reporte.csv?token=${encodeURIComponent(token)}${filtroSupervisor ? `&supervisor=${encodeURIComponent(filtroSupervisor)}` : ""}${filtroCentro ? `&centro=${filtroCentro}` : ""}${desde ? `&desde=${desde}` : ""}${hasta ? `&hasta=${hasta}` : ""}`}
              >
                <Download size={16} /> Descargar reporte
              </a>
              <button className="cm-btn-sec" onClick={() => window.print()}><Printer size={16} /> Imprimir informe</button>
            </div>

            <div className="cm-tabla-wrap">
              <table className="cm-tabla">
                <thead>
                  <tr>
                    <th className={`ord ${orden.col === 'fecha' ? 'activa' : ''}`} onClick={() => ordenar('fecha')}>Llegada {flecha('fecha')}</th>
                    <th>Salida</th>
                    <th className={`ord ${orden.col === 'supervisor' ? 'activa' : ''}`} onClick={() => ordenar('supervisor')}>Supervisor {flecha('supervisor')}</th>
                    <th>Estado</th>
                    <th className={`ord ${orden.col === 'actividades' ? 'activa' : ''}`} onClick={() => ordenar('actividades')}>Actividades {flecha('actividades')}</th>
                    <th className={`ord ${orden.col === 'distancia' ? 'activa' : ''}`} onClick={() => ordenar('distancia')}>Distancia {flecha('distancia')}</th>
                    <th>Evidencia</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filasPagina.map((v, i) => {
                    const acts = parseActividades(v.actividades);
                    const cumplidas = acts.filter((a) => a.cumplida).length;
                    const pct = acts.length ? (cumplidas / acts.length) * 100 : 0;
                    const colorActs = pct === 100 ? COLOR.verde : pct >= 50 ? COLOR.ambar : COLOR.rojo;
                    return (
                      <tr key={v.id} style={{ animationDelay: `${i * 40}ms` }} onClick={() => setDetalleId(v.id)}>
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
                            ? <button className="cm-enlace" onClick={(e) => { e.stopPropagation(); setFotoAbierta(urlEvidencia(v.id)); }}><ImagenIcono size={14} /> Ver foto</button>
                            : "—"}
                        </td>
                        <td>
                          <button className="cm-btn-eliminar" title="Eliminar visita" onClick={(e) => { e.stopPropagation(); eliminarVisita(v); }}>
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filasPagina.length === 0 && (
                    <tr><td colSpan="8" style={{ textAlign: 'center', color: 'var(--suave)', padding: 30 }}>No hay visitas que coincidan con los filtros.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="cm-paginas">
              <span className="cm-nota">{filas.length} visita(s) · página {pag + 1} de {paginas}</span>
              <div className="cm-paginas-botones">
                <button className="cm-pag" disabled={pag === 0} onClick={() => setPagina(pag - 1)} aria-label="Anterior"><ChevronLeft size={16} /></button>
                {Array.from({ length: paginas }, (_, k) => (
                  <button key={k} className={`cm-pag ${k === pag ? 'on' : ''}`} onClick={() => setPagina(k)}>{k + 1}</button>
                ))}
                <button className="cm-pag" disabled={pag >= paginas - 1} onClick={() => setPagina(pag + 1)} aria-label="Siguiente"><ChevronRight size={16} /></button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {detalle && (
        <Detalle
          v={detalle} urlEvidencia={urlEvidencia}
          onCerrarPanel={() => setDetalleId(null)}
          onResolver={cerrarNovedad} onEliminar={eliminarVisita} onVerMapa={verEnMapa} onFoto={setFotoAbierta}
        />
      )}
      {fotoAbierta && (
        <div className="cm-visor" onClick={() => setFotoAbierta(null)}>
          <button className="cm-btn-icono" aria-label="Cerrar foto"><X size={18} /></button>
          <img src={fotoAbierta} alt="Evidencia ampliada" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
      <div className="cm-avisos">
        {avisos.map((a) => <Aviso key={a.clave} aviso={a} onCerrar={cerrarAviso} onClic={() => { setDetalleId(a.id); }} />)}
      </div>
      {fiesta && <Confeti onFin={() => setFiesta(false)} />}
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
          <div><Sparkles size={18} /> Alertas instantáneas, incluso con operación sin conexión</div>
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
    if (DEMO) return { token: 'demo', usuario: 'coordinador' };
    try { return JSON.parse(sessionStorage.getItem(CLAVE_SESION)); } catch { return null; }
  });

  const entrar = (datos) => {
    try { sessionStorage.setItem(CLAVE_SESION, JSON.stringify(datos)); } catch { /* sin almacenamiento */ }
    setSesion(datos);
  };
  const salir = useCallback(() => {
    try { sessionStorage.removeItem(CLAVE_SESION); } catch { /* sin almacenamiento */ }
    if (DEMO) { window.location.href = window.location.pathname; return; }
    setSesion(null);
  }, []);

  return sesion
    ? <Panel token={sesion.token} usuario={sesion.usuario} onSalir={salir} />
    : <Login onEntrar={entrar} />;
}
