from celery import Celery
import time

# Configuramos Celery utilizando Redis como intermediario de mensajes (Broker)
celery_app = Celery(
    "tasks",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/0"
)

@celery_app.task(name="tasks.generar_reporte_pdf")
def generar_reporte_pdf(id_coordinador: str):
    print(f"Iniciando generación pesada de PDF para el coordinador {id_coordinador}...")
    
    # Simulamos un proceso pesado de consulta y renderizado de PDF (ej. 5 segundos)
    time.sleep(5)
    
    print(f"¡Reporte PDF generado con éxito para el coordinador {id_coordinador}!")
    return {"status": "Completado", "archivo": "reporte_supervision.pdf"}