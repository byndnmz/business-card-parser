# B-CIP — Business Card Intelligence Platform

Savunma sanayii / kamu seviyesinde, yapay zeka destekli **kartvizit istihbarat ve
temas yönetim platformu**. Web + mobil simülatör, ortak backend API, Firebase veri
katmanı, RBAC, denetlenebilir audit log ve gerçek (mock fallback'li) OCR ayrıştırma.

## Mimari

```
React 19 + Vite (SPA)  ──HTTP──▶  Express API (server.ts)
        │                              │
        │                              ├── src/server/security.ts  (oturum, rate limit,
        │                              │     doğrulama, dosya imzası, başlıklar)
        │                              ├── src/server/parser.ts     (OCR adaptörü, regex
        │                              │     doğrulama, duplicate, structured Gemini)
        │                              └── Firebase Firestore (veri katmanı)
        └── components/ (BoundingBox, VerifyForm, Batch, Export, Audit, Admin, QR, Mobile)
```

- **OCR/Parser:** Sağlayıcı adaptör mimarisi (`OCR_PROVIDER`). Gemini
  (`gemini-2.5-flash`, structured output) **veya** anahtarsız/offline **Tesseract**
  (`ocr-tesseract.ts` — görsel sunucudan çıkmaz, savunma için ideal). Anahtar yoksa
  otomatik Tesseract'a düşer (mock değil). **Görüntü ön-işleme** (`image-preprocess.ts`,
  sharp): kalite analizi (bulanık/loş/düşük çözünürlük) + oto-iyileştirme + çok-PSM
  OCR. Çıkarılan alanlar regex ile doğrulanır/normalize edilir, gerçek bounding box üretilir.
- **Güvenlik:** İmzalı httpOnly oturum cookie'si, per-request RBAC, rate limiting,
  magic-byte dosya doğrulama, input sanitizasyonu, sıkı CSP, **gerçek TOTP MFA**
  (RFC 6238), **Firebase IdP** ID-token doğrulama ve **kurcalama-kanıtı audit
  zinciri** (SHA-256 hash-chain). Ayrıntı: [SECURITY.md](SECURITY.md).
- **Veri modeli:** users, business_cards, business_card_fields, contacts, batches,
  exports, audit_logs, tags, contact_tags (`firebase-blueprint.json`, `firestore.rules`).

## Çalıştırma

**Önkoşul:** Node.js 18+

```bash
npm install
cp .env.example .env.local   # değerleri doldurun (özellikle SESSION_SECRET)
npm run dev                  # http://localhost:3000
```

| Komut | Açıklama |
|---|---|
| `npm run dev` | tsx ile geliştirme sunucusu (Vite middleware) |
| `npm run build` | Frontend (Vite) + backend (esbuild) derleme → `dist/` |
| `npm run start` | Üretim sunucusu (`dist/server.cjs`) |
| `npm run lint` | `tsc --noEmit` tip kontrolü |

## Ortam değişkenleri

`.env.example` dosyasına bakın. Kritik olanlar:

- `SESSION_SECRET` — oturum imzalama anahtarı (üretimde **zorunlu**).
- `ALLOW_DEMO_ROLE_SWITCH` — RBAC demo rol değiştirici; üretimde `false`.
- `OCR_PROVIDER` / `GEMINI_MODEL` / `GEMINI_API_KEY` — OCR yapılandırması.
- `DEMO_MFA_CODE` — demo MFA kodu (üretimde TOTP/WebAuthn ile değiştirin).

## Dağıtım notları

- `NODE_ENV=production`: Secure cookie, statik `dist` sunumu, debug kapalı.
- Vercel / Firebase Hosting / Cloud Run uyumlu (tek Node süreci + statik SPA).
- **Kalıcılık Firebase Admin SDK ile yapılır** (`src/server/firestore-admin.ts`).
  Kimlik bilgisi (`FIREBASE_SERVICE_ACCOUNT` / `GOOGLE_APPLICATION_CREDENTIALS` /
  GCP ADC) sağlanınca veri Firestore'da kalıcıdır; yoksa temiz in-memory fallback.
  Detay: [SECURITY.md](SECURITY.md) §3.

## Güvenlik durumu (özet)

Gerçekten uygulanan ve test edilen kontroller ile demo/üretim farkları
[SECURITY.md](SECURITY.md) içinde tablo halinde listelenmiştir. Özet test kapsamı:
imzalı token doğrulama, dosya imza reddi, privilege-escalation engeli, RBAC
(401/403), rate limit (429) ve uçtan uca OCR akışı doğrulanmıştır.
