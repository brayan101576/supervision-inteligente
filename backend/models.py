import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from geoalchemy2 import Geometry
from database import Base, engine

class CentroCosto(Base):
    __tablename__ = "centros_costo"

    # ID único generado automáticamente
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nombre = Column(String, index=True)
    
    # Campo espacial para geolocalización. SRID 4326 es el estándar mundial de GPS
    ubicacion = Column(Geometry('POINT', srid=4326))

class VisitaSupervision(Base):
    __tablename__ = "visitas_supervision"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    centro_costo_id = Column(UUID(as_uuid=True), ForeignKey("centros_costo.id"))
    id_supervisor = Column(String, index=True)
    
    fecha_llegada = Column(DateTime, server_default=func.now())
    estado = Column(String, default="Pendiente") 
    observaciones = Column(Text, nullable=True)
    ubicacion = Column(Geometry('POINT', srid=4326), nullable=True)
    fecha_salida = Column(DateTime, nullable=True)
    actividades = Column(Text, nullable=True)   # JSON: [{"nombre":..., "cumplida":true}]
    evidencia = Column(Text, nullable=True)     # foto en base64
    prioridad = Column(String, nullable=True)   # Alta / Media / Baja (solo novedades)
    cerrada = Column(Boolean, default=False)
    distancia_m = Column(Float, nullable=True)
    fuera_de_rango = Column(Boolean, default=False)


class Asignacion(Base):
    """Visita programada por el coordinador para un supervisor en un centro de costo."""
    __tablename__ = "asignaciones"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    centro_costo_id = Column(UUID(as_uuid=True), ForeignKey("centros_costo.id"))
    supervisor = Column(String, index=True)
    programada = Column(DateTime)                      # UTC sin zona
    estado = Column(String, default="Pendiente")      # Pendiente / Realizada
    visita_id = Column(UUID(as_uuid=True), nullable=True)
    creada = Column(DateTime, server_default=func.now())


# Esta línea le ordena a SQLAlchemy que viaje a PostgreSQL y cree estas tablas físicamente
Base.metadata.create_all(bind=engine)