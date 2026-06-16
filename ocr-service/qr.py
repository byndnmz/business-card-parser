"""
qr.py — QR / vCard / MECARD KISA YOLU.

OCR'dan ÖNCE kartta QR kod aranır. Varsa decode edilir; içerik vCard/MECARD ise
alanlar DOĞRUDAN yapısal veriden alınır (%100 güvenilir). pyzbar yoksa servis
yine çalışır; QR adımı sessizce atlanır.

Çıktı alan adları TS şemasıyla AYNIDIR (full_name, title, company, ...).
"""
from __future__ import annotations
import re
from typing import Optional, Dict

try:
    from pyzbar.pyzbar import decode as _zbar_decode  # type: ignore
    _HAS_ZBAR = True
except Exception:  # pyzbar/libzbar yoksa QR atlanır
    _HAS_ZBAR = False


def has_zbar() -> bool:
    return _HAS_ZBAR


def find_and_decode(bgr_image) -> Optional[Dict]:
    """Görselde ilk QR'ı bulup parse eder. Yoksa None."""
    if not _HAS_ZBAR:
        return None
    try:
        results = _zbar_decode(bgr_image)
    except Exception:
        return None
    for r in results:
        try:
            raw = r.data.decode("utf-8", errors="replace").strip()
        except Exception:
            continue
        if not raw:
            continue
        parsed = parse_payload(raw)
        if parsed and parsed.get("fields"):
            return parsed
    return None


def parse_payload(raw: str) -> Optional[Dict]:
    low = raw.lower()
    if low.startswith("begin:vcard"):
        return {"raw": raw, "format": "vcard", "fields": _parse_vcard(raw)}
    if low.startswith("mecard:"):
        return {"raw": raw, "format": "mecard", "fields": _parse_mecard(raw)}
    if raw.startswith("{") and raw.endswith("}"):
        import json
        try:
            obj = json.loads(raw)
            return {"raw": raw, "format": "json", "fields": _map_generic(obj)}
        except Exception:
            pass
    if re.match(r"^https?://", raw, re.I):
        return {"raw": raw, "format": "url", "fields": {"website": raw}}
    return {"raw": raw, "format": "text", "fields": {}}


def _parse_vcard(raw: str) -> Dict[str, str]:
    f: Dict[str, str] = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        key, val = line.split(":", 1)
        key = key.upper()
        val = val.strip()
        base = key.split(";")[0]
        if base == "FN":
            f["full_name"] = val
        elif base == "N" and "full_name" not in f:
            parts = [p for p in val.split(";") if p]
            f["full_name"] = " ".join(reversed(parts[:2])) if parts else val
        elif base == "TITLE":
            f["title"] = val
        elif base == "ORG":
            org = val.split(";")
            f["company"] = org[0].strip()
            if len(org) > 1 and org[1].strip():
                f["department"] = org[1].strip()
        elif base == "EMAIL":
            f["email"] = val.lower()
        elif base == "TEL":
            if "CELL" in key or "MOBILE" in key:
                f["mobile_phone"] = val
            else:
                f.setdefault("phone", val)
        elif base == "URL":
            f["website"] = val
        elif base == "ADR":
            adr = [p for p in val.split(";") if p]
            f["address"] = ", ".join(adr)
    return f


def _parse_mecard(raw: str) -> Dict[str, str]:
    body = raw[len("MECARD:"):]
    f: Dict[str, str] = {}
    for seg in body.split(";"):
        if ":" not in seg:
            continue
        k, v = seg.split(":", 1)
        k = k.upper().strip()
        v = v.strip()
        if not v:
            continue
        if k == "N":
            parts = [p for p in v.split(",") if p]
            f["full_name"] = " ".join(reversed(parts)) if parts else v
        elif k == "TEL":
            f.setdefault("phone", v)
        elif k == "EMAIL":
            f["email"] = v.lower()
        elif k == "URL":
            f["website"] = v
        elif k == "ORG":
            f["company"] = v
        elif k == "ADR":
            f["address"] = v
    return f


_ALLOWED = {
    "full_name", "title", "company", "department", "email", "phone",
    "mobile_phone", "website", "address", "city", "country", "linkedin", "notes",
}


def _map_generic(obj: dict) -> Dict[str, str]:
    f: Dict[str, str] = {}
    for k, v in obj.items():
        if k in _ALLOWED and isinstance(v, str) and v.strip():
            f[k] = v.strip()
    return f
