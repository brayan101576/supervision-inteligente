# Arquitectura

## Componentes

| Componente | Carpeta | Responsabilidad |
|---|---|---|
| App móvil | `mobile-app/` | Captura de visitas en campo, almacenamiento local y sincronización |
| Panel web | `frontend-web/` | Programación, monitoreo en tiempo real, cierre de novedades y reportes |
| API | `backend/` | Reglas de negocio, autenticación, validación de ubicación, marca de agua y reportes |
| Base de datos | `docker-compose.yml` | PostgreSQL + PostGIS para datos y cálculo geográfico |
| Redis / Celery | `docker-compose.yml`, `workers/` | Cola para tareas pesadas (generación de reportes) — uso experimental |

## Modelo de datos

- **`centros_costo`**: `id (UUID)`, `nombre`, `ubicacion (POINT, SRID 4326)`.
- **`visitas_supervision`**: `id (UUID, generado en el celular)`, `centro_costo_id`, `id_supervisor`, `fecha_llegada`, `fecha_salida`, `estado` (`Completado` / `Novedad`), `prioridad`, `observaciones`, `actividades (JSON)`, `evidencia (base64)`, `ubicacion (POINT)`, `distancia_m`, `fuera_de_rango`, `cerrada`.
- **`asignaciones`**: `id`, `centro_costo_id`, `supervisor`, `programada`, `estado` (`Pendiente` / `Realizada`; `Vencida` se calcula), `visita_id`.

## Flujo de una visita

1. El coordinador crea una **asignación** (panel → `POST /api/asignaciones`).
2. La app descarga centros y asignaciones del supervisor y los **guarda en SQLite** para usarlos sin internet.
3. En el check-in la app compara el GPS con el centro y advierte si está lejos.
4. Al hacer check-out, la visita se guarda **localmente** con un UUID y queda como pendiente.
5. Un temporizador (cada 20 s) y el propio check-out intentan enviar las pendientes a `POST /api/sync-visitas`.
6. El servidor: autentica al supervisor, calcula la distancia con PostGIS, estampa la marca de agua en la foto, hace *upsert* por UUID (sin duplicados), marca la asignación como `Realizada` y emite un evento por WebSocket.
7. El panel recibe el evento y recarga la información; las novedades y visitas fuera de rango aparecen como alertas hasta que el coordinador las cierra.

## Decisiones de diseño

- **Offline-first:** el celular es la fuente de la verdad hasta que sincroniza; el UUID del cliente garantiza idempotencia.
- **El servidor valida, el celular informa:** la distancia, la identidad del supervisor y la marca de agua las decide el servidor.
- **No rechazar visitas lejanas:** se aceptan y se marcan, para no perder el trabajo de un supervisor que sí fue pero tuvo mala señal GPS. El coordinador decide.
- **Autenticación por token firmado (HMAC)** con roles separados: un token de supervisor no sirve en el panel y viceversa. Las imágenes y descargas del panel aceptan el token por `?token=` porque el navegador no puede enviar encabezados en esas peticiones.
- **WebSocket de un solo proceso:** el gestor de conexiones vive en memoria; para varios procesos habría que usar Redis pub/sub.
