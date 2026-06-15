# Güvenlik Mimarisi & Sertleştirme Notları (B-CIP)

Bu belge, **Business Card Intelligence Platform** üzerinde uygulanan güvenlik
kontrollerini, bunların _gerçekten_ nerede zorunlu kılındığını ve gerçek bir
savunma sanayii / kamu dağıtımı için kalan adımları açıklar.

> İlke: Güvenlik kontrolleri **backend'de** zorunlu kılınır. Frontend kontrolleri
> yalnızca kullanıcı deneyimi içindir; hiçbir yetki kararı istemciye bırakılmaz.

---

## 1. Uygulanan kontroller (kod içinde gerçek)

| Kontrol | Nerede | Açıklama |
|---|---|---|
| İmzalı oturum (HMAC-SHA256) | `src/server/security.ts` → `signSession`/`verifySession` | Sabit token yerine süreli, imzalı, timing-safe doğrulanan token. httpOnly + SameSite=Strict cookie. |
| Per-request yetki | `server.ts` → `resolveUser`/`requireAuth`/`requireRole` | Global mutable `currentUser` kaldırıldı. Yetki, token'daki değil **DB'deki güncel** role/duruma göre verilir. |
| Privilege escalation kapatıldı | `server.ts` → `/api/auth/login` | İstemci artık kendi rolünü seçemez; yeni kayıtlar daima `user`. |
| Rate limiting | `security.ts` → `rateLimit` | auth/mfa/upload/ocr/export uçlarında IP+route kayan pencere. |
| Dosya imzası (magic-byte) | `security.ts` → `checkUpload`/`detectFileType` | İstemci MIME'ına güvenilmez; gerçek bayt imzası doğrulanır (JPEG/PNG/WEBP/GIF/PDF). Boyut limiti 10MB. |
| Input doğrulama + sanitizasyon | `security.ts` → `validate`/`sanitizeString` | Kontrol karakteri/null-byte temizliği, uzunluk sınırı, enum/regex doğrulama. Tüm mutasyon uçlarında. |
| Sıkılaştırılmış başlıklar | `security.ts` → `securityHeaders` | CSP'den `unsafe-eval` çıkarıldı, `frame-ancestors 'none'` (yazım düzeltildi), HSTS, Referrer-Policy, Permissions-Policy. |
| Güvenli hata yönetimi | `server.ts` global error handler | Üretimde stack/iç detay sızdırmaz; jenerik mesaj döner. |
| Son-admin kilitlenme koruması | `server.ts` → `/api/admin/users/:id/role` | Tek aktif admin kendini düşüremez/askıya alamaz. |
| Soft delete | `server.ts` → `DELETE /api/cards/:id` | İlişkili contact `is_deleted=true` ile izole edilir. |
| Audit log | `server.ts` → `createAuditLog` | Giriş, OCR, yükleme, doğrulama, export, yetki değişikliği, engellenen erişim vb. |
| Regex alan doğrulama | `src/server/parser.ts` → `validateAndScore` | E-posta/telefon/web/LinkedIn regex; başarısız alan güveni düşürülür ve uyarı eklenir. |
| OCR sağlayıcı adaptörü | `parser.ts` → `getProvider` | `OCR_PROVIDER` ile değiştirilebilir (gemini/tesseract/vision/textract/custom). |
| Duplicate tespiti | `parser.ts` → `detectDuplicate` | E-posta / telefon / ad+şirket eşleşmesi → `manual_review`. |
| **Gerçek TOTP MFA (RFC 6238)** | `src/server/totp.ts` + `/api/auth/mfa/enroll`,`/verify` | HMAC-SHA1, 6 hane, 30 sn, ±1 pencere. Google Authenticator uyumlu (resmi RFC test vektörleriyle doğrulandı). Sır base32 saklanır, **asla** client'a sızdırılmaz (`publicUser`). |
| **Gerçek IdP — Firebase ID token** | `firestore-admin.ts` → `getAdminAuth` + `/api/auth/firebase` | Admin SDK `verifyIdToken` ile kriptografik doğrulama; kullanıcı en düşük yetkiyle provision edilir, oturum cookie'si verilir. |
| **Kurcalama-kanıtı audit zinciri** | `src/server/audit-chain.ts` + `/api/admin/audit-logs/verify` | Her kayıt SHA-256 ile bir öncekine bağlanır (`prev_hash`/`entry_hash`). Silme/düzenleme zinciri kırar; doğrulama ucu kırılma noktasını raporlar. |

Bu kontroller `npx tsc --noEmit` ile tip-kontrolünden ve birim/HTTP smoke
testlerinden geçmiştir (token doğrulama, imza reddi, privilege-escalation engeli,
RBAC 401/403, rate limit 429, gerçek OCR akışı).

---

## 2. Demo amaçlı (üretimde değiştirin)

- **`ALLOW_DEMO_ROLE_SWITCH`** — RBAC gösterimi için `/api/auth/dev/switch-role`.
  Üretimde `false` yapın. Gerçek rol yönetimi yalnızca admin'in
  `/api/admin/users/:id/role` ucundan yapılır ve audit'lenir.
- **MFA** — Artık **gerçek TOTP** (RFC 6238) uygulanır (`/api/auth/mfa/enroll`+`/verify`,
  `src/server/totp.ts`). `DEMO_MFA_CODE` yalnızca kullanıcı henüz TOTP'a kayıtlı
  DEĞİLSE geriye dönük uyumluluk için kabul edilir; üretimde MFA'yı zorunlu kılıp
  bu demo dalını kapatın. (İsteğe bağlı sonraki adım: WebAuthn/passkey.)
- **IdP** — Gerçek IdP yolu hazır: `/api/auth/firebase` Firebase ID token'ını Admin
  SDK ile doğrular. Demo e-posta girişi (`/api/auth/login`) hâlâ açıktır; üretimde
  istemciyi Firebase Authentication'a yönlendirip demo girişini kapatın.

---

## 3. Firebase kalıcılığı — Admin SDK (UYGULANDI)

Sunucu kalıcılığı artık **Firebase Admin SDK** ile yapılır
(`src/server/firestore-admin.ts`). Admin SDK güvenlik kurallarını baypas eder;
yetkilendirme zaten `requireAuth` / `requireRole` katmanında uygulanır. Açılışta
Firestore'dan yüklenir (boşsa seed yazılır), çalışma sırasında yazımlar Firestore'a
yansıtılır → veri restart'lar arası kalıcıdır.

**Kimlik bilgisi sağlama** (öncelik sırası, `firestore-admin.ts` → `resolveCredential`):

1. `FIREBASE_SERVICE_ACCOUNT` — inline servis hesabı JSON'u (Vercel vb.).
2. `GOOGLE_APPLICATION_CREDENTIALS` — servis hesabı JSON dosya yolu.
3. GCP yönetimli ortam (Cloud Run/Functions/App Engine) — metadata'dan ADC (otomatik).
4. `FIREBASE_ADMIN_ADC=true` — ADC'yi açıkça zorla.

Hiçbiri yoksa kalıcılık **temiz biçimde devre dışı** kalır (in-memory fallback;
sunucu çökmez). Named Firestore veritabanı (ör. `ai-studio-...`) desteklenir.
Kimlik bilgisi yapılandırılmış ama erişilemezse, açılış seed hatası yakalanır ve
sunucu yine de ayağa kalkar (zarif bozulma — her ikisi de test edildi).

> İstemci tarafı doğrudan Firestore erişimi kullanacaksa, `firestore.rules` mevcut
> sıkı haliyle korunur (istemci yalnızca kendi yetkili kayıtlarına erişir).

---

## 4. Üretim dağıtım kontrol listesi

- [ ] `SESSION_SECRET` güçlü, rastgele değerle ayarlandı.
- [ ] `ALLOW_DEMO_ROLE_SWITCH=false`.
- [ ] `NODE_ENV=production` (Secure cookie + debug kapalı + statik `dist`).
- [ ] Gerçek IdP bağlandı (Firebase Auth — `/api/auth/firebase` hazır; istemci ID token gönderir) ve demo girişi kapatıldı.
- [x] **TOTP MFA uygulandı** (RFC 6238, `src/server/totp.ts`) — üretimde zorunlu kılın ve demo MFA dalını kapatın.
- [x] **Kurcalama-kanıtı audit zinciri uygulandı** (`audit-chain.ts`, `/api/admin/audit-logs/verify`) — periyodik bütünlük denetimi planlayın.
- [ ] Firebase **Admin SDK** kimlik bilgisi sağlandı (kod hazır — `FIREBASE_SERVICE_ACCOUNT` / `GOOGLE_APPLICATION_CREDENTIALS` / GCP ADC). Kalıcılığın `dbConnected:true` raporladığı doğrulandı.
- [ ] HTTPS/TLS terminasyonu (reverse proxy) ve `X-Forwarded-For` güveni doğru yapılandırıldı.
- [ ] WAF / dış rate limit (uygulama içi sınır savunma derinliğinin bir katmanıdır).
- [ ] Audit logları değişmez (append-only) depoya / SIEM'e aktarılıyor.
- [ ] Gizli anahtarlar sır yöneticisinde (env dosyası repoda değil — `.gitignore` kapsıyor).
