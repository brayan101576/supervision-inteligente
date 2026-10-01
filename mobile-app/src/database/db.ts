import * as SQLite from 'expo-sqlite';

// Nombre nuevo (v2) porque el esquema cambió; la base vieja queda sin usar.
const DB_NAME = 'supervision_v2.db';
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const getDB = () => {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  return dbPromise;
};

export type VisitaLocal = {
  id: string;
  id_supervisor: string;
  centro_costo_id: string;
  estado: string;
  latitud: number;
  longitud: number;
  fecha_llegada: string;
  fecha_salida: string;
  observaciones: string;
  actividades: string; // JSON
  evidencia: string | null; // base64
  prioridad: string | null;
  fecha_foto: string | null;
  asignacion_id: string | null;
  sincronizado?: number;
};

export type Asignacion = {
  id: string;
  centro_id: string;
  centro: string;
  programada: string; // UTC sin zona, ISO
  estado: string;
};

export const initDB = async () => {
  const db = await getDB();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS visitas (
      id TEXT PRIMARY KEY,
      id_supervisor TEXT,
      centro_costo_id TEXT,
      estado TEXT,
      latitud REAL,
      longitud REAL,
      fecha_llegada TEXT,
      fecha_salida TEXT,
      observaciones TEXT,
      actividades TEXT,
      evidencia TEXT,
      prioridad TEXT,
      sincronizado INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sesion (clave TEXT PRIMARY KEY, valor TEXT);
    CREATE TABLE IF NOT EXISTS centros (id TEXT PRIMARY KEY, nombre TEXT, lat REAL, lon REAL, radio_m REAL);
    CREATE TABLE IF NOT EXISTS asignaciones (id TEXT PRIMARY KEY, centro_id TEXT, centro TEXT, programada TEXT, estado TEXT);
  `);
  // Migraciones: columnas agregadas después de la primera versión (fallan sin problema si ya existen)
  try { await db.execAsync('ALTER TABLE visitas ADD COLUMN fecha_foto TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE visitas ADD COLUMN asignacion_id TEXT'); } catch {}
};

export const guardarAsignaciones = async (lista: Asignacion[]) => {
  const db = await getDB();
  await db.runAsync('DELETE FROM asignaciones');
  for (const a of lista) {
    await db.runAsync('INSERT INTO asignaciones (id, centro_id, centro, programada, estado) VALUES (?, ?, ?, ?, ?)',
      a.id, a.centro_id, a.centro, a.programada, a.estado);
  }
};

export const leerAsignaciones = async (): Promise<Asignacion[]> => {
  const db = await getDB();
  return await db.getAllAsync<Asignacion>('SELECT * FROM asignaciones ORDER BY programada');
};

export type Centro = { id: string; nombre: string; lat: number; lon: number; radio_m: number };

export const guardarCentros = async (centros: Centro[]) => {
  const db = await getDB();
  await db.runAsync('DELETE FROM centros');
  for (const c of centros) {
    await db.runAsync('INSERT INTO centros (id, nombre, lat, lon, radio_m) VALUES (?, ?, ?, ?, ?)',
      c.id, c.nombre, c.lat, c.lon, c.radio_m);
  }
};

export const leerCentros = async (): Promise<Centro[]> => {
  const db = await getDB();
  return await db.getAllAsync<Centro>('SELECT * FROM centros');
};

export const guardarSesion = async (usuario: string, token: string) => {
  const db = await getDB();
  await db.runAsync("INSERT OR REPLACE INTO sesion (clave, valor) VALUES ('usuario', ?), ('token', ?)", usuario, token);
};

export const leerSesion = async (): Promise<{ usuario: string; token: string } | null> => {
  const db = await getDB();
  const filas = await db.getAllAsync<{ clave: string; valor: string }>('SELECT * FROM sesion');
  const u = filas.find(f => f.clave === 'usuario')?.valor;
  const t = filas.find(f => f.clave === 'token')?.valor;
  return u && t ? { usuario: u, token: t } : null;
};

export const borrarSesion = async () => {
  const db = await getDB();
  await db.runAsync('DELETE FROM sesion');
};

export const guardarVisitaLocal = async (v: VisitaLocal) => {
  const db = await getDB();
  await db.runAsync(
    `INSERT INTO visitas (id, id_supervisor, centro_costo_id, estado, latitud, longitud,
      fecha_llegada, fecha_salida, observaciones, actividades, evidencia, prioridad, fecha_foto, asignacion_id, sincronizado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    v.id, v.id_supervisor, v.centro_costo_id, v.estado, v.latitud, v.longitud,
    v.fecha_llegada, v.fecha_salida, v.observaciones, v.actividades, v.evidencia, v.prioridad, v.fecha_foto, v.asignacion_id
  );
};

export const obtenerVisitasPendientes = async (): Promise<VisitaLocal[]> => {
  const db = await getDB();
  return await db.getAllAsync<VisitaLocal>('SELECT * FROM visitas WHERE sincronizado = 0');
};

export const marcarComoSincronizado = async (id: string) => {
  const db = await getDB();
  await db.runAsync('UPDATE visitas SET sincronizado = 1 WHERE id = ?', id);
};
