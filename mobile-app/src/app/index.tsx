import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Alert, ScrollView, TextInput, Image,
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import {
  initDB, guardarVisitaLocal, obtenerVisitasPendientes, marcarComoSincronizado,
  guardarSesion, leerSesion, borrarSesion, guardarCentros, leerCentros, Centro,
  guardarAsignaciones, leerAsignaciones, Asignacion,
} from '../database/db';

// Se configura en mobile-app/.env (ver .env.example). En un celular real debe ser la IP de tu PC en la red Wi-Fi.
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
const CENTRO_ID = "123e4567-e89b-12d3-a456-426614174000";
const ACTIVIDADES = ["Limpieza de áreas comunes", "Recolección de residuos", "Desinfección"];
// Distancia en metros entre dos coordenadas (fórmula de Haversine)
const distanciaM = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const rad = (g: number) => (g * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const PRIORIDADES = ["Baja", "Media", "Alta"];

export default function IndexScreen() {
  const [permiso, setPermiso] = useState<boolean | null>(null);
  const [location, setLocation] = useState<any>(null);
  const [pendientes, setPendientes] = useState(0);
  const [sesion, setSesion] = useState<{ usuario: string; token: string } | null>(null);
  const [centros, setCentros] = useState<Centro[]>([]);
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([]);
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [mensajeSync, setMensajeSync] = useState("");
  const sincronizandoRef = useRef(false);
  const [cargando, setCargando] = useState(true);
  const [loginUsuario, setLoginUsuario] = useState("");
  const [loginPin, setLoginPin] = useState("");

  // Visita en curso (null = no hay check-in)
  const [visita, setVisita] = useState<{
    id: string; llegada: string; lat: number; lon: number; centro_id: string | null; asignacion_id: string | null;
  } | null>(null);
  const [cumplidas, setCumplidas] = useState<(boolean | null)[]>(ACTIVIDADES.map(() => null));
  const [observaciones, setObservaciones] = useState("");
  const [foto, setFoto] = useState<{ uri: string; base64: string; fecha: string } | null>(null);
  const [hayNovedad, setHayNovedad] = useState(false);
  const [prioridad, setPrioridad] = useState("Media");

  useEffect(() => {
    (async () => {
      await initDB();
      await contarPendientes();
      const ses = await leerSesion();
      setSesion(ses);
      setCentros(await leerCentros());
      setAsignaciones(await leerAsignaciones());
      setCargando(false);
      if (ses) refrescarDatos(ses.token); // en segundo plano: no bloquea la pantalla
      const loc = await Location.requestForegroundPermissionsAsync();
      setPermiso(loc.status === 'granted');
      if (loc.status === 'granted') await actualizarGPS();
    })();
  }, []);

  // Descarga centros y visitas asignadas y los guarda para usarlos sin internet.
  const refrescarDatos = async (token: string) => {
    const pedir = async (ruta: string) => {
      const corte = new AbortController();
      const temporizador = setTimeout(() => corte.abort(), 3000);
      try {
        const res = await fetch(`${API_BASE}${ruta}`, { headers: { Authorization: `Bearer ${token}` }, signal: corte.signal });
        return res.ok ? await res.json() : null;
      } finally {
        clearTimeout(temporizador);
      }
    };
    try {
      const nuevosCentros: Centro[] | null = await pedir('/api/centros');
      const nuevasAsig: Asignacion[] | null = await pedir('/api/mis-asignaciones');
      if (nuevosCentros) { await guardarCentros(nuevosCentros); setCentros(nuevosCentros); }
      if (nuevasAsig) {
        await guardarAsignaciones(nuevasAsig);
        setAsignaciones(nuevasAsig);
        setSeleccionada(sel => (sel && nuevasAsig.some(a => a.id === sel) ? sel : null));
      }
      return { centros: nuevosCentros, asignaciones: nuevasAsig };
    } catch {
      return null; // sin conexión: se usan las copias guardadas
    }
  };

  const iniciarSesion = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: loginUsuario.trim().toLowerCase(), pin: loginPin }),
      });
      if (!res.ok) {
        Alert.alert("Error", "Usuario o PIN incorrecto.");
        return;
      }
      const d = await res.json();
      await guardarSesion(d.usuario, d.token);
      setSesion({ usuario: d.usuario, token: d.token });
      refrescarDatos(d.token);
      setLoginPin("");
    } catch {
      Alert.alert("Sin conexión", "El primer inicio de sesión necesita internet.");
    }
  };

  const cerrarSesion = async () => {
    await borrarSesion();
    setSesion(null);
  };

  const actualizarGPS = async () => {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setLocation(pos.coords);
    return pos.coords;
  };

  const contarPendientes = async () => setPendientes((await obtenerVisitasPendientes()).length);

  const hacerCheckIn = async () => {
    let coords;
    try {
      coords = await actualizarGPS();
    } catch {
      Alert.alert("Error", "No se pudo obtener el GPS. Intenta de nuevo.");
      return;
    }
    // Si hay internet, se usan los datos más recientes; si no, las copias guardadas en el celular.
    const frescos = sesion ? await refrescarDatos(sesion.token) : null;
    const listaCentros = frescos?.centros ?? centros;
    const listaAsig = frescos?.asignaciones ?? asignaciones;

    // Centro contra el que se valida: el de la visita asignada, o el más cercano si es una visita libre.
    const asig = listaAsig.find(a => a.id === seleccionada) ?? null;
    const centroActual: Centro | null = asig
      ? listaCentros.find(c => c.id === asig.centro_id) ?? null
      : listaCentros.reduce<Centro | null>((mejor, c) => (
          !mejor || distanciaM(coords.latitude, coords.longitude, c.lat, c.lon) <
            distanciaM(coords.latitude, coords.longitude, mejor.lat, mejor.lon) ? c : mejor
        ), null);

    const iniciar = () => {
      setVisita({
        id: Crypto.randomUUID(),
        llegada: new Date().toISOString(),
        lat: coords.latitude,
        lon: coords.longitude,
        centro_id: centroActual?.id ?? null,
        asignacion_id: asig?.id ?? null,
      });
      Alert.alert("Check-in registrado", `${centroActual ? centroActual.nombre + " · " : ""}Hora: ${new Date().toLocaleTimeString()}`);
    };

    if (centroActual) {
      const d = Math.round(distanciaM(coords.latitude, coords.longitude, centroActual.lat, centroActual.lon));
      if (d > centroActual.radio_m) {
        Alert.alert(
          "⚠️ Estás lejos del centro",
          `Estás a ${d} m de "${centroActual.nombre}" (máximo ${centroActual.radio_m} m). Si registras la visita desde aquí, quedará marcada como FUERA DE RANGO y se avisará al coordinador.`,
          [
            { text: "Cancelar", style: "cancel" },
            { text: "Registrar de todos modos", style: "destructive", onPress: iniciar },
          ]
        );
        return;
      }
    }
    iniciar();
  };

  const tomarFoto = async () => {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) {
      Alert.alert("Permiso", "Se necesita la cámara para la evidencia.");
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.3, base64: true });
    if (!r.canceled && r.assets[0].base64) {
      setFoto({ uri: r.assets[0].uri, base64: r.assets[0].base64, fecha: new Date().toISOString() });
    }
  };

  const hacerCheckOut = async () => {
    if (!visita) return;
    const sinResponder = ACTIVIDADES.filter((_, i) => cumplidas[i] === null);
    if (sinResponder.length > 0) {
      Alert.alert("Faltan actividades", "Marca si cumplió o no cada una: " + sinResponder.join(", "));
      return;
    }
    if (!foto) {
      Alert.alert("Falta evidencia", "Toma una foto antes de finalizar la visita.");
      return;
    }
    try {
      const actividades = ACTIVIDADES.map((nombre, i) => ({ nombre, cumplida: cumplidas[i] }));
      await guardarVisitaLocal({
        id: visita.id,
        id_supervisor: sesion!.usuario,
        centro_costo_id: visita.centro_id ?? CENTRO_ID,
        estado: hayNovedad ? "Novedad" : "Completado",
        latitud: visita.lat,
        longitud: visita.lon,
        fecha_llegada: visita.llegada,
        fecha_salida: new Date().toISOString(),
        observaciones,
        actividades: JSON.stringify(actividades),
        evidencia: foto.base64,
        prioridad: hayNovedad ? prioridad : null,
        fecha_foto: foto.fecha,
        asignacion_id: visita.asignacion_id,
      });
      setSeleccionada(null);
      setVisita(null);
      setFoto(null);
      setObservaciones("");
      setHayNovedad(false);
      setCumplidas(ACTIVIDADES.map(() => null));
      await contarPendientes();
      Alert.alert("Visita guardada", "Guardada en el celular. Se enviará automáticamente en cuanto haya internet.");
      sincronizar(true); // intento inmediato; si no hay internet, el temporizador lo reintenta
    } catch {
      Alert.alert("Error", "No se pudo guardar la visita.");
    }
  };

  // silencioso = true: intento automático, sin ventanas de error si no hay conexión
  const sincronizar = async (silencioso = false) => {
    if (sincronizandoRef.current || !sesion) return;
    sincronizandoRef.current = true;
    try {
      const lista = await obtenerVisitasPendientes();
      if (lista.length === 0) {
        if (!silencioso) Alert.alert("Info", "No hay visitas pendientes.");
        return;
      }
      let fallidas = 0;
      let subidas = 0;
      for (const v of lista) {
        const corte = new AbortController();
        const temporizador = setTimeout(() => corte.abort(), 20000);
        let res;
        try {
          res = await fetch(`${API_BASE}/api/sync-visitas`, {
          method: 'POST',
          signal: corte.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sesion.token}` },
          body: JSON.stringify({
            id: v.id,
            centro_costo_id: v.centro_costo_id,
            id_supervisor: v.id_supervisor,
            estado: v.estado,
            observaciones: v.observaciones,
            latitud: v.latitud,
            longitud: v.longitud,
            fecha: v.fecha_llegada,
            fecha_salida: v.fecha_salida,
            actividades: v.actividades,
            evidencia: v.evidencia,
            prioridad: v.prioridad,
            fecha_foto: v.fecha_foto,
            asignacion_id: v.asignacion_id,
          }),
          });
        } finally {
          clearTimeout(temporizador);
        }
        if (res.ok) { await marcarComoSincronizado(v.id); subidas++; }
        else if (res.status === 401) {
          await cerrarSesion();
          Alert.alert("Sesión vencida", "Inicia sesión de nuevo. Tus visitas siguen guardadas.");
          return;
        } else fallidas++;
      }
      await contarPendientes();
      if (subidas > 0) {
        setMensajeSync(`✅ ${subidas} visita(s) enviada(s) a las ${new Date().toLocaleTimeString()}`);
        refrescarDatos(sesion.token);
      }
      if (!silencioso) {
        if (fallidas > 0) Alert.alert("Sincronización parcial", `${fallidas} visita(s) no se pudieron subir. Siguen en el celular.`);
        else Alert.alert("¡Sincronizado!", "Los datos se subieron al servidor central.");
      }
    } catch {
      if (!silencioso) Alert.alert("Sin conexión", "No se pudo conectar. Los datos siguen seguros en el celular.");
    } finally {
      sincronizandoRef.current = false;
    }
  };

  // Sincronización automática: cada 20 s intenta enviar lo pendiente y actualizar las visitas asignadas.
  const sincronizarRef = useRef(sincronizar);
  sincronizarRef.current = sincronizar;
  const refrescarRef = useRef(refrescarDatos);
  refrescarRef.current = refrescarDatos;
  useEffect(() => {
    if (!sesion) return;
    const id = setInterval(() => {
      sincronizarRef.current(true);
      refrescarRef.current(sesion.token);
    }, 20000);
    return () => clearInterval(id);
  }, [sesion]);

  if (cargando) return <View style={s.container}><Text>Cargando...</Text></View>;

  if (!sesion) {
    return (
      <View style={s.container}>
        <View style={s.card}>
          <Text style={s.title}>Iniciar sesión</Text>
          <TextInput style={s.inputLine} placeholder="Usuario" autoCapitalize="none" value={loginUsuario} onChangeText={setLoginUsuario} />
          <TextInput style={s.inputLine} placeholder="PIN" secureTextEntry keyboardType="number-pad" value={loginPin} onChangeText={setLoginPin} />
          <TouchableOpacity style={s.btnPrimary} onPress={iniciarSesion}>
            <Text style={s.btnText}>Entrar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (permiso === null) return <View style={s.container}><Text>Pidiendo permisos...</Text></View>;
  if (permiso === false) return <View style={s.container}><Text>Se necesita acceso al GPS</Text></View>;

  return (
    <ScrollView contentContainerStyle={s.container}>
      <View style={s.card}>
        <Text style={s.title}>Supervisión en Campo</Text>
        <Text style={s.subtitle}>Supervisor: {sesion.usuario}</Text>
        <Text style={s.subtitle}>GPS: {location ? "Activo 🟢" : "Buscando 🔴"}</Text>
        <Text style={s.counter}>Pendientes de subir: {pendientes}</Text>
        {mensajeSync !== "" && <Text style={s.okSync}>{mensajeSync}</Text>}

        {!visita ? (
          <>
            <Text style={s.section}>Mis visitas asignadas</Text>
            {asignaciones.length === 0 && (
              <Text style={s.subtitle}>
                No tienes visitas asignadas. Puedes registrar una visita libre (se valida contra el centro más cercano).
              </Text>
            )}
            {asignaciones.map(a => {
              const cuando = new Date(a.programada + 'Z');
              const vencida = cuando.getTime() < Date.now();
              const activa = seleccionada === a.id;
              return (
                <TouchableOpacity
                  key={a.id}
                  style={[s.asignacion, activa && s.asignacionOn]}
                  onPress={() => setSeleccionada(activa ? null : a.id)}
                >
                  <Text style={s.asignacionCentro}>{activa ? "✔ " : ""}{a.centro}</Text>
                  <Text style={s.asignacionHora}>
                    {cuando.toLocaleString()} {vencida ? "· ⏰ vencida" : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={s.btnPrimary} onPress={hacerCheckIn}>
              <Text style={s.btnText}>
                {seleccionada ? "📍 Check-in en la visita elegida" : "📍 Check-in (visita libre)"}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={s.section}>Actividades verificadas</Text>
            {ACTIVIDADES.map((nombre, i) => (
              <View key={nombre} style={s.actividad}>
                <Text style={s.actNombre}>{nombre}</Text>
                <View style={s.fila}>
                  <TouchableOpacity
                    style={[s.opcion, cumplidas[i] === true && s.opcionSi]}
                    onPress={() => setCumplidas(c => c.map((x, j) => (j === i ? true : x)))}
                  >
                    <Text style={cumplidas[i] === true ? s.opcionTextoOn : s.opcionTexto}>✅ Cumplió</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.opcion, cumplidas[i] === false && s.opcionNo]}
                    onPress={() => setCumplidas(c => c.map((x, j) => (j === i ? false : x)))}
                  >
                    <Text style={cumplidas[i] === false ? s.opcionTextoOn : s.opcionTexto}>❌ No cumplió</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <Text style={s.section}>Observaciones</Text>
            <TextInput
              style={s.input}
              multiline
              placeholder="Escribe lo que encontraste..."
              value={observaciones}
              onChangeText={setObservaciones}
            />

            <TouchableOpacity style={s.btnSecondary} onPress={tomarFoto}>
              <Text style={s.btnTextDark}>{foto ? "📷 Cambiar foto" : "📷 Tomar foto de evidencia"}</Text>
            </TouchableOpacity>
            {foto && <Image source={{ uri: foto.uri }} style={s.foto} />}

            <TouchableOpacity
              style={[s.actividad, hayNovedad ? s.fail : s.ok]}
              onPress={() => setHayNovedad(!hayNovedad)}
            >
              <Text style={s.actText}>{hayNovedad ? "⚠️ HAY NOVEDAD (toca para quitar)" : "Sin novedad (toca para reportar una)"}</Text>
            </TouchableOpacity>
            {hayNovedad && (
              <View style={s.fila}>
                {PRIORIDADES.map(p => (
                  <TouchableOpacity key={p} style={[s.chip, prioridad === p && s.chipOn]} onPress={() => setPrioridad(p)}>
                    <Text style={prioridad === p ? s.chipTextOn : s.chipText}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <TouchableOpacity style={s.btnPrimary} onPress={hacerCheckOut}>
              <Text style={s.btnText}>🚪 Check-out (finalizar visita)</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={s.btnSecondary} onPress={() => sincronizar(false)}>
          <Text style={s.btnTextDark}>Sincronizar ahora ☁️</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={cerrarSesion}>
          <Text style={s.link}>Cerrar sesión</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#f5f5f5', padding: 20, justifyContent: 'center' },
  card: { backgroundColor: 'white', padding: 20, borderRadius: 10, elevation: 3 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 5 },
  subtitle: { fontSize: 14, color: 'gray', marginBottom: 3 },
  counter: { fontSize: 14, fontWeight: '600', color: '#d9534f', marginVertical: 8 },
  okSync: { fontSize: 12, color: '#137333', marginBottom: 6 },
  asignacion: { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', marginBottom: 8, backgroundColor: '#fafafa' },
  asignacionOn: { borderColor: '#007bff', backgroundColor: '#e8f1ff' },
  asignacionCentro: { fontSize: 15, fontWeight: '700' },
  asignacionHora: { fontSize: 12, color: 'gray', marginTop: 2 },
  section: { fontSize: 15, fontWeight: 'bold', marginTop: 12, marginBottom: 6 },
  actividad: { padding: 12, borderRadius: 6, marginBottom: 6, backgroundColor: '#f7f7f7' },
  actNombre: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  opcion: { flex: 1, padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#ccc', alignItems: 'center', backgroundColor: 'white' },
  opcionSi: { backgroundColor: '#137333', borderColor: '#137333' },
  opcionNo: { backgroundColor: '#d9534f', borderColor: '#d9534f' },
  opcionTexto: { color: '#333' },
  opcionTextoOn: { color: 'white', fontWeight: 'bold' },
  ok: { backgroundColor: '#e6f4ea' },
  fail: { backgroundColor: '#fdecea' },
  actText: { fontSize: 14 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10, minHeight: 70, textAlignVertical: 'top', marginBottom: 10 },
  foto: { width: '100%', height: 160, borderRadius: 6, marginBottom: 10 },
  fila: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  chip: { flex: 1, padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#ccc', alignItems: 'center' },
  chipOn: { backgroundColor: '#d9534f', borderColor: '#d9534f' },
  chipText: { color: '#333' },
  chipTextOn: { color: 'white', fontWeight: 'bold' },
  btnPrimary: { backgroundColor: '#007bff', padding: 15, borderRadius: 5, alignItems: 'center', marginVertical: 8 },
  btnSecondary: { backgroundColor: '#e9ecef', padding: 15, borderRadius: 5, alignItems: 'center', marginVertical: 8 },
  inputLine: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 12, marginTop: 10 },
  link: { textAlign: 'center', color: 'gray', marginTop: 6 },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  btnTextDark: { color: '#333', fontWeight: 'bold', fontSize: 16 },
});
