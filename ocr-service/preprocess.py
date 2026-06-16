"""
preprocess.py — Görüntü ön-işleme (doğruluğun çoğu burada üretilir).

Akış: EXIF düzeltme → kart sınırı tespiti + PERSPEKTİF DÜZELTME (warp) → DESKEW →
kalite skoru → KOŞULLU iyileştirme (gri + CLAHE + bilateral denoise + upscale).

ÖNEMLİ: Binarization KOŞULLUDUR ve varsayılan KAPALIDIR — modern derin OCR temiz
gri/renkli görüntüde daha iyi okur. Ağır işlem yalnızca kalite düşükse uygulanır.

Tüm geometrik adımlar tek bir kümülatif homografi M'de (orijinal_ref → işlenmiş)
biriktirilir. OCR işlenmiş görselde çalışır; kutular Minv ile ORİJİNAL koordinata
geri eşlenir → frontend overlay'i bozulmaz, TS şeması hiç değişmez.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import cv2
import numpy as np


# Eşikler (deneysel; ortamına göre ayarlanabilir)
BLUR_VAR_THRESHOLD = 100.0   # Laplacian varyansı; altı = bulanık
LOW_LIGHT = 70
BRIGHT = 215
LOW_RES_W = 1000
UPSCALE_TARGET_W = 1600
MAX_W = 2600                 # çok büyük görseli hız için küçült


@dataclass
class PreResult:
    image: np.ndarray              # OCR'a verilecek İŞLENMİŞ görsel
    M: np.ndarray                  # 3x3: orijinal_ref → işlenmiş
    ref_w: int                     # orijinal_ref (EXIF düzeltilmiş) genişlik
    ref_h: int
    exif_image: np.ndarray         # EXIF düzeltilmiş orijinal (QR/önizleme için)
    quality: dict
    warnings: list = field(default_factory=list)


def _affine_to_h(a: np.ndarray) -> np.ndarray:
    """2x3 affine'i 3x3 homografiye yükseltir."""
    H = np.eye(3, dtype=np.float64)
    H[:2, :] = a
    return H


def correct_exif(bgr: np.ndarray, exif_orientation: Optional[int]) -> np.ndarray:
    """EXIF oryantasyonunu piksel düzeyinde uygular (tarayıcı da bunu yapar)."""
    if not exif_orientation or exif_orientation == 1:
        return bgr
    o = exif_orientation
    if o == 3:
        return cv2.rotate(bgr, cv2.ROTATE_180)
    if o == 6:
        return cv2.rotate(bgr, cv2.ROTATE_90_CLOCKWISE)
    if o == 8:
        return cv2.rotate(bgr, cv2.ROTATE_90_COUNTERCLOCKWISE)
    if o == 2:
        return cv2.flip(bgr, 1)
    if o == 4:
        return cv2.flip(bgr, 0)
    return bgr


def find_card_quad(bgr: np.ndarray) -> Optional[np.ndarray]:
    """En büyük dörtgen konturu (kart sınırı) bulur. Bulunamazsa None."""
    h, w = bgr.shape[:2]
    area_img = h * w
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(gray, 50, 150)
    edged = cv2.dilate(edged, np.ones((3, 3), np.uint8), iterations=1)
    cnts, _ = cv2.findContours(edged, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    cnts = sorted(cnts, key=cv2.contourArea, reverse=True)[:5]
    for c in cnts:
        area = cv2.contourArea(c)
        # Kart, görüntünün anlamlı bir kısmını (>=%35) kaplamalı ama tamamı olmamalı.
        if area < 0.35 * area_img or area > 0.99 * area_img:
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            return approx.reshape(4, 2).astype(np.float32)
    return None


def _order_quad(pts: np.ndarray) -> np.ndarray:
    """Köşeleri sol-üst, sağ-üst, sağ-alt, sol-alt olarak sıralar."""
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]
    rect[3] = pts[np.argmax(d)]
    return rect


def four_point_warp(bgr: np.ndarray, quad: np.ndarray):
    """Perspektif düzeltme uygular; (warped, H 3x3) döner."""
    rect = _order_quad(quad)
    (tl, tr, br, bl) = rect
    wA = np.linalg.norm(br - bl)
    wB = np.linalg.norm(tr - tl)
    hA = np.linalg.norm(tr - br)
    hB = np.linalg.norm(tl - bl)
    maxW = int(max(wA, wB))
    maxH = int(max(hA, hB))
    if maxW < 50 or maxH < 30:
        return bgr, np.eye(3, dtype=np.float64)
    dst = np.array([[0, 0], [maxW - 1, 0], [maxW - 1, maxH - 1], [0, maxH - 1]], dtype=np.float32)
    H = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(bgr, H, (maxW, maxH))
    return warped, H.astype(np.float64)


def estimate_skew(bgr: np.ndarray) -> float:
    """minAreaRect ile metin eğikliğini (derece) tahmin eder."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    thr = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thr > 0))
    if coords.shape[0] < 50:
        return 0.0
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = 90 + angle
    if angle > 45:
        angle = angle - 90
    return float(angle)


def rotate_keep(bgr: np.ndarray, angle: float):
    """Görseli açıyla döndürür (kırpmadan); (rotated, R 3x3) döner."""
    h, w = bgr.shape[:2]
    center = (w / 2.0, h / 2.0)
    R = cv2.getRotationMatrix2D(center, angle, 1.0)
    cos, sin = abs(R[0, 0]), abs(R[0, 1])
    nW = int(h * sin + w * cos)
    nH = int(h * cos + w * sin)
    R[0, 2] += (nW / 2.0) - center[0]
    R[1, 2] += (nH / 2.0) - center[1]
    rotated = cv2.warpAffine(bgr, R, (nW, nH), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))
    return rotated, _affine_to_h(R)


def assess_quality(bgr: np.ndarray) -> dict:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    blur_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(gray.mean())
    contrast = float(gray.std())
    issues = []
    is_blurry = blur_var < BLUR_VAR_THRESHOLD
    is_low_light = brightness < LOW_LIGHT
    is_bright = brightness > BRIGHT
    is_low_res = w < LOW_RES_W
    if is_blurry: issues.append("Bulanık/düşük netlik")
    if is_low_light: issues.append("Düşük ışık")
    if is_bright: issues.append("Aşırı parlak/yansıma")
    if is_low_res: issues.append("Düşük çözünürlük")
    score = 1.0
    if is_blurry: score -= 0.4
    if is_low_light or is_bright: score -= 0.25
    if is_low_res: score -= 0.2
    score = max(0.0, min(1.0, score))
    return {
        "width": w, "height": h, "brightness": round(brightness, 1),
        "sharpness": round(blur_var, 1), "contrast": round(contrast, 1),
        "is_blurry": is_blurry, "is_low_light": is_low_light,
        "is_bright": is_bright, "is_low_res": is_low_res,
        "score": round(score, 2), "issues": issues,
    }


def conditional_enhance(bgr: np.ndarray, q: dict):
    """KOŞULLU iyileştirme. Aşırı işleme yapmaz; (image, scale) döner."""
    img = bgr
    scale = 1.0
    h, w = img.shape[:2]

    # Upscale (yalnızca düşük çözünürlükte) / çok büyükse küçült
    if w < UPSCALE_TARGET_W and (q["is_low_res"] or q["is_blurry"]):
        scale = UPSCALE_TARGET_W / float(w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
    elif w > MAX_W:
        scale = MAX_W / float(w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    # Yalnızca kalite düşükse ağır işlem uygula (temiz görsele dokunma).
    if q["is_low_light"] or q["is_bright"] or q["is_blurry"]:
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        img = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)
    if q["is_blurry"]:
        img = cv2.bilateralFilter(img, 7, 50, 50)  # kenar-koruyan denoise
    return img, scale


def preprocess(bgr: np.ndarray, exif_orientation: Optional[int] = None) -> PreResult:
    warnings: list = []
    M = np.eye(3, dtype=np.float64)  # orijinal_ref → mevcut

    ref = correct_exif(bgr, exif_orientation)
    ref_h, ref_w = ref.shape[:2]
    cur = ref

    # 1) Kart sınırı + perspektif düzeltme
    try:
        quad = find_card_quad(cur)
        if quad is not None:
            cur, H = four_point_warp(cur, quad)
            M = H @ M
    except Exception as e:
        warnings.append(f"Perspektif düzeltme atlandı: {e}")

    # 2) Deskew (ölçülü: 0.5°–15° arası)
    try:
        angle = estimate_skew(cur)
        if 0.5 < abs(angle) <= 15:
            cur, R = rotate_keep(cur, angle)
            M = R @ M
    except Exception as e:
        warnings.append(f"Deskew atlandı: {e}")

    # 3) Kalite + koşullu iyileştirme
    q = assess_quality(cur)
    if q["issues"]:
        warnings.append(f"Görsel kalite (skor {q['score']}): {', '.join(q['issues'])} — oto-iyileştirme uygulandı.")
    if q["score"] < 0.25:
        warnings.append("Görsel kalitesi çok düşük — sonuç güvenilmez olabilir, daha net bir görsel önerilir.")

    try:
        cur, scale = conditional_enhance(cur, q)
        if scale != 1.0:
            S = np.diag([scale, scale, 1.0]).astype(np.float64)
            M = S @ M
    except Exception as e:
        warnings.append(f"İyileştirme atlandı: {e}")

    return PreResult(image=cur, M=M, ref_w=ref_w, ref_h=ref_h, exif_image=ref, quality=q, warnings=warnings)


def map_box_to_original(box_pts: np.ndarray, M: np.ndarray):
    """İşlenmiş koordinattaki 4 köşeyi (Minv ile) orijinal_ref'e eşler; (x0,y0,x1,y1)."""
    Minv = np.linalg.inv(M)
    pts = np.array(box_pts, dtype=np.float64).reshape(-1, 1, 2)
    mapped = cv2.perspectiveTransform(pts, Minv).reshape(-1, 2)
    x0, y0 = mapped[:, 0].min(), mapped[:, 1].min()
    x1, y1 = mapped[:, 0].max(), mapped[:, 1].max()
    return float(x0), float(y0), float(x1), float(y1)
