import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# 1. Ruta de conexión: usuario(admin), clave(supersecretpassword), puerto(5432), base de datos(supervision_geodb)
# Se puede cambiar con la variable de entorno DATABASE_URL. El valor por defecto es SOLO para desarrollo local.
URL_BASE_DATOS = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://admin:supersecretpassword@localhost:5432/supervision_geodb",
)

# 2. El motor que establece la comunicación con Docker
engine = create_engine(URL_BASE_DATOS)

# 3. La sesión de trabajo que usaremos para guardar o consultar datos
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 4. Plantilla base para crear nuestras tablas
Base = declarative_base()