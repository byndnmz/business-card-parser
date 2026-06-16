# B-CIP OCR Sidecar (RapidOCR, tamamen yerel/offline)

Bu küçük Python servisi, kartvizit görselinden **metin + kutu + güven** çıkarır
(RapidOCR / ONNX) ve OpenCV ile ağır ön-işlemeyi yapar. Node tarafı (Express)
bunu **localhost** üzerinden çağırır; **görsel sunucudan çıkmaz**.

> Mimari: ağır görüntü işi + OCR burada (Python/OpenCV/RapidOCR); alan semantiği
> (isim/şirket/unvan skorlama, çapraz doğrulama, şema) Node tarafındadır
> (`src/server/...`). Kutular **orijinal görsel koordinatına** geri eşlenir, böylece
> frontend overlay'i bozulmaz.

## Kurulum

```powershell
cd ocr-service
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

> Linux'ta QR için ayrıca: `apt-get install -y libzbar0` (Dockerfile bunu içerir).

## Çalıştırma

```powershell
.venv\Scripts\python app.py          # http://127.0.0.1:8765
```

Node tarafı `RAPIDOCR_SERVICE_URL` ile bu adresi bulur (varsayılan
`http://127.0.0.1:8765`). `.env.local` içine ekleyin:

```
OCR_PROVIDER=rapidocr
RAPIDOCR_SERVICE_URL=http://127.0.0.1:8765
```

## Türkçe karakter desteği (ÖNEMLİ)

RapidOCR'ın **varsayılan** modeli Çince+İngilizce'dir ve `ş, ç, ğ, ı, İ, ö, ü`'yü
tam okuyamaz. Latin/Türkçe destekleyen **recognition** modelini ayarlayın:

```
RAPIDOCR_REC_MODEL=models/latin_PP-OCRv4_rec_infer.onnx
RAPIDOCR_REC_KEYS=models/latin_dict.txt
```

- Latin PP-OCR rec modeli + sözlüğü (`latin_dict.txt`) PaddleOCR/RapidOCR model
  depolarından indirilip `models/` altına konur (offline için imaja gömün).
- Doğrulama için **kabul testini** çalıştırın:

```powershell
.venv\Scripts\python selftest.py
```

Bu test sentetik bir Türkçe kart üretir; `ş/ç/ğ/ı/İ/ö/ü` doğru okunmazsa **başarısız**
olur. Bu test geçmeden Türkçe doğruluğa güvenmeyin.

## Ayarlanabilir ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `OCR_SIDECAR_PORT` | `8765` | Dinlenen port |
| `RAPIDOCR_PRELOAD` | `true` | Modeli açılışta yükle (ilk istek hızlı) |
| `RAPIDOCR_REC_MODEL` / `RAPIDOCR_REC_KEYS` | — | Latin/Türkçe rec modeli + sözlük |
| `RAPIDOCR_DET_MODEL` / `RAPIDOCR_CLS_MODEL` | — | Özel det/cls modelleri |
| `RAPIDOCR_BOX_THRESH` | (model) | Küçük yazı için düşürün (ör. 0.3) |
| `RAPIDOCR_UNCLIP_RATIO` | (model) | Kutu genişletme (ör. 1.8) |
| `RAPIDOCR_TEXT_SCORE` | (model) | Min. metin güveni |

## API

`POST /ocr`  →  gövde: `{ "image_base64": "...", "mime_type": "image/jpeg" }`

```json
{
  "engine": "rapidocr",
  "image_width": 1000, "image_height": 600,
  "boxes": [{ "text": "...", "confidence": 0.97, "bbox": {"x0":..,"y0":..,"x1":..,"y1":..} }],
  "qr": { "format": "vcard", "fields": { "full_name": "...", "email": "..." } },
  "timings": { "preprocess_ms": 12, "qr_ms": 3, "ocr_ms": 140, "total_ms": 158 },
  "warnings": []
}
```

`GET /health` → `{ "status": "ok", "zbar": true, "engine_loaded": true }`

## Docker

```bash
docker build -t bcip-ocr-sidecar ./ocr-service
docker run -p 8765:8765 bcip-ocr-sidecar
```
