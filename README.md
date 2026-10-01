# Supervisión Inteligente de Servicios en Campo

Sistema para **controlar, validar y dar trazabilidad** a las visitas que los supervisores hacen a centros de costo (edificios, conjuntos residenciales, etc.), incluso donde **no hay internet**.

Proyecto desarrollado para el reto de hackathon *"Supervisión inteligente de servicios en campo"*.

> **Idea central:** una foto no prueba que el supervisor estuvo en el lugar. Este sistema lo comprueba con GPS, hora, distancia al centro y una foto con marca de agua puesta por el servidor.

---

## Tabla de contenido

1. [Descripción del proyecto](#descripción-del-proyecto)
2. [Funcionalidades](#funcionalidades)
3. [Tecnologías utilizadas](#tecnologías-utilizadas)
4. [Arquitectura](#arquitectura)
5. [Requisitos](#requisitos)
6. [Clonar el repositorio](#clonar-el-repositorio)
7. [Instalación](#instalación)
8. [Ejecución](#ejecución)
9. [Usuarios de demostración](#usuarios-de-demostración)
10. [Guía rápida de uso](#guía-rápida-de-uso)
11. [Estructura del proyecto](#estructura-del-proyecto)
12. [Configuración](#configuración)
13. [Solución de problemas](#solución-de-problemas)
14. [Limitaciones y próximos pasos](#limitaciones-y-próximos-pasos)

---

## Descripción del proyecto

### El problema
Una empresa de aseo tiene supervisores que visitan periódicamente varios centros de costo. Los clientes reportan que, a veces, los supervisores no van. Los supervisores afirman haber ido y presentan fotos, pero **no existe un mecanismo que valide, registre y centralice** las visitas. Además, muchos centros tienen **conectividad limitada o nula**.

### La solución
Dos aplicaciones conectadas a un mismo servidor:

- **App móvil del supervisor** (funciona sin internet): registra llegada y salida con GPS, marca qué actividades se cumplieron, toma la evidencia fotográfica y reporta novedades. Todo se guarda en el celular y se **sincroniza solo** cuando vuelve la señal.
- **Panel web del coordinador** (tiempo real): programa visitas, ve en un mapa lo que ocurre en campo, recibe alertas de novedades, las cierra y descarga reportes.

## Funcionalidades

### App móvil (supervisor)
- Inicio de sesión con usuario y PIN (el servidor sabe quién es el supervisor).
- Lista de **visitas asignadas** por el coordinador.
- **Check-in / check-out** con GPS y hora del celular.
- **Aviso de lejanía:** si el supervisor está a más de 150 m del centro, la app lo advierte antes de registrar.
- Checklist de actividades: *cumplió / no cumplió* (obligatorio responder todas).
- Observaciones, **foto de evidencia** y reporte de **novedades** con prioridad (Alta / Media / Baja).
- **Modo sin conexión:** base de datos local (SQLite), contador de pendientes y **sincronización automática** sin duplicados.

### Panel web (coordinador)
- Inicio de sesión propio.
- Indicadores: visitas realizadas y pendientes, supervisores activos, novedades abiertas, visitas fuera de rango y porcentaje de cumplimiento.
- **Mapa** con los centros de costo (con su radio de validación) y las visitas por color de estado.
- **Alertas en tiempo real** (WebSocket) ordenadas por prioridad, con botón para cerrarlas.
- **Programación de visitas:** asigna supervisor, centro y fecha/hora; ve el estado (Pendiente / Realizada / Vencida).
- Historial de visitas con evidencias, filtro por supervisor y opción de eliminar.
- **Reporte CSV** (abre en Excel) filtrable por supervisor, centro de costo y rango de fechas.

### Medidas de confiabilidad
- El servidor calcula la **distancia real** (PostGIS) entre el GPS del supervisor y el centro de costo; si supera el radio, marca la visita como **fuera de rango** y alerta al coordinador (no la rechaza, para no perder datos de visitas hechas sin señal).
- La **marca de agua** de la foto (supervisor, fecha y hora, GPS, centro y distancia) la estampa el **servidor**, no el celular, para que no pueda manipularse.
- El supervisor se toma del **token de sesión**, no de lo que diga el celular.
- Cada visita lleva un **UUID** generado en el celular: reenviarla no la duplica.

## Tecnologías utilizadas

| Capa | Tecnología |
|---|---|
| App móvil | React Native, Expo (Expo Router), TypeScript, `expo-sqlite`, `expo-location`, `expo-image-picker` |
| Panel web | React, Vite, Leaflet / react-leaflet, lucide-react |
| Backend / API | Python, FastAPI, Uvicorn, SQLAlchemy, GeoAlchemy2, Pydantic, Pillow |
| Tiempo real | WebSocket (FastAPI) |
| Base de datos | PostgreSQL + PostGIS |
| Colas (reportes pesados) | Celery + Redis (base lista; uso experimental) |
| Infraestructura local | Docker y Docker Compose |
| Mapas | Teselas de Esri (ArcGIS) |

## Arquitectura

```
┌──────────────────┐  HTTPS/JSON   ┌───────────────────────┐        ┌──────────────────────┐
│  App móvil       │──────────────▶│  API FastAPI          │───────▶│  PostgreSQL + PostGIS │
│  (Expo, SQLite)  │  sync visitas │  - autenticación      │        │  centros, visitas,    │
│  funciona offline│◀──────────────│  - validación GPS     │        │  asignaciones         │
└──────────────────┘  asignaciones │  - marca de agua      │        └──────────────────────┘
                                   │  - reportes CSV       │
┌──────────────────┐  REST + WS    │                       │        ┌──────────────────────┐
│  Panel web       │◀─────────────▶│  WebSocket /ws        │───────▶│  Redis (Celery)      │
│  (React, Leaflet)│  tiempo real  └───────────────────────┘        └──────────────────────┘
└──────────────────┘
```

Más detalle en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) y en [`docs/API.md`](docs/API.md).

## Requisitos

| Herramienta | Versión recomendada | Para qué |
|---|---|---|
| [Git](https://git-scm.com/) | cualquiera reciente | clonar el repositorio |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | con Docker Compose v2 | base de datos y Redis |
| [Python](https://www.python.org/) | 3.11 o superior | backend |
| [Node.js](https://nodejs.org/) | 20 o superior (incluye npm) | panel web y app móvil |
| **Expo Go** en el celular | última versión (Android / iOS) | probar la app móvil |

Además: el **celular y el computador deben estar en la misma red Wi-Fi**, y el puerto **8000** del computador debe estar accesible (ver [firewall](#solución-de-problemas)).

## Clonar el repositorio

```bash
git clone https://github.com/brayan101576/supervision-inteligente.git
cd supervision-inteligente
```

## Instalación

Los comandos están escritos para **Windows (PowerShell)**; en Linux/macOS cambia solo la activación del entorno virtual (se indica abajo).

### 1. Base de datos y Redis
```bash
docker compose up -d
```
Crea PostgreSQL con PostGIS (puerto 5432) y Redis (puerto 6379). Espera unos segundos a que el contenedor `supervision_db` quede en estado *healthy* (`docker ps`).

### 2. Backend
```bash
cd backend
python -m venv venv
.\venv\Scripts\activate            # Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
cd ..
```

### 3. Panel web
```bash
cd frontend-web
npm install
cd ..
```

### 4. App móvil
```bash
cd mobile-app
npm install
copy .env.example .env             # Linux/macOS: cp .env.example .env
cd ..
```
Edita `mobile-app/.env` y pon la **IP de tu computador** en la red Wi-Fi (en Windows: `ipconfig`, línea *IPv4*):
```
EXPO_PUBLIC_API_URL=http://192.168.1.100:8000
```

> Las claves de desarrollo (base de datos, PIN) vienen con valores por defecto y no requieren más configuración. Ver [Configuración](#configuración) si quieres cambiarlas.

## Ejecución

Abre **tres terminales** (la base de datos ya quedó corriendo con `docker compose up -d`).

**Terminal 1 — Backend** (puerto 8000):
```bash
cd backend
.\venv\Scripts\activate            # Linux/macOS: source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload --timeout-graceful-shutdown 2
```
Debe mostrar `Application startup complete`. La documentación interactiva del API queda en <http://localhost:8000/docs>. Al arrancar crea las tablas y **3 centros de costo de ejemplo**.

**Terminal 2 — Panel web** (puerto 5173):
```bash
cd frontend-web
npm run dev
```
Abre <http://localhost:5173>.

**Terminal 3 — App móvil**:
```bash
cd mobile-app
npx expo start -c
```
Escanea el código QR con **Expo Go** en tu celular.

### Datos de ejemplo (opcional, recomendado para una demo)
Con el backend corriendo y **al menos una visita real registrada** (para fijar la ubicación de referencia), en otra terminal:
```bash
cd backend
.\venv\Scripts\activate
python seed_demo.py
```
Carga 6 visitas de muestra (con novedades y una visita fuera de rango).

### Worker de Celery (opcional, experimental)
```bash
cd workers
..\backend\venv\Scripts\celery -A celery_worker worker --loglevel=info --pool=solo
```

## Usuarios de demostración

> Solo para desarrollo. Están definidos en `backend/main.py` y deben reemplazarse (con claves cifradas en la base de datos) antes de usar el sistema en producción.

| Rol | Usuario | Clave / PIN | Dónde se usa |
|---|---|---|---|
| Coordinador | `coordinador` | `coord123` | Panel web |
| Supervisor | `brayan` | `1234` | App móvil |
| Supervisor | `maria` | `5678` | App móvil |

## Guía rápida de uso

1. **Panel:** inicia sesión como `coordinador`. En *Programación de visitas* asigna una visita a `brayan` en un centro de costo.
2. **Celular:** entra como `brayan`. Aparece la visita en *Mis visitas asignadas*; tócala y pulsa **Check-in**.
3. Marca cada actividad como *cumplió / no cumplió*, escribe observaciones, toma la **foto**, indica si hay **novedad** (con prioridad) y pulsa **Check-out**.
4. La visita se guarda en el celular y se envía sola. Mira cómo aparece en el panel en tiempo real, con la foto marcada.
5. **Prueba sin internet:** activa el modo avión, haz otra visita y desactívalo: se sincroniza automáticamente.
6. **Prueba antifraude:** mueve un centro de costo lejos de tu posición (ver abajo) y haz el check-in: la app advierte la lejanía y el panel marca la visita como *fuera de rango*.

Para mover un centro de costo ~2 km al norte (solo para probar):
```bash
docker exec -it supervision_db psql -U admin -d supervision_geodb -c "UPDATE centros_costo SET ubicacion = ST_Translate(ubicacion, 0, 0.02) WHERE nombre = 'Centro Principal';"
```

## Estructura del proyecto

```
supervision-inteligente/
├── backend/               # API FastAPI
│   ├── main.py            #   endpoints, autenticación, WebSocket, reportes
│   ├── models.py          #   tablas (centros, visitas, asignaciones)
│   ├── schemas.py         #   validación de datos de entrada
│   ├── database.py        #   conexión a PostgreSQL
│   ├── marca_agua.py      #   marca de agua de las fotos
│   ├── seed_demo.py       #   datos de ejemplo
│   └── requirements.txt
├── frontend-web/          # Panel del coordinador (React + Vite)
│   └── src/App.jsx, panel.css
├── mobile-app/            # App del supervisor (Expo)
│   └── src/app/index.tsx, src/database/db.ts
├── workers/               # Tareas en segundo plano (Celery)
├── docs/                  # Arquitectura y referencia del API
├── docker-compose.yml     # PostgreSQL/PostGIS + Redis
└── .env.example
```

## Configuración

| Variable | Dónde | Por defecto | Descripción |
|---|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `.env` junto a `docker-compose.yml` | `admin`, `supersecretpassword`, `supervision_geodb` | Credenciales de la base de datos |
| `DATABASE_URL` | entorno del backend | conexión local al contenedor | Cadena de conexión de SQLAlchemy |
| `TOKEN_SECRET` | entorno del backend | `cambiar-en-produccion` | Clave con la que se firman los tokens |
| `RADIO_MAXIMO_M` | entorno del backend | `150` | Distancia máxima (m) al centro para no marcar "fuera de rango" |
| `EXPO_PUBLIC_API_URL` | `mobile-app/.env` | `http://localhost:8000` | URL del API vista desde el celular |
| `VITE_API_URL` | `frontend-web/.env` | `http://localhost:8000` | URL del API vista desde el navegador |

Si cambias las credenciales de PostgreSQL en `.env`, define también `DATABASE_URL` en la terminal del backend con los mismos datos.

## Solución de problemas

- **La app móvil se queda en "Cargando…" o no sincroniza:** comprueba que `EXPO_PUBLIC_API_URL` tenga la IP del computador (no `localhost`), que ambos estén en la misma red Wi-Fi y que abras `http://<IP>:8000/docs` desde el navegador del celular.
- **Windows bloquea el puerto 8000:** abre PowerShell **como administrador** y ejecuta
  `netsh advfirewall firewall add rule name="API Supervision" dir=in action=allow protocol=TCP localport=8000`
- **El backend se queda colgado al recargar (`--reload`):** pasa si el panel mantiene un WebSocket abierto. Detén con `Ctrl+C` y vuelve a lanzar; el parámetro `--timeout-graceful-shutdown 2` lo minimiza.
- **El mapa se ve gris:** revisa tu conexión a internet; las teselas vienen de Esri.
- **`docker compose` no encuentra el contenedor o falla el puerto 5432:** otro PostgreSQL local puede estar usando el puerto; deténlo o cambia el puerto en `docker-compose.yml`.
- **Reiniciar la base de datos desde cero:** `docker compose down`, borra la carpeta `postgres_data/` y vuelve a ejecutar `docker compose up -d`.

## Limitaciones y próximos pasos

Este es un **prototipo de hackathon**. Pendientes conocidos:

- Usuarios y PIN definidos en el código; en producción deben vivir cifrados en la base de datos, con recuperación de clave y registro de accesos.
- No detecta aplicaciones de **GPS falso**; se propone leer la bandera de ubicación simulada y contrastar con la red del celular.
- Las notificaciones al coordinador son dentro del panel (no push ni correo).
- La lista de actividades a verificar es fija; debería configurarse por centro de costo.
- El borrado de visitas es definitivo; en producción conviene "archivar" con registro de auditoría.
- Reportes en CSV; falta exportación a PDF/Excel nativo.
- Despliegue en la nube (HTTPS, variables de entorno gestionadas, copias de seguridad).
