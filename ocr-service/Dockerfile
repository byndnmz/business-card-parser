# B-CIP OCR Sidecar — tamamen yerel/offline OCR servisi.
# Modeller imaja gömülür (çalışma zamanında indirme yok = gerçek offline).
FROM python:3.11-slim

# OpenCV (libGL/glib) ve pyzbar (libzbar0) için sistem bağımlılıkları.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libzbar0 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Türkçe/Latin rec modelini imaja eklerseniz, yollarını burada sabitleyin:
#   ENV RAPIDOCR_REC_MODEL=/app/models/latin_rec.onnx
#   ENV RAPIDOCR_REC_KEYS=/app/models/latin_dict.txt
ENV OCR_SIDECAR_PORT=8765 \
    RAPIDOCR_PRELOAD=true \
    RAPIDOCR_BOX_THRESH=0.3 \
    RAPIDOCR_UNCLIP_RATIO=1.8

EXPOSE 8765
CMD ["python", "app.py"]
