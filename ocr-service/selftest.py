"""
selftest.py — TÜRKÇE KARAKTER KABUL TESTİ (göç planı Adım 1 kabul kapısı).

Sentetik bir kartvizit görseli üretir (ş, ç, ğ, ı, İ, ö, ü içeren), ön-işleme +
RapidOCR'dan geçirir ve Türkçe karakterlerin DOĞRU okunduğunu kontrol eder.
Bu test GEÇMEDEN sistemin Türkçe doğruluğuna güvenilmemelidir.

Çalıştır:  python selftest.py
"""
from __future__ import annotations
import sys
import numpy as np
import cv2

# Windows konsolu (cp1254) Türkçe/işaret karakterlerinde çökmesin.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import preprocess as pp
import ocr_engine

LINES = [
    "Dr. Ahmet Sadık Şahiner",
    "Siber Güvenlik Grup Lideri",
    "LİMİT SAVUNMA TEKNOLOJİLERİ A.Ş.",
    "ahmet@limitsavunma.com.tr",
    "+90 312 444 88 55",
    "Çankaya / Ankara — Türkiye",
]
TR_CHARS = set("şçğıİöüŞÇĞÖÜ")


def _load_font(size: int):
    from PIL import ImageFont
    for cand in [
        "C:\\Windows\\Fonts\\arial.ttf", "C:\\Windows\\Fonts\\segoeui.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "DejaVuSans.ttf", "arial.ttf",
    ]:
        try:
            return ImageFont.truetype(cand, size)
        except Exception:
            continue
    from PIL import ImageFont as _IF
    return _IF.load_default()


def render_card() -> np.ndarray:
    from PIL import Image, ImageDraw
    W, H = 1000, 600
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    sizes = [46, 30, 40, 28, 28, 24]
    y = 60
    for line, sz in zip(LINES, sizes):
        d.text((50, y), line, fill=(15, 15, 15), font=_load_font(sz))
        y += sz + 30
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def main():
    print("=== B-CIP OCR Sidecar — Türkçe Kabul Testi ===")
    bgr = render_card()
    pre = pp.preprocess(bgr, None)
    print(f"Kalite: {pre.quality['width']}x{pre.quality['height']} skor={pre.quality['score']} {pre.quality['issues']}")

    import time
    t0 = time.time()
    try:
        boxes = ocr_engine.run_ocr(pre.image, pre.M)
    except Exception as e:
        print(f"\n❌ OCR motoru çalışmadı: {e}")
        print("   RapidOCR kurulu mu?  pip install -r requirements.txt")
        sys.exit(2)
    ms = int((time.time() - t0) * 1000)

    text = "  ".join(b["text"] for b in boxes)
    print(f"Süre: {ms}ms | kutu: {len(boxes)}")
    print("OKUNAN METİN:")
    for b in boxes:
        print(f"   [{b['confidence']:.2f}] {b['text']}")

    found_tr = TR_CHARS & set(text)
    has_email = "@" in text and "limitsavunma" in text.lower()
    has_name = "şahiner" in text.lower() or "sahiner" in text.lower()
    tr_ok = len(found_tr) >= 3  # en az 3 farklı TR karakteri doğru çıkmalı

    mark = lambda b: "[OK]" if b else "[--]"
    print("\n--- DEĞERLENDİRME ---")
    print(f"Türkçe karakter okundu: {sorted(found_tr)}  -> {mark(tr_ok)}")
    print(f"E-posta okundu        : {mark(has_email)}")
    print(f"İsim okundu           : {mark(has_name)}")

    if tr_ok and has_email and has_name:
        print("\n[BASARILI] KABUL: RapidOCR Türkçe karakterleri doğru okuyor.")
        sys.exit(0)
    if not tr_ok:
        print("\n⚠️  Türkçe karakterler eksik/yanlış. Latin/Türkçe rec modeli ayarlayın:")
        print("    RAPIDOCR_REC_MODEL ve RAPIDOCR_REC_KEYS (bkz. README).")
    print("\n❌ KABUL EDİLMEDİ.")
    sys.exit(1)


if __name__ == "__main__":
    main()
