# B-CIP — BİRLEŞİK (Node + Python RapidOCR) tek Cloud Run konteyneri.
# TAMAMEN YEREL/OFFLINE OCR: Python sidecar konteyner İÇİNDE 127.0.0.1:8765'te koşar,
# Node sunucusu onu localhost'tan çağırır. Bulut AI YOK. Model imaja GÖMÜLÜR
# (çalışma zamanında indirme yok = gerçek offline).
#
# Deploy (tek komut):
#   gcloud run deploy bcip --source . --region europe-west4 \
#     --memory 2Gi --cpu 2 --allow-unauthenticated

# --- Aşama 1: frontend + sunucu derleme (Node) ---
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build   # -> dist/ (frontend + server.cjs)

# --- Aşama 2: çalışma zamanı (Node + Python) ---
FROM node:20-slim AS runtime
ENV NODE_ENV=production
# OpenCV (libGL/glib) + pyzbar (libzbar0) + Python
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip \
    libzbar0 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Node üretim bağımlılıkları (server.cjs harici paketleri çalışma zamanında ister)
COPY package*.json ./
RUN npm ci --omit=dev

# Python sidecar bağımlılıkları (PEP 668 için izole venv)
COPY ocr-service/requirements.txt ocr-service/requirements.txt
RUN python3 -m venv /opt/ocrvenv && \
    /opt/ocrvenv/bin/pip install --no-cache-dir -r ocr-service/requirements.txt

# Derlenmiş çıktı + sidecar kaynağı + başlatıcı
COPY --from=build /app/dist ./dist
COPY ocr-service ./ocr-service
COPY firebase-applet-config.json ./firebase-applet-config.json
COPY start.sh ./start.sh
RUN chmod +x start.sh

# LATIN/TÜRKÇE rec modelini İMAJA GÖM (çalışma zamanında indirme yok).
RUN RAPIDOCR_REC_LANG=latin /opt/ocrvenv/bin/python -c \
    "import sys; sys.path.insert(0, 'ocr-service'); import ocr_engine; ocr_engine.get_engine(); print('[BUILD] RapidOCR Latin modeli imaja gömüldü.')"

ENV OCR_PROVIDER=rapidocr \
    RAPIDOCR_SERVICE_URL=http://127.0.0.1:8765 \
    OCR_SIDECAR_PORT=8765 \
    RAPIDOCR_PRELOAD=true \
    RAPIDOCR_BOX_THRESH=0.3 \
    RAPIDOCR_UNCLIP_RATIO=1.8 \
    PYTHON_BIN=/opt/ocrvenv/bin/python \
    ALLOW_DEMO_ROLE_SWITCH=false
# ALLOW_DEMO_ROLE_SWITCH=false: ÜRETİMDE rol değiştirici KAPALI (yetki yükseltme
# açığını kapatır). Demo/sunum için Cloud Run'da env'i "true" yapabilirsiniz.

# Cloud Run $PORT'u (8080) enjekte eder; Node onu okur. Sidecar 127.0.0.1:8765 (iç).
EXPOSE 8080
CMD ["./start.sh"]
