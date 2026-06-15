# Yayına Alma (Deployment) — GitHub + Firebase

## ⭐ SENİN YOLUN: App Hosting + yeni Firebase projesi + Public repo

Aşağıdaki komutları **kendi makinende** sırayla çalıştır. `<...>` yerlerini doldur.

```bash
# 0) Araçlar (tek seferlik)
npm i -g firebase-tools
#  GitHub CLI:  https://cli.github.com  (veya manuel remote — aşağıda)

# 1) Yeni Firebase projeni aç:  https://console.firebase.google.com  -> "Add project"
#    Sonra Build -> Firestore Database -> "Create database" (Production mode).
#    Varsayılan veritabanı "(default)" oluşur.

# 2) firebase-applet-config.json'u KENDİ projenin web config'iyle değiştir:
#    Firebase Console -> Project Settings -> "Your apps" -> Web app -> SDK config.
#    Özellikle:  projectId  ve  "firestoreDatabaseId": "(default)"   yap.

# 3) GitHub'a (public) yükle:
gh repo create business-card-intelligence-platform --public --source=. --remote=origin --push
#  gh yoksa:  GitHub'da boş public repo aç, sonra:
#    git remote add origin https://github.com/<kullanıcı>/<repo>.git
#    git push -u origin main

# 4) Sırları Secret Manager'a ekle:
firebase login
firebase apphosting:secrets:set SESSION_SECRET   # aşağıdaki komutla üretip yapıştır
firebase apphosting:secrets:set GEMINI_API_KEY   # Gemini API anahtarın (gerçek OCR için)
#   SESSION_SECRET üret:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 5) App Hosting backend'i oluştur ve GitHub repo'na bağla (interaktif):
firebase apphosting:backends:create --project <SENIN_PROJE_ID>

# 6) Firestore kurallarını yükle ve çalışma zamanı SA'sına Firestore rolü ver:
firebase deploy --only firestore:rules --project <SENIN_PROJE_ID>
#   IAM -> App Hosting service account -> "Cloud Datastore User" rolü ekle.
```

Bundan sonra her `git push` otomatik build + deploy tetikler. Doğrulama: §4.

> **Gerçek OCR için** GEMINI_API_KEY şart (adım 4). Anahtar yokken sistem çalışır
> ama kartları okumaz; etiketli mock veri döndürür.

---

## 0. Önce mimariyi anla (önemli)

Bu uygulama **statik bir site değil** — bir **Node.js (Express) sunucusu**dur
(API + OCR + SPA'yı birlikte sunar). Bu yüzden **düz Firebase Hosting (statik)
TEK BAŞINA çalıştıramaz**. Node sunucusu için doğru seçenekler:

| Yol | Açıklama | DB kimlik bilgisi |
|---|---|---|
| **A. Firebase App Hosting** (önerilen) | GitHub'a bağlanır, her push'ta build+deploy. Cloud Run üzerinde koşar. | **Otomatik (ADC)** — service account JSON gerekmez |
| **B. Cloud Run** (Docker) | `Dockerfile` ile container deploy. | **Otomatik (ADC)** |
| C. Vercel/Render/Railway | Node host. | `FIREBASE_SERVICE_ACCOUNT` env gerekir |

> A ve B (GCP) için: çalışma zamanı service account'u ADC sağlar; kodumuz
> `K_SERVICE`'i algılayıp Firestore'a otomatik bağlanır. Sadece Firestore'u
> etkinleştirip o service account'a rol vermen yeterli.

---

## 1. Veritabanı (Firestore) — "ayrı bir işlem gerekli mi?" → EVET, tek seferlik

Şu an kalıcılık **devre dışı** (kimlik bilgisi yok → veri bellekte). Aktifleştirmek için:

1. **Firebase projesi seç/oluştur** — [console.firebase.google.com](https://console.firebase.google.com).
   (Mevcut config'teki `empyrean-rhythm-66d0h` AI Studio yönetimli bir projedir;
   kendi üretimin için **kendi projeni** açman önerilir.)
2. **Firestore'u etkinleştir** (Build → Firestore Database → Create database).
   - Varsayılan veritabanı `(default)` kullanılacaksa `firebase-applet-config.json`
     içindeki `firestoreDatabaseId` alanını `"(default)"` yap.
3. **Güvenlik kurallarını yükle:**
   ```bash
   firebase deploy --only firestore:rules
   ```
4. **App Hosting/Cloud Run service account'una rol ver** (Firestore yazma):
   IAM'de çalışma zamanı SA'sına **"Cloud Datastore User"** rolü ekle.

GCP dışı host (Vercel vb.) kullanıyorsan: Firebase Console → Project Settings →
Service accounts → "Generate new private key" → JSON'u `FIREBASE_SERVICE_ACCOUNT`
ortam değişkenine (tek satır) koy. **JSON'u repoya KOYMA** (`.gitignore` kapsar).

---

## 2. GitHub'a yükle

```bash
# (Proje kökünde — git zaten init edildi ve ilk commit atıldı)
gh repo create business-card-intelligence-platform --private --source=. --remote=origin --push
# gh yoksa: GitHub'da boş repo aç, sonra:
#   git remote add origin https://github.com/<kullanıcı>/<repo>.git
#   git branch -M main && git push -u origin main
```

> Repoyu **private** açman önerilir (savunma temalı içerik).
> `firebase-applet-config.json` içindeki `apiKey` bir **web** anahtarıdır
> (gizli değildir; güvenlik Firestore kuralları + App Check ile sağlanır), commit'lenmesi normaldir.
> Gerçek sırlar (`SESSION_SECRET`, `GEMINI_API_KEY`, service account) **asla** commit'lenmez.

---

## 3A. Firebase App Hosting ile yayına al (önerilen)

```bash
npm i -g firebase-tools
firebase login

# Sırları Secret Manager'a ekle (apphosting.yaml bunlara referans verir):
firebase apphosting:secrets:set SESSION_SECRET     # güçlü rastgele değer gir
firebase apphosting:secrets:set GEMINI_API_KEY     # Gemini API anahtarın

# Backend oluştur ve GitHub repo'suna bağla (interaktif):
firebase apphosting:backends:create --project <PROJE_ID>
```

Bağlandıktan sonra her `git push` otomatik build+deploy tetikler. `apphosting.yaml`
zaten `NODE_ENV=production`, `ALLOW_DEMO_ROLE_SWITCH=false` ve sır referanslarını içerir.

`SESSION_SECRET` üret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 3B. Cloud Run ile (alternatif)

```bash
gcloud run deploy bcip --source . --region europe-west1 --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,ALLOW_DEMO_ROLE_SWITCH=false \
  --set-secrets SESSION_SECRET=SESSION_SECRET:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest
```
(Çalışma zamanı SA'sına "Cloud Datastore User" rolü vermeyi unutma.)

---

## 4. Yayın sonrası doğrulama

- Dashboard → Sistem Sağlık: `dbConnected: true` görünmeli (Firestore bağlı).
- Bir kartvizit yükle → gerçek OCR çıktısı (`provider: gemini`) gelmeli.
- Denetim Günlüğü → "Zincir Bütünlüğü Doğrula" → "ZİNCİR SAĞLAM".
- MFA rozetine tıkla → TOTP kurulumunu test et.

Güvenlik sertleştirme kontrol listesi: [SECURITY.md](SECURITY.md) §4.
