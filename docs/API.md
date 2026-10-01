# Referencia del API

URL base en desarrollo: `http://localhost:8000`. Documentación interactiva (Swagger): `/docs`.

**Autenticación:** se envía `Authorization: Bearer <token>`. Hay dos roles con tokens distintos:
- **Supervisor** → `POST /api/login`
- **Coordinador** → `POST /api/login-coordinador`

Los endpoints del coordinador también aceptan `?token=<token>` (para imágenes y descargas).

Cuerpo de ambos logins: `{"usuario": "...", "pin": "..."}` → respuesta `{"token": "...", "usuario": "..."}`.

## Supervisor

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/login` | Inicia sesión de supervisor |
| `GET` | `/api/centros` | Centros de costo con su ubicación y radio (la app los guarda para uso offline) |
| `GET` | `/api/mis-asignaciones` | Visitas pendientes del supervisor autenticado |
| `POST` | `/api/sync-visitas` | Envía una visita (idempotente por `id`) |

### `POST /api/sync-visitas`
```json
{
  "id": "uuid generado en el celular",
  "centro_costo_id": "uuid",
  "id_supervisor": "se ignora: el servidor usa el del token",
  "estado": "Completado | Novedad",
  "observaciones": "texto",
  "latitud": 11.0090, "longitud": -74.7882,
  "fecha": "2026-10-01T18:00:00Z",
  "fecha_salida": "2026-10-01T18:25:00Z",
  "actividades": "[{\"nombre\":\"Desinfección\",\"cumplida\":true}]",
  "evidencia": "foto en base64 (JPEG)",
  "prioridad": "Alta | Media | Baja | null",
  "fecha_foto": "2026-10-01T18:20:00Z",
  "asignacion_id": "uuid | null"
}
```
Respuesta: `{"mensaje": "Sincronización exitosa", "id": "..."}`. La distancia al centro se calcula en el servidor; si supera `RADIO_MAXIMO_M` la visita queda con `fuera_de_rango = true`.

## Coordinador

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/login-coordinador` | Inicia sesión de coordinador |
| `GET` | `/api/visitas` | Últimas 200 visitas (sin la foto) |
| `GET` | `/api/visitas/{id}/evidencia` | Foto de la visita (JPEG con marca de agua) |
| `PATCH` | `/api/visitas/{id}/cerrar` | Cierra una novedad |
| `DELETE` | `/api/visitas/{id}` | Elimina una visita (definitivo) |
| `GET` | `/api/asignaciones` | Visitas programadas (`Pendiente`, `Realizada`, `Vencida`) |
| `POST` | `/api/asignaciones` | Programa una visita: `{"supervisor","centro_costo_id","programada"}` |
| `DELETE` | `/api/asignaciones/{id}` | Cancela una programación |
| `GET` | `/api/panel/centros` | Centros de costo para el panel |
| `GET` | `/api/panel/supervisores` | Lista de supervisores |
| `GET` | `/api/reporte.csv` | Reporte CSV. Parámetros opcionales: `supervisor`, `centro` (UUID), `desde` y `hasta` (`AAAA-MM-DD`, hora de Colombia) |

## Tiempo real

`WS /ws/dashboard?token=<token de coordinador>`: el servidor envía un JSON por cada evento (`visita`, `novedad`, `ubicacion`, `cierre`, `eliminada`, `asignacion`). El panel responde recargando los datos.
