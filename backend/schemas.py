from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID

class VisitaSync(BaseModel):
    id: UUID
    centro_costo_id: UUID
    id_supervisor: str
    estado: str
    observaciones: Optional[str] = None
    # Recibiremos latitud y longitud simples desde el celular, 
    # y nuestro backend los convertirá al formato espacial de PostGIS
    latitud: float
    longitud: float
    fecha: Optional[datetime] = None
    fecha_salida: Optional[datetime] = None
    actividades: Optional[str] = None
    evidencia: Optional[str] = None
    prioridad: Optional[str] = None
    fecha_foto: Optional[datetime] = None
    asignacion_id: Optional[UUID] = None


class AsignacionIn(BaseModel):
    centro_costo_id: UUID
    supervisor: str
    programada: datetime


class LoginIn(BaseModel):
    usuario: str
    pin: str
