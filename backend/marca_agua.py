"""Estampa una franja con datos de la visita sobre la foto de evidencia.

Se hace en el servidor para que el supervisor no pueda quitarla ni alterarla desde el celular.
"""
import base64
import io
from datetime import datetime, timedelta, timezone

from PIL import Image, ImageDraw, ImageFont, ImageOps

ZONA_LOCAL = timezone(timedelta(hours=-5))  # Colombia, sin horario de verano


def formatear_fecha(dt: datetime | None) -> str:
    if dt is None:
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(ZONA_LOCAL).strftime("%d/%m/%Y %H:%M:%S")


def estampar(foto_b64: str, lineas: list[str]) -> str:
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(base64.b64decode(foto_b64)))).convert("RGBA")
    w, h = img.size

    # Tamaño de letra: el mayor que haga caber la línea más larga
    medidor = ImageDraw.Draw(img)
    tam = max(12, w // 28)
    while tam > 10:
        fuente = ImageFont.load_default(size=tam)
        if max(medidor.textlength(l, font=fuente) for l in lineas) <= w - tam:
            break
        tam -= 1
    fuente = ImageFont.load_default(size=tam)

    paso = int(tam * 1.35)
    alto = paso * len(lineas) + tam // 2
    capa = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(capa)
    d.rectangle([0, h - alto, w, h], fill=(0, 0, 0, 165))
    y = h - alto + tam // 4
    for linea in lineas:
        d.text((tam // 2, y), linea, font=fuente, fill=(255, 255, 255, 255))
        y += paso

    final = Image.alpha_composite(img, capa).convert("RGB")
    salida = io.BytesIO()
    final.save(salida, format="JPEG", quality=82)
    return base64.b64encode(salida.getvalue()).decode()
