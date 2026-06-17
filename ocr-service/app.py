"""
app.py — B-CIP OCR Sidecar (FastAPI). TAMAMEN YEREL/OFFLINE.

Uç noktalar:
  GET  /health  → servis + zbar + motor durumu
  POST /ocr     → {image_base64, mime_type?}  →  {boxes, qr, image_width/height, timings, warnings}

Görsel SUNUCUDAN ÇIKMAZ (veri egemenliği). Node tarafı bu servisi localhost'tan çağırır.
"""
from __future__ import annotations
import base64
import io
import time
import os
import sys

# Windows konsolu (cp1254) Türkçe karakterlerde çökmesin.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import cv2
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel

import preprocess as pp
import qr as qrmod
import ocr_engine

app = FastAPI(title="B-CIP OCR Sidecar", version="1.0.0")


class OcrRequest(BaseModel):
    image_base64: str
    mime_type: str | None = None


def _exif_orientation(raw: bytes):
    try:
        from PIL import Image  # lazy
        img = Image.open(io.BytesIO(raw))
        exif = img.getexif()
        return exif.get(274)  # 274 = Orientation tag
    except Exception:
        return None


@app.on_event("startup")
def _preload():
    # Modeli açılışta yükle (ilk istek hızlı olsun). Hata olsa da servis ayakta kalır.
    if os.getenv("RAPIDOCR_PRELOAD", "true").lower() == "true":
        try:
            ocr_engine.get_engine()
            print("[OCR-SIDECAR] RapidOCR modeli yüklendi (singleton).")
        except Exception as e:
            print(f"[OCR-SIDECAR] Model ön-yüklenemedi (ilk istekte denenecek): {e}")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "zbar": qrmod.has_zbar(),
        "opencv_qr": qrmod.has_opencv_qr(),
        "qr_decoder": qrmod.has_qr_decoder(),
        "engine_loaded": ocr_engine.is_loaded(),
    }


@app.post("/ocr")
def ocr(req: OcrRequest):
    t0 = time.time()
    warnings: list = []

    try:
        raw = base64.b64decode(req.image_base64, validate=False)
    except Exception:
        return _resp(0, 0, [], None, {}, ["Base64 çözülemedi (geçersiz veri)."])

    arr = np.frombuffer(raw, np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        return _resp(0, 0, [], None, {}, ["Görsel çözülemedi (desteklenmeyen/bozuk format)."])

    timings = {}
    exif = _exif_orientation(raw)

    tp = time.time()
    pre = pp.preprocess(bgr, exif)
    timings["preprocess_ms"] = int((time.time() - tp) * 1000)
    warnings.extend(pre.warnings)

    # QR/vCard kısa yolu — tam çözünürlüklü orijinal üzerinde, OCR'dan ÖNCE.
    tq = time.time()
    qr = None
    try:
        qr = qrmod.find_and_decode(pre.exif_image)
    except Exception as e:
        warnings.append(f"QR taraması atlandı: {e}")
    timings["qr_ms"] = int((time.time() - tq) * 1000)

    # OCR
    to = time.time()
    boxes = []
    try:
        boxes = ocr_engine.run_ocr(pre.image, pre.M)
    except Exception as e:
        warnings.append(f"OCR motoru çalıştırılamadı: {e}. RapidOCR kurulu mu / model yolu doğru mu?")
    timings["ocr_ms"] = int((time.time() - to) * 1000)
    timings["total_ms"] = int((time.time() - t0) * 1000)

    if not boxes and not qr:
        warnings.append("Görselde okunabilir metin/QR bulunamadı.")

    return _resp(pre.ref_w, pre.ref_h, boxes, qr, timings, warnings)


def _resp(w, h, boxes, qr, timings, warnings):
    return {
        "engine": "rapidocr",
        "image_width": w,
        "image_height": h,
        "boxes": boxes,
        "qr": qr,
        "timings": timings,
        "warnings": warnings,
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("OCR_SIDECAR_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port)
