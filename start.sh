#!/bin/sh
# B-CIP birleşik konteyner başlatıcı: Python OCR sidecar (arka plan) + Node sunucu (ön plan).
# Node ön planda 'exec' ile koşar → Cloud Run SIGTERM'i düzgün alır.
# Sidecar düşerse Node ayakta kalır (OCR yerel Tesseract'a düşer; çökme yok).
set -e

PYTHON_BIN="${PYTHON_BIN:-/opt/ocrvenv/bin/python}"

echo "[START] RapidOCR sidecar başlatılıyor (127.0.0.1:${OCR_SIDECAR_PORT:-8765})..."
"$PYTHON_BIN" ocr-service/app.py &

echo "[START] Node sunucusu başlatılıyor (PORT=${PORT:-8080})..."
exec node dist/server.cjs
