"""
ocr_engine.py — RapidOCR (det + cls + rec) SINGLETON sarmalayıcı.

Model BİR KEZ yüklenir (her çağrıda değil) — hız için en kritik nokta.
Yeni 'rapidocr' (Python 3.13 uyumlu) ve eski 'rapidocr_onnxruntime' API'lerinin
İKİSİNİ de destekler.

Recognition modeli Türkçe/Latin destekleyen sürüme env ile ayarlanır
(RAPIDOCR_REC_MODEL / RAPIDOCR_REC_KEYS veya RAPIDOCR_CONFIG). Varsayılan ZH+EN
model Türkçe diakritikleri (ş, ç, ğ, ı, İ, ö, ü) tam okuyamaz; doğru sonuç için
Latin modeli ayarlanmalı (bkz. README + selftest.py).

Kutular OCR'dan İŞLENMİŞ koordinatta gelir; preprocess.map_box_to_original ile
ORİJİNAL koordinata geri eşlenir.
"""
from __future__ import annotations
import os
import threading
import numpy as np

from preprocess import map_box_to_original

_engine = None
_lock = threading.Lock()
_api = "unknown"  # "new" | "old"


def is_loaded() -> bool:
    return _engine is not None


def _new_params_from_env() -> dict:
    """Yeni 'rapidocr' paketi için nokta-ayrılmış parametre anahtarları."""
    mapping = {
        "RAPIDOCR_DET_MODEL": "Det.model_path",
        "RAPIDOCR_CLS_MODEL": "Cls.model_path",
        "RAPIDOCR_REC_MODEL": "Rec.model_path",
        "RAPIDOCR_REC_KEYS": "Rec.rec_keys_path",
    }
    params = {}
    for env, key in mapping.items():
        v = os.getenv(env)
        if v:
            params[key] = v

    # TÜRKÇE: açık rec modeli verilmediyse, RapidOCR'ın LATIN rec modelini
    # (latin_PP-OCRv5_rec_mobile) seç → ş, ç, ğ, ı, İ, ö, ü doğru okunur.
    # Varsayılan ZH+EN modeli bunları bozar (Sadık→Sadik, A.Ş.→A.S.).
    # NOT: yeni API bu anahtarlar için ENUM bekler (string değil).
    if "Rec.model_path" not in params:
        from rapidocr.utils.typings import LangRec, OCRVersion  # type: ignore
        params["Rec.lang_type"] = LangRec(os.getenv("RAPIDOCR_REC_LANG", "latin"))
        params["Rec.ocr_version"] = OCRVersion(os.getenv("RAPIDOCR_OCR_VERSION", "PP-OCRv5"))

    if os.getenv("RAPIDOCR_BOX_THRESH"):
        params["Det.box_thresh"] = float(os.environ["RAPIDOCR_BOX_THRESH"])
    if os.getenv("RAPIDOCR_UNCLIP_RATIO"):
        params["Det.unclip_ratio"] = float(os.environ["RAPIDOCR_UNCLIP_RATIO"])
    return params


def _old_kwargs_from_env() -> dict:
    kwargs = {}
    for env, key in [
        ("RAPIDOCR_DET_MODEL", "det_model_path"),
        ("RAPIDOCR_CLS_MODEL", "cls_model_path"),
        ("RAPIDOCR_REC_MODEL", "rec_model_path"),
        ("RAPIDOCR_REC_KEYS", "rec_keys_path"),
    ]:
        v = os.getenv(env)
        if v:
            kwargs[key] = v
    return kwargs


def _load_engine():
    global _api
    # 1) Yeni 'rapidocr' paketi (Python 3.13)
    try:
        from rapidocr import RapidOCR  # type: ignore
        _api = "new"
        cfg = os.getenv("RAPIDOCR_CONFIG")
        params = _new_params_from_env()
        try:
            if cfg:
                return RapidOCR(config_path=cfg)
            if params:
                return RapidOCR(params=params)
            return RapidOCR()
        except Exception as e:
            print(f"[OCR-SIDECAR] Yeni API parametreleri uygulanamadı ({e}); varsayılanla yükleniyor.")
            return RapidOCR()
    except ImportError:
        pass

    # 2) Eski 'rapidocr_onnxruntime' paketi
    from rapidocr_onnxruntime import RapidOCR as RapidOCROld  # type: ignore
    _api = "old"
    kwargs = _old_kwargs_from_env()
    try:
        return RapidOCROld(intra_op_num_threads=max(1, os.cpu_count() or 4), **kwargs)
    except TypeError:
        return RapidOCROld(**kwargs)


def get_engine():
    global _engine
    if _engine is None:
        with _lock:
            if _engine is None:
                _engine = _load_engine()
    return _engine


def _parse_result(result):
    """Yeni (obje) ve eski (tuple/list) çıktıları ortak (box, text, score) listesine indirger."""
    items = []
    if result is None:
        return items
    # Yeni API: .boxes / .txts / .scores nitelikli obje
    boxes_attr = getattr(result, "boxes", None)
    txts_attr = getattr(result, "txts", None)
    scores_attr = getattr(result, "scores", None)
    if boxes_attr is not None and txts_attr is not None and scores_attr is not None:
        for box, txt, score in zip(boxes_attr, txts_attr, scores_attr):
            items.append((box, txt, score))
        return items
    # Eski API: (list, elapse) tuple ya da düz list
    data = result[0] if isinstance(result, tuple) else result
    if not data:
        return items
    for row in data:
        try:
            items.append((row[0], row[1], row[2]))
        except Exception:
            continue
    return items


def run_ocr(processed_img: np.ndarray, M: np.ndarray) -> list:
    """OCR çalıştırır; her kutu için {text, confidence(0..1), bbox(orijinal koord.)}."""
    engine = get_engine()
    try:
        result = engine(processed_img)
    except Exception as e:
        raise RuntimeError(f"RapidOCR çağrısı başarısız: {e}")

    boxes = []
    for box, txt, score in _parse_result(result):
        text = str(txt)
        if not text.strip():
            continue
        try:
            x0, y0, x1, y1 = map_box_to_original(np.array(box, dtype=np.float64), M)
        except Exception:
            continue
        boxes.append({
            "text": text,
            "confidence": max(0.0, min(1.0, float(score))),
            "bbox": {"x0": x0, "y0": y0, "x1": x1, "y1": y1},
        })
    return boxes
