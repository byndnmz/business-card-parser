import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { createPersistence, getAdminAuth, type Persistence } from "./src/server/firestore-admin";
import { uploadCardImage, readCardImageBase64, streamCardImage, deleteCardImage, storageEnabled } from "./src/server/storage";
import { ensureRapidOcrSidecar } from "./src/server/rapidocr-sidecar";
import { generateSecret, verifyTOTP, otpauthURI } from "./src/server/totp";
import { rebuildChain, verifyChain, computeHash, GENESIS_HASH, type ChainEntry } from "./src/server/audit-chain";
import {
  securityHeaders,
  rateLimit,
  validate,
  sanitizeString,
  checkUpload,
  signSession,
  verifySession,
  parseCookie,
  setSessionCookie,
  clearSessionCookie,
  hashPassword,
  verifyPassword,
  type Schema,
} from "./src/server/security";
import { parseBusinessCard, detectDuplicate, type ParsedCard } from "./src/server/parser";

dotenv.config({ path: [".env.local", ".env"] });

const app = express();
// Cloud Run / Firebase App Hosting PORT'u ortamdan enjekte eder.
const PORT = Number(process.env.PORT) || 3000;

// JSON gövde ayrıştırma. Toplu yükleme 50 dosyaya kadar base64 içerik taşıyabilir.
app.use(express.json({ limit: "60mb" }));

// Sıkılaştırılmış güvenlik başlıkları (security.ts — gerçek uygulanır, yorum değil).
app.use(securityHeaders());

// Geçersiz/aşırı büyük JSON gövdelerini güvenli biçimde reddet (stack sızdırmadan).
app.use((err: any, _req: any, res: any, next: any) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "İstek gövdesi izin verilen boyutu aşıyor." });
  }
  if (err?.status === 400 && err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Geçersiz JSON gövdesi." });
  }
  next(err);
});

// Setup Server-side Firestore persistence (ADMIN SDK — kuralları baypas eder,
// yetki requireAuth/requireRole'da uygulanır). Kimlik bilgisi yoksa in-memory'e düşer.
let persistence: Persistence;
{
  let projectId = "";
  let databaseId: string | undefined;
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
      projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId || "";
      databaseId = process.env.FIRESTORE_DATABASE_ID || firebaseConfig.firestoreDatabaseId;
    } else {
      console.warn("[FIREBASE] firebase-applet-config.json bulunamadı — in-memory mod.");
    }
  } catch (err) {
    console.error("[FIREBASE] Yapılandırma okuma hatası:", err);
  }
  persistence = createPersistence(projectId, databaseId);
}

// Setup Server-side Gemini API
const geminiApiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (geminiApiKey) {
  try {
    ai = new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  } catch (err) {
    console.error("Gemini initialization failed:", err);
  }
}


// Global In-Memory Store (Fallbacks for demonstration/sandbox and instant readiness)
// High-fidelity pre-populated defense industry card intelligence database
let dbUsers = [
  { id: "u-1", full_name: "Ahmet Sadık Şahiner", email: "sahinerahmet32@gmail.com", role: "admin", mfa_enabled: true, status: "active", created_at: "2026-06-15T09:00:00Z" },
  { id: "u-2", full_name: "Kemal Demir", email: "demirk@havelsan.mss", role: "operator", mfa_enabled: true, status: "active", created_at: "2026-06-15T09:10:00Z" },
  { id: "u-3", full_name: "Selin Yılmaz", email: "selin.y@aselsan.com.tr", role: "auditor", mfa_enabled: true, status: "active", created_at: "2026-06-15T09:15:00Z" },
  { id: "u-4", full_name: "Caner Kara", email: "caner.kara@shm.gov.tr", role: "user", mfa_enabled: false, status: "active", created_at: "2026-06-15T09:20:00Z" }
];

let dbAuditLogs: any[] = [
  { id: "log-1", user_id: "u-1", action: "PLATFORM_INIT", entity_type: "system", entity_id: "platform-0", old_value: "", new_value: "Savunma Sanayii Business Card Intelligence initialized", ip_address: "127.0.0.1", user_agent: "Node/Express Server", created_at: "2026-06-15T09:22:15Z" }
];

let dbTags = [
  { id: "tag-1", name: "Savunma Sanayii", color: "#3B82F6", created_by: "u-1", created_at: "2026-06-15T09:00:00Z" },
  { id: "tag-2", name: "Kamu Kurumu", color: "#EF4444", created_by: "u-1", created_at: "2026-06-15T09:01:00Z" },
  { id: "tag-3", name: "Kritik Temas", color: "#F59E0B", created_by: "u-1", created_at: "2026-06-15T09:02:00Z" },
  { id: "tag-4", name: "Tedarikçi", color: "#10B981", created_by: "u-1", created_at: "2026-06-15T09:03:00Z" }
];

let dbContactTags = [
  { id: "ct-1", contact_id: "contact-1", tag_id: "tag-1" },
  { id: "ct-2", contact_id: "contact-1", tag_id: "tag-3" },
  { id: "ct-3", contact_id: "contact-2", tag_id: "tag-2" },
  { id: "ct-4", contact_id: "contact-3", tag_id: "tag-1" },
  { id: "ct-5", contact_id: "contact-3", tag_id: "tag-4" }
];

let dbBusinessCards = [
  {
    id: "card-1",
    owner_user_id: "u-1",
    image_url: "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?q=80&w=600&auto=format&fit=crop",
    processing_status: "success",
    confidence_score: 0.96,
    source_type: "web",
    batch_id: "batch-1",
    created_at: "2026-06-15T09:05:00Z",
    updated_at: "2026-06-15T09:06:00Z"
  },
  {
    id: "card-2",
    owner_user_id: "u-1",
    image_url: "https://images.unsplash.com/photo-1516245834210-c4c142787335?q=80&w=600&auto=format&fit=crop",
    processing_status: "pending_verification",
    confidence_score: 0.61,
    source_type: "web",
    batch_id: "batch-1",
    created_at: "2026-06-15T09:07:00Z",
    updated_at: "2026-06-15T09:07:44Z"
  },
  {
    id: "card-3",
    owner_user_id: "u-2",
    image_url: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?q=80&w=600&auto=format&fit=crop",
    processing_status: "success",
    confidence_score: 0.94,
    source_type: "ios",
    batch_id: "",
    created_at: "2026-06-15T09:12:00Z",
    updated_at: "2026-06-15T09:12:44Z"
  }
];

let dbBusinessCardFields = [
  // Fields for card 1 (Ahmet Şahiner)
  { id: "field-1", business_card_id: "card-1", field_name: "full_name", field_value: "Ahmet Sadık Şahiner", confidence_score: 0.98, bounding_box_x: 10, bounding_box_y: 20, bounding_box_width: 50, bounding_box_height: 8, is_verified: true },
  { id: "field-2", business_card_id: "card-1", field_name: "title", field_value: "Siber Güvenlik Grup Lideri", confidence_score: 0.95, bounding_box_x: 10, bounding_box_y: 29, bounding_box_width: 45, bounding_box_height: 6, is_verified: true },
  { id: "field-3", business_card_id: "card-1", field_name: "company", field_value: "Limit Savunma Teknolojileri", confidence_score: 0.99, bounding_box_x: 60, bounding_box_y: 10, bounding_box_width: 35, bounding_box_height: 12, is_verified: true },
  { id: "field-4", business_card_id: "card-1", field_name: "email", field_value: "ahmet@limitsavunma.mss", confidence_score: 0.98, bounding_box_x: 10, bounding_box_y: 65, bounding_box_width: 40, bounding_box_height: 5, is_verified: true },
  { id: "field-5", business_card_id: "card-1", field_name: "phone", field_value: "+90 312 444 88 55", confidence_score: 0.97, bounding_box_x: 10, bounding_box_y: 72, bounding_box_width: 40, bounding_box_height: 5, is_verified: true },
  { id: "field-6", business_card_id: "card-1", field_name: "address", field_value: "Savunma Sanayii Vadisi, Blok B, Ankara", confidence_score: 0.92, bounding_box_x: 10, bounding_box_y: 80, bounding_box_width: 75, bounding_box_height: 6, is_verified: true },

  // Fields for card 2 (Aylin Arslan - Düşük güvenli)
  { id: "field-7", business_card_id: "card-2", field_name: "full_name", field_value: "Dr. Aylin Arslan", confidence_score: 0.85, bounding_box_x: 8, bounding_box_y: 15, bounding_box_width: 48, bounding_box_height: 7, is_verified: false },
  { id: "field-8", business_card_id: "card-2", field_name: "title", field_value: "Yapay Zeka Ar-Ge Direktörü", confidence_score: 0.45, bounding_box_x: 8, bounding_box_y: 23, bounding_box_width: 50, bounding_box_height: 5, is_verified: false },
  { id: "field-9", business_card_id: "card-2", field_name: "company", field_value: "Askeri Yapay Zeka Sistemleri A.Ş.", confidence_score: 0.91, bounding_box_x: 55, bounding_box_y: 15, bounding_box_width: 40, bounding_box_height: 10, is_verified: false },
  { id: "field-10", business_card_id: "card-2", field_name: "email", field_value: "aylin.arslan@havelsan.com.tr", confidence_score: 0.35, bounding_box_x: 8, bounding_box_y: 60, bounding_box_width: 45, bounding_box_height: 5, is_verified: false },
  { id: "field-11", business_card_id: "card-2", field_name: "phone", field_value: "+90 532 999 00 11", confidence_score: 0.95, bounding_box_x: 8, bounding_box_y: 67, bounding_box_width: 42, bounding_box_height: 5, is_verified: false }
];

let dbContacts = [
  {
    id: "contact-1",
    business_card_id: "card-1",
    first_name: "Ahmet",
    last_name: "Şahiner",
    full_name: "Ahmet Sadık Şahiner",
    title: "Siber Güvenlik Grup Lideri",
    company: "Limit Savunma Teknolojileri",
    department: "Siber Savunma Dairesi",
    email: "ahmet@limitsavunma.mss",
    phone: "+90 312 444 88 55",
    mobile_phone: "+90 505 111 22 33",
    website: "https://limitsavunma.mss",
    address: "Savunma Sanayii Vadisi, Blok B, Ankara",
    city: "Ankara",
    country: "Türkiye",
    linkedin: "linkedin.com/in/ahmet-sahiner",
    notes: "Ankara Savunma Kurultayında tanışıldı. Kritik siber güvenlik danışmanı.",
    owner_id: "u-1",
    is_deleted: false,
    created_at: "2026-06-15T09:06:00Z",
    updated_at: "2026-06-15T09:06:00Z"
  },
  {
    id: "contact-2",
    business_card_id: "card-2",
    first_name: "Aylin",
    last_name: "Arslan",
    full_name: "Aylin Arslan",
    title: "Yapay Zeka Ar-Ge Direktörü",
    company: "Askeri Yapay Zeka Sistemleri A.Ş.",
    department: "Ar-Ge Genel Müdürlüğü",
    email: "aylin.arslan@havelsan.com.tr",
    phone: "+90 532 999 00 11",
    mobile_phone: "",
    website: "ayz-savunma.mss",
    address: "Kritik Sistemler Yerleşkesi, Çankaya",
    city: "Ankara",
    country: "Türkiye",
    linkedin: "linkedin.com/in/aylin-arslan-ai",
    notes: "Doğrulama bekliyor.",
    owner_id: "u-1",
    is_deleted: false,
    created_at: "2026-06-15T09:07:44Z",
    updated_at: "2026-06-15T09:07:44Z"
  },
  {
    id: "contact-3",
    business_card_id: "card-3",
    first_name: "Selim",
    last_name: "Kaya",
    full_name: "Selim Kaya",
    title: "Roket Motorları Başmühendisi",
    company: "ROKETSAN Roket Sanayii A.Ş.",
    department: "Sevk Sistemleri Müdürlüğü",
    email: "s.kaya@roketsan.com.tr",
    phone: "+90 312 860 55 00",
    mobile_phone: "",
    website: "roketsan.com.tr",
    address: "Kemalpaşa Mah. Şehitler Cad. No:9, Elmadağ",
    city: "Ankara",
    country: "Türkiye",
    linkedin: "linkedin.com/in/selimkaya-engines",
    notes: "Savunma Sanayii ihale süreci irtibat kişisi.",
    owner_id: "u-2",
    is_deleted: false,
    created_at: "2026-06-15T09:12:44Z",
    updated_at: "2026-06-15T09:12:44Z"
  }
];

let dbBatches = [
  { id: "batch-1", created_by: "u-1", total_files: 2, processed_files: 2, failed_files: 0, status: "completed", created_at: "2026-06-15T09:05:00Z", completed_at: "2026-06-15T09:07:44Z" }
];

let dbExports: any[] = [];
const dbExportFiles = new Map<string, { filename: string; mimeType: string; content: string; isBase64?: boolean }>();

// --- KALICILIK HELPER'LARI (Admin SDK üzerinden) ---
async function saveToFirestore(collectionName: string, id: string, data: any) {
  await persistence.save(collectionName, id, data);
}

async function removeFromFirestore(collectionName: string, id: string) {
  await persistence.remove(collectionName, id);
}

/**
 * Açılışta: kalıcılık etkinse Firestore'dan yükle (boşsa seed verisini yaz),
 * etkin değilse bellekteki seed verisiyle devam et. Boş koleksiyon = seed; dolu
 * koleksiyon = bellek cache'ini Firestore'dan doldur.
 */
async function initFirebaseAndSeed() {
  if (!persistence.enabled) {
    console.log("[FIREBASE] Kalıcılık devre dışı — tamamen in-memory simülasyon ile çalışılıyor.");
    return;
  }
  // [koleksiyon adı, bellek getter, bellek setter, seed yazılsın mı]
  const collections: Array<[string, () => any[], (v: any[]) => void, boolean]> = [
    ["tags", () => dbTags, (v) => (dbTags = v), true],
    ["users", () => dbUsers, (v) => (dbUsers = v), true],
    ["business_cards", () => dbBusinessCards, (v) => (dbBusinessCards = v), true],
    ["business_card_fields", () => dbBusinessCardFields, (v) => (dbBusinessCardFields = v), true],
    ["contacts", () => dbContacts, (v) => (dbContacts = v), true],
    ["contact_tags", () => dbContactTags, (v) => (dbContactTags = v), true],
    ["batches", () => dbBatches, (v) => (dbBatches = v), true],
    ["audit_logs", () => dbAuditLogs, (v) => (dbAuditLogs = v), true],
    ["exports", () => dbExports, (v) => (dbExports = v), false], // exports seed'lenmez
  ];

  try {
    console.log("[FIREBASE LOAD] Firestore (Admin SDK) ile veri senkronizasyonu...");
    for (const [name, get, set, doSeed] of collections) {
      const loaded = await persistence.loadAll(name);
      if (loaded.length === 0) {
        if (doSeed) {
          console.log(`[FIREBASE SEED] '${name}' koleksiyonu seed'leniyor...`);
          for (const item of get()) {
            await persistence.save(name, (item as any).id, item);
          }
        }
      } else {
        set(loaded);
      }
    }
    console.log("[FIREBASE LOAD SUCCESS] Sunucu bellek cache'i Firestore ile senkron.");
  } catch (error) {
    console.error("[FIREBASE LOAD ERROR] Açılış senkron/seed hatası:", error);
  }
}

// --- KURCALAMA-KANITI AUDIT ZİNCİRİ (tamper-evident) ---
// Her kayıt bir öncekinin hash'ine bağlanır; sonradan değişiklik zinciri kırar.
let auditSeq = 0;
let auditHead = GENESIS_HASH;

/** Açılışta mevcut logları kronolojik zincire dönüştürür (head/seq ayarlanır). */
function initAuditChain() {
  const rebuilt = rebuildChain(dbAuditLogs as ChainEntry[]);
  dbAuditLogs = rebuilt.entries as any[];
  // Bellek görünümü en yeni-önce; dizinin başına gelecek için ters çevir.
  dbAuditLogs.reverse();
  auditSeq = rebuilt.nextSeq;
  auditHead = rebuilt.head.entry_hash;
}

// Curried Helper for creating logs (Audit System)
function createAuditLog(userId: string, action: string, entityType: string, entityId: string, oldVal: any, newVal: any, ip: string, userAgent: string) {
  const seq = auditSeq++;
  const newLog: ChainEntry = {
    id: `log-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
    seq,
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    old_value: oldVal ? JSON.stringify(oldVal) : "",
    new_value: newVal ? JSON.stringify(newVal) : "",
    ip_address: ip || "127.0.0.1",
    user_agent: userAgent || "Unknown Client",
    created_at: new Date().toISOString(),
    prev_hash: auditHead,
  };
  newLog.entry_hash = computeHash(auditHead, newLog);
  auditHead = newLog.entry_hash;
  dbAuditLogs.unshift(newLog);
  saveToFirestore("audit_logs", newLog.id, newLog);
  console.log(`[AUDIT SECURE LOG] #${seq} ${action} - User: ${userId} - Entity: ${entityType}/${entityId}`);
  return newLog;
}

/** Açılışta yönetici (admin) hesabını garanti eder — parolalı giriş için.
 *  Kullanıcı adı: admin · Parola: ADMIN_PASSWORD env (varsayılan "Beyond.1234").
 *  Mevcut Firestore'da yoksa eklenir (in-memory ya da boş DB'de seed ile gelir). */
function ensureAdminUser() {
  const existing = dbUsers.find((u: any) => (u.username || "").toLowerCase() === "admin");
  const pw = process.env.ADMIN_PASSWORD || "Beyond.1234";
  if (existing) {
    // Parola hash'i yoksa (eski kayıt) ekle — giriş çalışsın.
    if (!(existing as any).password_hash) {
      (existing as any).password_hash = hashPassword(pw);
      (existing as any).username = "admin";
      saveToFirestore("users", existing.id, existing);
    }
    return;
  }
  const admin: any = {
    id: "u-admin",
    full_name: "Sistem Yöneticisi",
    email: "admin@beyond.local",
    username: "admin",
    role: "admin",
    mfa_enabled: false,
    status: "active",
    password_hash: hashPassword(pw),
    created_at: new Date().toISOString(),
  };
  dbUsers.push(admin);
  saveToFirestore("users", admin.id, admin);
  console.log("[AUTH] 'admin' yönetici hesabı hazır (parolalı giriş).");
}

/** Kullanıcı nesnesini istemciye dönmeden önce sırları (mfa_secret, parola) çıkarır. */
function publicUser(u: any) {
  if (!u) return u;
  const { mfa_secret, password_hash, ...safe } = u;
  return safe;
}

// --- OTURUM ÇÖZÜMLEME (PER-REQUEST, STATELESS İMZALI TOKEN) ----------------
// Global mutable `currentUser` KALDIRILDI: tek bir paylaşılan değişken hem
// eşzamanlılık (her istemci diğerinin oturumunu eziyordu) hem de yetki açığıydı.
// Artık her istek, httpOnly imzalı cookie'sinden bağımsız çözümlenir ve YETKİ,
// token'daki role değil, veritabanındaki GÜNCEL role/duruma göre belirlenir.

// Çıkış yapılan token'ları geçersiz kılmak için iptal listesi (revocation).
const revokedTokens = new Set<string>();

function resolveUser(req: any): any | null {
  // Web istemcileri httpOnly cookie kullanır; NATIVE MOBİL (iOS/Android)
  // uygulamalar ise Authorization: Bearer <token> başlığını kullanır.
  // login/dev-switch/firebase uçları zaten body'de `token` döndürür.
  const cookieTok = parseCookie(req, "bcip_session");
  const authHeader = req.headers["authorization"];
  const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  const token = cookieTok || bearer;
  if (!token || revokedTokens.has(token)) return null;
  const payload = verifySession(token);
  if (!payload) return null;
  // Yetkiyi DB'deki güncel kayıttan al (rol değişikliği / askıya alma anında etki etsin).
  const user = dbUsers.find((u) => u.id === payload.sub);
  if (!user || user.status === "suspended") return null;
  return user;
}

/** requireAuth'tan sonra istek üzerindeki çözümlenmiş kullanıcıya erişir. */
function actor(req: any): any {
  return req.authUser;
}

function clientIp(req: any): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip ||
    "0.0.0.0"
  );
}

// --- KİMLİK DOĞRULAMA MIDDLEWARE (GERÇEK OTURUM DOĞRULAMASI) ---------------
function requireAuth(req: any, res: any, next: any) {
  const user = resolveUser(req);
  if (!user) {
    return res
      .status(401)
      .json({ error: "Erişim Reddedildi. Geçerli bir oturum bulunamadı veya hesap askıya alınmış." });
  }
  req.authUser = user;
  next();
}

function requireRole(roles: string[]) {
  return (req: any, res: any, next: any) => {
    const user = req.authUser || resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: "Erişim Reddedildi. Oturum doğrulanamadı." });
    }
    if (!roles.includes(user.role)) {
      createAuditLog(
        user.id,
        "UNAUTHORIZED_ACCESS_BLOCKED",
        "route",
        req.path,
        null,
        { requiredRoles: roles, userRole: user.role },
        clientIp(req),
        req.headers["user-agent"] || "Agent"
      );
      return res.status(403).json({ error: `Erişim Engellendi. Bu işlem için ${roles.join(", ")} rollerinden biri gerekmektedir.` });
    }
    req.authUser = user;
    next();
  };
}

// Hız sınırlayıcılar (security.ts): kaba kuvvet ve kötüye kullanım yüzeyini daraltır.
const authLimiter = rateLimit({ windowMs: 60_000, max: 10, key: "auth" });
const mfaLimiter = rateLimit({ windowMs: 60_000, max: 5, key: "mfa" });
const uploadLimiter = rateLimit({ windowMs: 60_000, max: 30, key: "upload" });
const batchLimiter = rateLimit({ windowMs: 60_000, max: 120, key: "batch" });
const ocrLimiter = rateLimit({ windowMs: 60_000, max: 30, key: "ocr" });
const exportLimiter = rateLimit({ windowMs: 60_000, max: 20, key: "export" });

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
const VALID_ROLES = ["admin", "operator", "auditor", "user"] as const;

// --- ENDPOINTS ---

// Auth Endpoints
app.post("/api/auth/login", authLimiter, (req, res) => {
  // Kullanıcı adı VEYA e-posta + PAROLA ile giriş (gerçek oturum doğrulaması).
  const identifier = sanitizeString(req.body?.username ?? req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!identifier || !password) {
    return res.status(400).json({ error: "Kullanıcı adı/e-posta ve parola gereklidir." });
  }

  const user = dbUsers.find(
    (u: any) =>
      ((u.username || "").toLowerCase() === identifier) ||
      ((u.email || "").toLowerCase() === identifier)
  ) as any;

  // GÜVENLİK: kullanıcı yok / parola yok / parola yanlış → aynı jenerik hata
  // (kullanıcı sayımı/enumeration engellenir). Otomatik kayıt KALDIRILDI.
  if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
    createAuditLog("anonymous", "LOGIN_FAILED", "auth", "login", null, { identifier }, clientIp(req), req.headers["user-agent"] || "Web Agent");
    return res.status(401).json({ error: "Kullanıcı adı veya parola hatalı." });
  }

  if (user.status === "suspended") {
    createAuditLog(user.id, "LOGIN_BLOCKED_SUSPENDED", "users", user.id, null, null, clientIp(req), req.headers["user-agent"] || "Web Agent");
    return res.status(403).json({ error: "Hesabınız askıya alınmış. Yöneticinizle iletişime geçin." });
  }

  const token = signSession({ sub: user.id, role: user.role, email: user.email });
  setSessionCookie(res, token);

  createAuditLog(
    user.id,
    "USER_LOGIN_SUCCESS",
    "users",
    user.id,
    null,
    { role: user.role, mfa: user.mfa_enabled },
    clientIp(req),
    req.headers["user-agent"] || "Web Agent"
  );

  res.json({ user: publicUser(user), token });
});

// DEMO-ONLY: RBAC gösterimi için rol değiştirme. Üretimde ALLOW_DEMO_ROLE_SWITCH=false
// ile KAPATILMALIDIR. Gerçek rol yönetimi yalnızca admin'in /api/admin/users/:id/role
// endpoint'i üzerinden yapılır.
app.post("/api/auth/dev/switch-role", requireAuth, (req, res) => {
  if (process.env.ALLOW_DEMO_ROLE_SWITCH === "false") {
    return res.status(403).json({ error: "Rol değiştirme bu ortamda devre dışı." });
  }
  const role = sanitizeString(req.body?.role, 20);
  if (!VALID_ROLES.includes(role as any)) {
    return res.status(400).json({ error: "Geçersiz rol." });
  }
  const user = actor(req);
  const oldRole = user.role;
  user.role = role;
  saveToFirestore("users", user.id, user);

  const token = signSession({ sub: user.id, role: user.role, email: user.email });
  setSessionCookie(res, token);

  createAuditLog(
    user.id,
    "DEMO_ROLE_SWITCH",
    "users",
    user.id,
    { role: oldRole },
    { role: user.role },
    clientIp(req),
    req.headers["user-agent"] || "Web Agent"
  );
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  const token = parseCookie(req, "bcip_session");
  if (token) revokedTokens.add(token);
  clearSessionCookie(res);
  createAuditLog(
    actor(req).id,
    "USER_LOGOUT",
    "users",
    actor(req).id,
    null,
    null,
    clientIp(req),
    req.headers["user-agent"] || "Web Agent"
  );
  res.json({ success: true, message: "Oturum güvenli şekilde sonlandırıldı." });
});

// MFA kaydı (enrollment) — gerçek TOTP sırrı üretir ve otpauth URI döner.
// Sır yalnızca kayıt sırasında BİR KEZ dönülür; doğrulanana dek mfa_enabled=false.
app.post("/api/auth/mfa/enroll", requireAuth, mfaLimiter, (req, res) => {
  const user = actor(req);
  const secret = generateSecret();
  user.mfa_secret = secret;
  user.mfa_enabled = false; // doğrulanana kadar etkin değil
  saveToFirestore("users", user.id, user);
  createAuditLog(user.id, "MFA_ENROLL_INITIATED", "users", user.id, null, null, clientIp(req), req.headers["user-agent"] || "Web Agent");
  res.json({
    secret, // QR yoksa elle girmek için
    otpauth: otpauthURI(secret, user.email),
    issuer: "B-CIP",
  });
});

app.post("/api/auth/mfa/verify", requireAuth, mfaLimiter, (req, res) => {
  const code = sanitizeString(req.body?.code, 12);
  const user = actor(req);

  // 1) Kullanıcı gerçek TOTP'a kayıtlıysa RFC 6238 doğrulaması yap.
  if (user.mfa_secret) {
    if (verifyTOTP(user.mfa_secret, code)) {
      user.mfa_enabled = true;
      saveToFirestore("users", user.id, user);
      createAuditLog(user.id, "MFA_VERIFIED_TOTP", "users", user.id, null, "TOTP verified", clientIp(req), req.headers["user-agent"] || "Web Agent");
      return res.json({ success: true, method: "totp" });
    }
    createAuditLog(user.id, "MFA_FAILED", "users", user.id, null, { method: "totp" }, clientIp(req), req.headers["user-agent"] || "Web Agent");
    return res.status(400).json({ error: "TOTP doğrulama kodu hatalı veya süresi geçmiş." });
  }

  // 2) Henüz TOTP'a kayıtlı değilse, demo kodu geriye dönük uyumluluk için kabul edilir.
  //    (Üretimde MFA zorunlu kılınırsa bu dal kaldırılmalıdır.)
  const demoCode = process.env.DEMO_MFA_CODE || "145399";
  if (code === demoCode) {
    user.mfa_enabled = true;
    saveToFirestore("users", user.id, user);
    createAuditLog(user.id, "MFA_VERIFIED_DEMO", "users", user.id, null, "Demo code (TOTP kaydı yok)", clientIp(req), req.headers["user-agent"] || "Web Agent");
    return res.json({ success: true, method: "demo" });
  }
  createAuditLog(user.id, "MFA_FAILED", "users", user.id, null, { method: "demo" }, clientIp(req), req.headers["user-agent"] || "Web Agent");
  res.status(400).json({ error: "MFA doğrulama kodu hatalı." });
});

// GERÇEK IdP YOLU — Firebase ID token doğrulama (Admin SDK verifyIdToken).
// İstemci Firebase Authentication ile giriş yapıp ID token gönderir; sunucu
// kriptografik olarak doğrular, kullanıcıyı provision eder ve oturum cookie'si verir.
app.post("/api/auth/firebase", authLimiter, async (req, res) => {
  const idToken = typeof req.body?.idToken === "string" ? req.body.idToken : "";
  if (!idToken) {
    return res.status(400).json({ error: "Firebase ID token gereklidir." });
  }
  const adminAuth = getAdminAuth();
  if (!adminAuth) {
    return res.status(503).json({ error: "Kimlik sağlayıcı (Firebase Admin) bu ortamda yapılandırılmamış." });
  }
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = sanitizeString(decoded.email || "", 254).toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(401).json({ error: "Token geçerli bir e-posta içermiyor." });
    }
    // Mevcut kullanıcıyı bul ya da en düşük yetkiyle provision et (rol seçtirilmez).
    let user = dbUsers.find((u) => u.email === email);
    if (!user) {
      user = {
        id: decoded.uid || `u-${Date.now()}`,
        full_name: sanitizeString(decoded.name || email.split("@")[0], 120),
        email,
        role: "user",
        mfa_enabled: false,
        status: "active",
        created_at: new Date().toISOString(),
      };
      dbUsers.push(user);
      saveToFirestore("users", user.id, user);
    }
    if (user.status === "suspended") {
      return res.status(403).json({ error: "Hesabınız askıya alınmış." });
    }
    const token = signSession({ sub: user.id, role: user.role, email: user.email });
    setSessionCookie(res, token);
    createAuditLog(user.id, "USER_LOGIN_FIREBASE_IDP", "users", user.id, null, { provider: decoded.firebase?.sign_in_provider }, clientIp(req), req.headers["user-agent"] || "Web Agent");
    res.json({ user: publicUser(user), token });
  } catch (err) {
    createAuditLog("anonymous", "FIREBASE_IDP_TOKEN_REJECTED", "auth", "firebase", null, null, clientIp(req), req.headers["user-agent"] || "Web Agent");
    res.status(401).json({ error: "Firebase ID token doğrulanamadı." });
  }
});

app.get("/api/auth/me", (req, res) => {
  const user = resolveUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

// Admin Panel endpoints
app.get("/api/admin/dashboard", requireAuth, requireRole(["admin", "auditor"]), (req, res) => {
  // Compute analytics metrics
  const totalCards = dbBusinessCards.length;
  const todayProcessed = dbBusinessCards.filter(c => c.created_at.startsWith("2026-06-15")).length;
  const pendingVerification = dbBusinessCards.filter(c => c.processing_status === "pending_verification").length;
  const lowConfidence = dbBusinessCards.filter(c => c.confidence_score < 0.7 && c.processing_status !== "failed").length;
  const totalBatches = dbBatches.length;
  const totalExportsCount = dbExports.length;
  
  // OCR average confidence
  const validScores = dbBusinessCards.map(c => c.confidence_score).filter(s => s > 0);
  const ocrSuccessRate = validScores.length > 0
    ? Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 100)
    : 95;

  // Most common companies calculation
  const companyCounts: Record<string, number> = {};
  dbContacts.forEach(c => {
    if (c.company) companyCounts[c.company] = (companyCounts[c.company] || 0) + 1;
  });
  const topCompanies = Object.entries(companyCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Most common titles
  const titleCounts: Record<string, number> = {};
  dbContacts.forEach(c => {
    if (c.title) titleCounts[c.title] = (titleCounts[c.title] || 0) + 1;
  });
  const topTitles = Object.entries(titleCounts)
    .map(([title, count]) => ({ name: title, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  res.json({
    metrics: {
      totalCards,
      todayProcessed,
      pendingVerification,
      lowConfidence,
      totalBatches,
      totalExportsCount,
      ocrSuccessRate
    },
    topCompanies,
    topTitles,
    systemHealth: {
      status: "SECURE_OPERATIONAL",
      uptime: process.uptime(),
      dbConnected: persistence.enabled,
      persistenceSource: persistence.source,
      storageMode: storageEnabled() ? "cloud-storage" : "inline-fallback",
      firewallActive: true,
      ocrProvider: process.env.OCR_PROVIDER || "rapidocr",
      ocrModel: (() => {
        const p = (process.env.OCR_PROVIDER || "rapidocr").toLowerCase();
        if (p === "rapidocr") return `rapidocr (yerel/offline sidecar @ ${process.env.RAPIDOCR_SERVICE_URL || "http://127.0.0.1:8765"})`;
        if (p === "tesseract") return "tesseract (offline, self-hosted)";
        if (p === "gemini") return process.env.GEMINI_MODEL || "gemini-2.5-flash";
        return p;
      })(),
      geminiCognitiveEngine: (() => {
        const p = (process.env.OCR_PROVIDER || "rapidocr").toLowerCase();
        if (p === "gemini") return ai ? "ONLINE_ACTIVE" : "GEMINI_KEY_REQUIRED";
        return "LOCAL_OFFLINE_ACTIVE";
      })()
    }
  });
});

app.get("/api/admin/audit-logs", requireAuth, requireRole(["admin", "auditor"]), (req, res) => {
  res.json({ logs: dbAuditLogs });
});

// Audit zincir bütünlüğü doğrulaması — kurcalama (silme/düzenleme) tespiti.
app.get("/api/admin/audit-logs/verify", requireAuth, requireRole(["admin", "auditor"]), (req, res) => {
  const result = verifyChain(dbAuditLogs as ChainEntry[]);
  createAuditLog(
    actor(req).id,
    "AUDIT_CHAIN_INTEGRITY_CHECK",
    "audit_logs",
    "chain",
    null,
    { ok: result.ok, total: result.total },
    clientIp(req),
    req.headers["user-agent"] || "Web Agent"
  );
  res.json(result);
});

app.get("/api/admin/users", requireAuth, requireRole(["admin"]), (req, res) => {
  res.json({ users: dbUsers.map(publicUser) });
});

app.put("/api/admin/users/:id/role", requireAuth, requireRole(["admin"]), (req, res) => {
  const id = sanitizeString(req.params.id, 64);
  const role = req.body?.role ? sanitizeString(req.body.role, 20) : "";
  const status = req.body?.status ? sanitizeString(req.body.status, 20) : "";

  // Enum doğrulaması — geçersiz rol/durum enjeksiyonunu engelle.
  if (role && !VALID_ROLES.includes(role as any)) {
    return res.status(400).json({ error: "Geçersiz rol." });
  }
  if (status && !["active", "suspended"].includes(status)) {
    return res.status(400).json({ error: "Geçersiz hesap durumu." });
  }

  const targetUser = dbUsers.find(u => u.id === id);
  if (!targetUser) {
    return res.status(404).json({ error: "Etkilenen kullanıcı bulunamadı." });
  }

  // Son admin'in kendini yetkisizleştirmesini / askıya almasını engelle (kilitlenme koruması).
  const adminCount = dbUsers.filter((u) => u.role === "admin" && u.status === "active").length;
  const isSelf = targetUser.id === actor(req).id;
  if (isSelf && targetUser.role === "admin" && adminCount <= 1 && (role && role !== "admin" || status === "suspended")) {
    return res.status(409).json({ error: "Sistemdeki son aktif admin kendi yetkisini kaldıramaz/askıya alamaz." });
  }

  const oldVal = { role: targetUser.role, status: targetUser.status };
  if (role) targetUser.role = role;
  if (status) targetUser.status = status;

  saveToFirestore("users", targetUser.id, targetUser);

  createAuditLog(
    actor(req).id,
    "USER_ROLE_OR_STATUS_UPDATE",
    "users",
    id,
    oldVal,
    { role: targetUser.role, status: targetUser.status },
    req.ip || "127.0.0.1",
    req.headers["user-agent"] || "Admin UI"
  );
  
  res.json({ user: publicUser(targetUser) });
});

// business cards routing
app.get("/api/cards", requireAuth, (req, res) => {
  // Operators & Admins & Auditors can view all, ordinary users only view their own
  let visibleCards = [...dbBusinessCards];
  if (actor(req).role === "user") {
    visibleCards = dbBusinessCards.filter(c => c.owner_user_id === actor(req).id);
  }
  
  // Cross join details
  const cardsWithFields = visibleCards.map(card => {
    const fields = dbBusinessCardFields.filter(f => f.business_card_id === card.id);
    const contact = dbContacts.find(c => c.business_card_id === card.id && !c.is_deleted);
    const mappings = dbContactTags.filter(m => m.contact_id === contact?.id);
    const cardTags = mappings.map(m => dbTags.find(t => t.id === m.tag_id)).filter(Boolean);
    
    return {
      ...card,
      fields,
      contact,
      tags: cardTags
    };
  });
  
  // Auditing read access
  createAuditLog(
    actor(req).id,
    "BUSINESS_CARDS_VIEWED",
    "business_cards",
    "all",
    null,
    { count: cardsWithFields.length },
    req.ip || "127.0.0.1",
    req.headers["user-agent"] || "Web Portal"
  );

  res.json({ cards: cardsWithFields });
});

app.get("/api/cards/:id", requireAuth, (req, res) => {
  const { id } = req.params;
  const card = dbBusinessCards.find(c => c.id === id);
  if (!card) {
    return res.status(404).json({ error: "Kart bulunamadı." });
  }

  if (actor(req).role === "user" && card.owner_user_id !== actor(req).id) {
    return res.status(403).json({ error: "Yetkisiz erişim. Bu karta erişim izniniz yok." });
  }

  const fields = dbBusinessCardFields.filter(f => f.business_card_id === card.id);
  const contact = dbContacts.find(c => c.business_card_id === card.id && !c.is_deleted);
  const mappings = dbContactTags.filter(m => m.contact_id === contact?.id);
  const cardTags = mappings.map(m => dbTags.find(t => t.id === m.tag_id)).filter(Boolean);

  res.json({
    card,
    fields,
    contact,
    tags: cardTags
  });
});

app.get("/api/cards/:id/image", requireAuth, async (req, res) => {
  const { id } = req.params;
  const card = dbBusinessCards.find(c => c.id === id) as any;
  if (!card) {
    return res.status(404).json({ error: "Kart bulunamadı." });
  }
  if (actor(req).role === "user" && card.owner_user_id !== actor(req).id) {
    return res.status(403).json({ error: "Yetkisiz erişim. Bu karta erişim izniniz yok." });
  }

  if (card.storage_path) {
    const streamed = await streamCardImage(card.storage_path, res);
    if (streamed || res.headersSent) return;
  }

  const imageUrl = String(card.image_url || "");
  const dataMatch = imageUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (dataMatch) {
    res.setHeader("Content-Type", dataMatch[1]);
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.send(Buffer.from(dataMatch[2], "base64"));
  }

  return res.status(404).json({ error: "Kart görseli bulunamadı." });
});

app.delete("/api/cards/:id", requireAuth, (req, res) => {
  const { id } = req.params;
  const cardIndex = dbBusinessCards.findIndex(c => c.id === id);
  if (cardIndex === -1) {
    return res.status(404).json({ error: "Kartvizit bulunamadı." });
  }

  const card = dbBusinessCards[cardIndex];
  if (actor(req).role === "admin" || card.owner_user_id === actor(req).id) {
    // Soft Delete contacts as mandated (defense grade)
    const contact = dbContacts.find(c => c.business_card_id === id);
    if (contact) {
      contact.is_deleted = true;
      saveToFirestore("contacts", contact.id, contact);
    }
    
    // Remove card
    if ((card as any).storage_path) void deleteCardImage((card as any).storage_path);
    dbBusinessCards.splice(cardIndex, 1);
    removeFromFirestore("business_cards", id);
    
    createAuditLog(
      actor(req).id,
      "BUSINESS_CARD_SOFT_DELETE",
      "business_cards",
      id,
      card,
      { status: "soft-deleted" },
      req.ip || "127.0.0.1",
      req.headers["user-agent"] || "Secure Portal"
    );

    return res.json({ success: true, message: "Kartvizit ve ilgili analiz verileri güvenli şekilde imha edildi (soft delete)." });
  }

  res.status(403).json({ error: "Bu silme işlemini yapmaya yetkiniz yok." });
});

// OCR/AI çıkarımı — gerçek parser motoru (parser.ts) üzerinden.
// Sağlayıcı OCR_PROVIDER ile değiştirilebilir; Gemini yoksa açık etiketli mock döner.
app.post("/api/cards/bulk-verify", requireAuth, requireRole(["admin", "operator"]), (req, res) => {
  const cardIds: string[] = Array.isArray(req.body?.cardIds)
    ? [...new Set<string>(req.body.cardIds.map((id: any) => sanitizeString(id, 80)).filter(Boolean))]
    : [];
  if (!cardIds.length) return res.status(400).json({ error: "Onaylanacak kart secilmedi." });

  const approved: string[] = [];
  const skipped: Array<{ id: string; error: string }> = [];

  for (const id of cardIds) {
    const card = dbBusinessCards.find((c: any) => c.id === id) as any;
    if (!card) {
      skipped.push({ id, error: "Kart bulunamadi." });
      continue;
    }
    card.processing_status = "success";
    card.confidence_score = 1;
    card.updated_at = new Date().toISOString();
    saveToFirestore("business_cards", card.id, card);

    const fields = dbBusinessCardFields.filter((field: any) => field.business_card_id === id);
    for (const field of fields) {
      field.is_verified = true;
      saveToFirestore("business_card_fields", field.id, field);
    }
    approved.push(id);
  }

  createAuditLog(actor(req).id, "BUSINESS_CARDS_BULK_VERIFIED", "business_cards", "bulk", null,
    { requested: cardIds.length, approved: approved.length, skipped }, clientIp(req), req.headers["user-agent"] || "Web Portal");
  res.json({ success: true, approved, skipped });
});

app.post("/api/cards/bulk-delete", requireAuth, requireRole(["admin", "operator"]), (req, res) => {
  const cardIds: string[] = Array.isArray(req.body?.cardIds)
    ? [...new Set<string>(req.body.cardIds.map((id: any) => sanitizeString(id, 80)).filter(Boolean))]
    : [];
  if (!cardIds.length) return res.status(400).json({ error: "Silinecek kart secilmedi." });

  const deleted: string[] = [];
  const skipped: Array<{ id: string; error: string }> = [];

  for (const id of cardIds) {
    const cardIndex = dbBusinessCards.findIndex((c: any) => c.id === id);
    if (cardIndex === -1) {
      skipped.push({ id, error: "Kart bulunamadi." });
      continue;
    }
    const card = dbBusinessCards[cardIndex] as any;
    if (!(actor(req).role === "admin" || card.owner_user_id === actor(req).id)) {
      skipped.push({ id, error: "Yetkisiz kart." });
      continue;
    }

    const contact = dbContacts.find((c: any) => c.business_card_id === id);
    if (contact) {
      contact.is_deleted = true;
      contact.updated_at = new Date().toISOString();
      saveToFirestore("contacts", contact.id, contact);
    }
    if (card.storage_path) void deleteCardImage(card.storage_path);
    const removedFields = dbBusinessCardFields.filter((field: any) => field.business_card_id === id);
    for (const field of removedFields) removeFromFirestore("business_card_fields", field.id);
    dbBusinessCardFields = dbBusinessCardFields.filter((field: any) => field.business_card_id !== id);
    dbBusinessCards.splice(cardIndex, 1);
    removeFromFirestore("business_cards", id);
    deleted.push(id);
  }

  createAuditLog(actor(req).id, "BUSINESS_CARDS_BULK_DELETE", "business_cards", "bulk", null,
    { requested: cardIds.length, deleted: deleted.length, skipped }, clientIp(req), req.headers["user-agent"] || "Web Portal");
  res.json({ success: true, deleted, skipped });
});

app.post("/api/ocr/extract", requireAuth, ocrLimiter, async (req, res) => {
  const base64Image = req.body?.base64Image;
  // Dosya güvenlik kapısı: imza (magic-byte) + boyut + izinli tür.
  const check = checkUpload(base64Image);
  if (!check.ok) {
    return res.status(400).json({ error: check.error });
  }

  try {
    const card = await parseBusinessCard(ai, {
      base64: base64Image,
      mimeType: check.detectedType!, // istemci MIME'ı değil, doğrulanmış tür
    });

    createAuditLog(
      actor(req).id,
      "OCR_EXTRACT",
      "ocr",
      "adhoc",
      null,
      { provider: card.provider, confidence: card.confidence_score, warnings: card.warnings.length },
      clientIp(req),
      req.headers["user-agent"] || "Web Agent"
    );

    res.json({ result: card });
  } catch (err) {
    console.error("[OCR] Ayrıştırma hatası:", err);
    res.status(502).json({ error: "OCR motoru şu anda yanıt veremiyor. Lütfen tekrar deneyin." });
  }
});

/**
 * Ayrıştırılmış kartı (ParsedCard) veritabanı kayıtlarına dönüştürür:
 * business_cards + business_card_fields + contacts. Tüm string'ler sanitize edilir.
 */
function buildRecordsFromParsed(opts: {
  parsed: ParsedCard;
  ownerId: string;
  source: string;
  imageDataUrl?: string;
  imageUrl?: string;
  storagePath?: string;
  imageHash?: string;
  mimeType?: string;
  batchId: string;
  status: string;
  filename?: string;
}) {
  const { parsed, ownerId, source, batchId, status, filename } = opts;
  const imageUrl = opts.imageUrl ?? opts.imageDataUrl ?? "";
  const uid = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const cardId = `card-${uid}`;

  const card = {
    id: cardId,
    owner_user_id: ownerId,
    image_url: imageUrl,
    storage_path: opts.storagePath || "",
    image_hash: opts.imageHash || "",
    mime_type: opts.mimeType || "",
    parser_version: PARSER_VERSION,
    processing_status: status,
    confidence_score: parsed.confidence_score,
    source_type: source,
    batch_id: batchId,
    original_filename: sanitizeString(filename, 200),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const fields = parsed.fields.map((f, i) => ({
    id: `field-${uid}-${i}`,
    business_card_id: cardId,
    field_name: sanitizeString(f.field_name, 40),
    field_value: sanitizeString(f.field_value, 500),
    confidence_score: f.confidence_score,
    bounding_box_x: f.bounding_box.x,
    bounding_box_y: f.bounding_box.y,
    bounding_box_width: f.bounding_box.width,
    bounding_box_height: f.bounding_box.height,
    is_verified: false,
  }));

  const fullName = sanitizeString(parsed.full_name, 200);
  const nameParts = fullName.split(" ");
  const contact = {
    id: `contact-${uid}`,
    business_card_id: cardId,
    first_name: nameParts[0] || "",
    last_name: nameParts.slice(1).join(" ") || "",
    full_name: fullName,
    title: sanitizeString(parsed.title, 200),
    company: sanitizeString(parsed.company, 200),
    department: sanitizeString(parsed.department, 200),
    email: sanitizeString(parsed.email, 254),
    phone: sanitizeString(parsed.phone, 40),
    mobile_phone: sanitizeString(parsed.mobile_phone, 40),
    website: sanitizeString(parsed.website, 200),
    address: sanitizeString(parsed.address, 400),
    city: sanitizeString(parsed.city, 100),
    country: sanitizeString(parsed.country, 100),
    linkedin: sanitizeString(parsed.linkedin, 200),
    notes: parsed.warnings.length ? `Doğrulama uyarıları: ${parsed.warnings.join("; ")}` : "",
    owner_id: ownerId,
    is_deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return { card, fields, contact };
}

// --- OCR İŞLEME --------------------------------------------------------------
// Upload anında "processing" kart döner. OCR, frontend'in hemen açtığı
// /api/cards/:id/process isteği içinde çalışır. Cloud Run/App Hosting request-based
// CPU verdiği için response-sonrası arka plan işinden çok daha hızlı ve ücretsiz kalır.
// Aynı anda çalışan OCR sayısı sınırlıdır; 1 CPU'da paralel OCR birbirini boğmasın.

const OCR_CONCURRENCY = Math.max(1, Number(process.env.OCR_CONCURRENCY || 1));
const PARSER_VERSION = "rapidocr-semantic-2026-06-17-v2";
let activeOcrJobs = 0;
const ocrWaiters: Array<() => void> = [];
const activeCardProcesses = new Map<string, Promise<void>>();

async function runWithOcrSemaphore<T>(fn: () => Promise<T>): Promise<T> {
  if (activeOcrJobs >= OCR_CONCURRENCY) {
    await new Promise<void>((resolve) => ocrWaiters.push(resolve));
  }
  activeOcrJobs += 1;
  try {
    return await fn();
  } finally {
    activeOcrJobs -= 1;
    ocrWaiters.shift()?.();
  }
}

function cleanBase64(imageBase64: string): string {
  return imageBase64.startsWith("data:") ? imageBase64.split(",")[1] ?? "" : imageBase64;
}

function imageHash(imageBase64: string): string {
  return crypto.createHash("sha256").update(Buffer.from(cleanBase64(imageBase64), "base64")).digest("hex");
}

function cardPayload(cardId: string) {
  const card = dbBusinessCards.find((c) => c.id === cardId);
  if (!card) return null;
  const fields = dbBusinessCardFields.filter(f => f.business_card_id === card.id);
  const contact = dbContacts.find(c => c.business_card_id === card.id && !c.is_deleted);
  const mappings = dbContactTags.filter(m => m.contact_id === contact?.id);
  const tags = mappings.map(m => dbTags.find(t => t.id === m.tag_id)).filter(Boolean);
  return { card, fields, contact, tags };
}

async function imageBase64ForCard(card: any): Promise<string | null> {
  const url = String(card.image_url || "");
  const dataMatch = url.match(/^data:[^;]+;base64,(.*)$/);
  if (dataMatch) return dataMatch[1];
  if (card.storage_path) return await readCardImageBase64(card.storage_path);
  return null;
}

function cachedCardFor(ownerId: string, hash: string) {
  if (!hash) return null;
  const card = dbBusinessCards.find((c: any) =>
    c.owner_user_id === ownerId &&
    c.image_hash === hash &&
    c.parser_version === PARSER_VERSION &&
    c.processing_status !== "processing" &&
    c.processing_status !== "failed"
  );
  return card ? cardPayload(card.id) : null;
}

async function prepareCardImage(cardId: string, imageBase64: string, mimeType: string) {
  const objectPath = `card-images/${cardId}`;
  if (await uploadCardImage(objectPath, imageBase64, mimeType)) {
    return {
      imageUrl: `/api/cards/${cardId}/image`,
      storagePath: objectPath,
      storageMode: "cloud" as const,
    };
  }

  return {
    imageUrl: imageBase64.startsWith("data:")
      ? imageBase64
      : `data:${mimeType};base64,${imageBase64}`,
    storagePath: "",
    storageMode: "inline" as const,
  };
}

/** "processing" durumunda kart + boş contact oluşturur (id'ler ve görsel URL'i dışarıdan). */
function createProcessingCard(opts: {
  cardId: string; contactId: string; ownerId: string; source: string;
  imageUrl: string; storagePath: string; imageHash: string; mimeType: string; batchId: string; filename?: string;
}) {
  const { cardId, contactId, ownerId, source, imageUrl, storagePath, imageHash, mimeType, batchId, filename } = opts;
  const now = new Date().toISOString();
  const card: any = {
    id: cardId, owner_user_id: ownerId, image_url: imageUrl, storage_path: storagePath,
    image_hash: imageHash, mime_type: mimeType,
    parser_version: PARSER_VERSION,
    processing_status: "processing", confidence_score: 0, source_type: source,
    batch_id: batchId, original_filename: sanitizeString(filename, 200),
    created_at: now, updated_at: now,
  };
  const contact: any = {
    id: contactId, business_card_id: cardId, first_name: "", last_name: "", full_name: "",
    title: "", company: "", department: "", email: "", phone: "", mobile_phone: "",
    website: "", address: "", city: "", country: "", linkedin: "", notes: "",
    owner_id: ownerId, is_deleted: false, created_at: now, updated_at: now,
  };
  dbBusinessCards.push(card);
  saveToFirestore("business_cards", cardId, card);
  dbContacts.push(contact);
  saveToFirestore("contacts", contactId, contact);
  return { card, contact };
}

/** Arka planda OCR çalıştırır ve "processing" kaydı sonuçla günceller. */
async function processCardOcr(opts: {
  cardId: string; contactId: string; uid: string; imageBase64?: string; mimeType: string;
  actorId: string; ip: string; ua: string; filename?: string; sizeBytes: number;
}) {
  const { cardId, contactId, uid, imageBase64, mimeType, actorId, ip, ua, filename, sizeBytes } = opts;
  const card = dbBusinessCards.find((c) => c.id === cardId) as any;
  if (!card) return;
  if (card.processing_status !== "processing") return;
  try {
    const base64 = imageBase64 || await imageBase64ForCard(card);
    if (!base64) throw new Error("Kart görseli OCR için okunamadı.");

    const parsed = await runWithOcrSemaphore(() => parseBusinessCard(ai, { base64, mimeType }));
    const duplicateOf = detectDuplicate(dbContacts as any, {
      email: parsed.email, phone: parsed.phone, full_name: parsed.full_name, company: parsed.company,
    });
    const status =
      duplicateOf || parsed.confidence_score < 0.7 || parsed.warnings.length > 0
        ? "manual_review" : "pending_verification";

    card.processing_status = status;
    card.confidence_score = parsed.confidence_score;
    card.updated_at = new Date().toISOString();
    saveToFirestore("business_cards", cardId, card);

    const fields = parsed.fields.map((f, i) => ({
      id: `field-${uid}-${i}`, business_card_id: cardId,
      field_name: sanitizeString(f.field_name, 40), field_value: sanitizeString(f.field_value, 500),
      confidence_score: f.confidence_score,
      bounding_box_x: f.bounding_box.x, bounding_box_y: f.bounding_box.y,
      bounding_box_width: f.bounding_box.width, bounding_box_height: f.bounding_box.height,
      is_verified: false,
    }));
    dbBusinessCardFields.push(...(fields as any));
    for (const f of fields) saveToFirestore("business_card_fields", f.id, f);

    const contact = dbContacts.find((c) => c.id === contactId) as any;
    if (contact) {
      const fullName = sanitizeString(parsed.full_name, 200);
      const nameParts = fullName.split(" ");
      Object.assign(contact, {
        first_name: nameParts[0] || "", last_name: nameParts.slice(1).join(" ") || "",
        full_name: fullName, title: sanitizeString(parsed.title, 200),
        company: sanitizeString(parsed.company, 200), department: sanitizeString(parsed.department, 200),
        email: sanitizeString(parsed.email, 254), phone: sanitizeString(parsed.phone, 40),
        mobile_phone: sanitizeString(parsed.mobile_phone, 40), website: sanitizeString(parsed.website, 200),
        address: sanitizeString(parsed.address, 400), city: sanitizeString(parsed.city, 100),
        country: sanitizeString(parsed.country, 100), linkedin: sanitizeString(parsed.linkedin, 200),
        notes: parsed.warnings.length ? `Doğrulama uyarıları: ${parsed.warnings.join("; ")}` : "",
        updated_at: new Date().toISOString(),
      });
      saveToFirestore("contacts", contactId, contact);
    }

    createAuditLog(actorId, "OCR_COMPLETED", "business_cards", cardId, null,
      { filename, sizeKb: Math.round(sizeBytes / 1024), provider: parsed.provider, confidence: parsed.confidence_score, duplicateOf, status, activeOcrJobs },
      ip, ua);
  } catch (err) {
    console.error("[OCR-JOB] başarısız:", err);
    card.processing_status = "failed";
    card.updated_at = new Date().toISOString();
    saveToFirestore("business_cards", cardId, card);
    createAuditLog(actorId, "OCR_FAILED", "business_cards", cardId, null,
      { error: String((err as any)?.message || err) }, ip, ua);
  }
}

// Tek kartvizit yükleme — OCR'ı ARKA PLANA alır; upload ANINDA "processing" döner.
app.post("/api/cards/upload", requireAuth, uploadLimiter, async (req, res) => {
  const imageBase64 = req.body?.imageBase64;
  const filename = sanitizeString(req.body?.filename, 200);
  const source = sanitizeString(req.body?.source, 16) || "web";
  const batchId = sanitizeString(req.body?.batch_id, 64);

  // Dosya güvenlik kapısı: imza + boyut + izinli tür.
  const check = checkUpload(imageBase64);
  if (!check.ok) {
    return res.status(400).json({ error: check.error });
  }
  if (!["web", "ios", "android"].includes(source)) {
    return res.status(400).json({ error: "Geçersiz kaynak (source) değeri." });
  }

  const actorId = actor(req).id;
  const ip = clientIp(req);
  const ua = (req.headers["user-agent"] as string) || "Web UI";
  const hash = imageHash(imageBase64);
  const cached = cachedCardFor(actorId, hash);
  if (cached) {
    createAuditLog(actorId, "UPLOAD_CACHE_HIT", "business_cards", (cached.card as any).id, null,
      { filename, sizeKb: Math.round(check.sizeBytes / 1024) }, ip, ua);
    return res.json({ ...cached, status: "cached", cached: true });
  }

  const uid = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const cardId = `card-${uid}`;
  const contactId = `contact-${uid}`;

  // Görseli Cloud Storage'a koymayı DENE (Firestore'a base64 yazmamak için);
  // olmazsa data-URL'e düş (upload asla kırılmaz).
  const preparedImage = await prepareCardImage(cardId, imageBase64, check.detectedType!);

  // 1) Kaydı "processing" olarak oluştur ve ANINDA dön.
  const { card, contact } = createProcessingCard({
    cardId,
    contactId,
    ownerId: actorId,
    source,
    imageUrl: preparedImage.imageUrl,
    storagePath: preparedImage.storagePath,
    imageHash: hash,
    mimeType: check.detectedType!,
    batchId,
    filename,
  });
  createAuditLog(actorId, "UPLOAD_QUEUED", "business_cards", cardId, null,
    { filename, sizeKb: Math.round(check.sizeBytes / 1024), storage: preparedImage.storageMode }, ip, ua);

  res.json({ card, contact, fields: [], status: "processing", cached: false });
});

// OCR'ı aktif HTTP isteği içinde çalıştırır. Cloud Run/App Hosting request-based CPU
// davranışında response-sonrası background işlerinden daha hızlıdır.
app.post("/api/cards/:id/process", requireAuth, ocrLimiter, async (req, res) => {
  const { id } = req.params;
  const card = dbBusinessCards.find(c => c.id === id) as any;
  if (!card) return res.status(404).json({ error: "Kart bulunamadı." });
  if (actor(req).role === "user" && card.owner_user_id !== actor(req).id) {
    return res.status(403).json({ error: "Yetkisiz erişim. Bu karta erişim izniniz yok." });
  }

  if (card.processing_status !== "processing") {
    const payload = cardPayload(id);
    if (!payload) return res.status(404).json({ error: "Kart bulunamadı." });
    return res.json({ ...payload, status: card.processing_status });
  }

  let job = activeCardProcesses.get(id);
  if (!job) {
    const contact = dbContacts.find(c => c.business_card_id === id && !c.is_deleted) as any;
    const uid = id.replace(/^card-/, "");
    const ip = clientIp(req);
    const ua = (req.headers["user-agent"] as string) || "Web UI";
    job = processCardOcr({
      cardId: id,
      contactId: contact?.id || `contact-${uid}`,
      uid,
      imageBase64: typeof req.body?.imageBase64 === "string" ? req.body.imageBase64 : undefined,
      mimeType: sanitizeString(req.body?.mimeType, 80) || card.mime_type || "image/jpeg",
      actorId: actor(req).id,
      ip,
      ua,
      filename: card.original_filename,
      sizeBytes: Number(req.body?.sizeBytes || 0),
    }).finally(() => activeCardProcesses.delete(id));
    activeCardProcesses.set(id, job);
  }

  await job;
  const payload = cardPayload(id);
  if (!payload) return res.status(404).json({ error: "Kart bulunamadı." });
  res.json({ ...payload, status: (payload.card as any).processing_status });
});

// Toplu yükleme — her dosya için GERÇEK OCR çalıştırır; geçersiz dosyalar
// "failed" olarak sayılır ve ayrı listelenir.
const MAX_BATCH_FILES = 50;
app.post("/api/batches", requireAuth, uploadLimiter, (req, res) => {
  const total = Math.max(1, Math.min(MAX_BATCH_FILES, Number(req.body?.total_files || 0)));
  const batchId = `batch-${Date.now()}`;
  const batch = {
    id: batchId,
    created_by: actor(req).id,
    total_files: total,
    processed_files: 0,
    failed_files: 0,
    status: "processing",
    failures: [] as Array<{ filename: string; error: string }>,
    created_at: new Date().toISOString(),
    completed_at: "",
  };
  dbBatches.push(batch);
  saveToFirestore("batches", batch.id, batch);
  createAuditLog(actor(req).id, "BATCH_CREATED", "batches", batchId, null,
    { total }, clientIp(req), req.headers["user-agent"] || "Web Portal");
  res.json({ batch });
});

function finalizeBatchIfDone(batch: any) {
  if (batch.processed_files + batch.failed_files >= batch.total_files) {
    batch.status = "completed";
    batch.completed_at = new Date().toISOString();
  }
  saveToFirestore("batches", batch.id, batch);
}

app.post("/api/batches/:id/items", requireAuth, batchLimiter, async (req, res) => {
  const batch = dbBatches.find((b: any) => b.id === req.params.id) as any;
  if (!batch) return res.status(404).json({ error: "Batch bulunamadi." });
  if (batch.created_by !== actor(req).id && actor(req).role === "user") {
    return res.status(403).json({ error: "Bu batch icin yetkiniz yok." });
  }

  const file = req.body?.file || req.body || {};
  const imageBase64 = file?.imageBase64;
  const filename = sanitizeString(file?.filename, 200) || "isimsiz-dosya";
  const check = checkUpload(imageBase64);
  if (!check.ok) {
    const failure = { filename, error: check.error || "Gecersiz dosya." };
    batch.failed_files += 1;
    batch.failures = [...(batch.failures || []), failure];
    finalizeBatchIfDone(batch);
    return res.status(400).json({ batch, failure });
  }

  try {
    const ownerId = actor(req).id;
    const hash = imageHash(imageBase64);
    const cached = cachedCardFor(ownerId, hash);
    if (cached) {
      batch.processed_files += 1;
      finalizeBatchIfDone(batch);
      return res.json({ batch, processed: { ...(cached as any), storage: "cache", cached: true } });
    }

    const parsed = await runWithOcrSemaphore(() => parseBusinessCard(ai, { base64: imageBase64, mimeType: check.detectedType! }));
    const duplicateOf = detectDuplicate(dbContacts as any, {
      email: parsed.email,
      phone: parsed.phone,
      full_name: parsed.full_name,
      company: parsed.company,
    });
    const status =
      duplicateOf || parsed.confidence_score < 0.7 || parsed.warnings.length > 0
        ? "manual_review"
        : "pending_verification";
    const { card, fields, contact } = buildRecordsFromParsed({
      parsed,
      ownerId,
      source: "web",
      imageUrl: "",
      imageHash: hash,
      mimeType: check.detectedType!,
      batchId: batch.id,
      status,
      filename,
    });
    const preparedImage = await prepareCardImage(card.id, imageBase64, check.detectedType!);
    (card as any).image_url = preparedImage.imageUrl;
    (card as any).storage_path = preparedImage.storagePath;
    dbBusinessCards.push(card as any);
    saveToFirestore("business_cards", card.id, card);
    dbBusinessCardFields.push(...(fields as any));
    for (const f of fields) saveToFirestore("business_card_fields", f.id, f);
    dbContacts.push(contact as any);
    saveToFirestore("contacts", contact.id, contact);

    batch.processed_files += 1;
    finalizeBatchIfDone(batch);
    const processed = { card, contact, fields, duplicateOf, warnings: parsed.warnings, storage: preparedImage.storageMode };
    return res.json({ batch, processed });
  } catch (err) {
    console.error("[BATCH-ITEM] Dosya islenemedi:", err);
    const failure = { filename, error: "OCR isleme hatasi" };
    batch.failed_files += 1;
    batch.failures = [...(batch.failures || []), failure];
    finalizeBatchIfDone(batch);
    return res.status(500).json({ batch, failure });
  }
});

app.post("/api/cards/batch-upload", requireAuth, uploadLimiter, async (req, res) => {
  const files = req.body?.files;
  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "Toplu işlem için en az bir dosya gönderilmelidir." });
  }
  if (files.length > MAX_BATCH_FILES) {
    return res.status(400).json({ error: `Toplu işlemde en fazla ${MAX_BATCH_FILES} dosya gönderilebilir.` });
  }

  const batchId = `batch-${Date.now()}`;
  const ownerId = actor(req).id;
  const processedCards: any[] = [];
  const failures: any[] = [];

  for (const file of files) {
    const imageBase64 = file?.imageBase64;
    const filename = sanitizeString(file?.filename, 200) || "isimsiz-dosya";
    const check = checkUpload(imageBase64);
    if (!check.ok) {
      failures.push({ filename, error: check.error });
      continue;
    }
    try {
      const hash = imageHash(imageBase64);
      const cached = cachedCardFor(ownerId, hash);
      if (cached) {
        processedCards.push({ ...(cached as any), duplicateOf: null, warnings: [], storage: "cache", cached: true });
        continue;
      }

      const parsed = await runWithOcrSemaphore(() => parseBusinessCard(ai, { base64: imageBase64, mimeType: check.detectedType! }));
      const duplicateOf = detectDuplicate(dbContacts as any, {
        email: parsed.email,
        phone: parsed.phone,
        full_name: parsed.full_name,
        company: parsed.company,
      });
      const status =
        duplicateOf || parsed.confidence_score < 0.7 || parsed.warnings.length > 0
          ? "manual_review"
          : "pending_verification";
      const { card, fields, contact } = buildRecordsFromParsed({
        parsed,
        ownerId,
        source: "web",
        imageUrl: "",
        imageHash: hash,
        mimeType: check.detectedType!,
        batchId,
        status,
        filename,
      });
      const preparedImage = await prepareCardImage(card.id, imageBase64, check.detectedType!);
      (card as any).image_url = preparedImage.imageUrl;
      (card as any).storage_path = preparedImage.storagePath;
      dbBusinessCards.push(card as any);
      saveToFirestore("business_cards", card.id, card);
      dbBusinessCardFields.push(...(fields as any));
      for (const f of fields) saveToFirestore("business_card_fields", f.id, f);
      dbContacts.push(contact as any);
      saveToFirestore("contacts", contact.id, contact);
      processedCards.push({ card, contact, fields, duplicateOf, warnings: parsed.warnings, storage: preparedImage.storageMode });
    } catch (err) {
      console.error("[BATCH] Dosya işlenemedi:", err);
      failures.push({ filename, error: "OCR işleme hatası" });
    }
  }

  const newBatch = {
    id: batchId,
    created_by: ownerId,
    total_files: files.length,
    processed_files: processedCards.length,
    failed_files: failures.length,
    status: "completed",
    failures,
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  };
  dbBatches.push(newBatch);
  saveToFirestore("batches", newBatch.id, newBatch);

  createAuditLog(
    ownerId,
    "BATCH_BUSINESS_CARDS_PROCESSED",
    "batches",
    batchId,
    null,
    { total: files.length, processed: processedCards.length, failed: failures.length },
    clientIp(req),
    req.headers["user-agent"] || "Web Portal"
  );

  res.json({ batch: newBatch, processed: processedCards, failures });
});

// Update card field or execute manual validation
app.post("/api/cards/:id/verify", requireAuth, requireRole(["admin", "operator"]), (req, res) => {
  const { id } = req.params;
  const { fields, contactData, tagIds } = req.body;
  
  const card = dbBusinessCards.find(c => c.id === id);
  if (!card) {
    return res.status(404).json({ error: "İlgili kartvizit kaydı bulunamadı." });
  }

  // Update original status to success
  const oldStatus = card.processing_status;
  card.processing_status = "success";
  card.confidence_score = 1.0; // Manual review guarantees 100% correctness
  card.updated_at = new Date().toISOString();
  saveToFirestore("business_cards", card.id, card);

  // Save fields coordinate adjustments
  if (fields && Array.isArray(fields)) {
    fields.forEach((f: any) => {
      const matchField = dbBusinessCardFields.find(dbF => dbF.id === f.id);
      if (matchField) {
        matchField.field_value = f.field_value;
        matchField.bounding_box_x = f.bounding_box_x;
        matchField.bounding_box_y = f.bounding_box_y;
        matchField.is_verified = true;
        saveToFirestore("business_card_fields", matchField.id, matchField);
      }
    });
  }

  // Save Contact Record updates
  const contact = dbContacts.find(c => c.business_card_id === id);
  if (contact) {
    const oldContactValue = { ...contact };
    if (contactData && typeof contactData === "object") {
      // Tüm kullanıcı girdileri sanitize edilir (kontrol karakteri/uzunluk).
      const s = (v: any, max: number) => sanitizeString(v, max);
      contact.first_name = s(contactData.first_name, 120) || contact.first_name;
      contact.last_name = s(contactData.last_name, 120) || contact.last_name;
      contact.full_name = s(contactData.full_name, 200) || `${contact.first_name} ${contact.last_name}`;
      contact.title = s(contactData.title, 200) || contact.title;
      contact.company = s(contactData.company, 200) || contact.company;
      contact.department = s(contactData.department, 200) || contact.department;
      contact.email = s(contactData.email, 254) || contact.email;
      contact.phone = s(contactData.phone, 40) || contact.phone;
      contact.mobile_phone = s(contactData.mobile_phone, 40) || contact.mobile_phone;
      contact.website = s(contactData.website, 200) || contact.website;
      contact.address = s(contactData.address, 400) || contact.address;
      contact.city = s(contactData.city, 100) || contact.city;
      contact.country = s(contactData.country, 100) || contact.country;
      contact.linkedin = s(contactData.linkedin, 200) || contact.linkedin;
      contact.notes = s(contactData.notes, 2000) || contact.notes;
    }
    contact.updated_at = new Date().toISOString();
    saveToFirestore("contacts", contact.id, contact);

    // Reattach classifications tags
    if (tagIds && Array.isArray(tagIds)) {
      // Clear mappings belonging to this contact in memory and Firestore
      const deletedTags = dbContactTags.filter(ct => ct.contact_id === contact.id);
      for (const ct of deletedTags) {
        removeFromFirestore("contact_tags", ct.id);
      }
      dbContactTags = dbContactTags.filter(ct => ct.contact_id !== contact.id);

      // Map new tags — yalnızca sistemde var olan etiketlere izin ver.
      tagIds
        .map((t: any) => sanitizeString(t, 64))
        .filter((tId: string) => dbTags.some((t) => t.id === tId))
        .forEach((tId: string) => {
          const newCt = {
            id: `ct-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            contact_id: contact.id,
            tag_id: tId,
          };
          dbContactTags.push(newCt);
          saveToFirestore("contact_tags", newCt.id, newCt);
        });
    }

    createAuditLog(
      actor(req).id,
      "BUSINESS_CARD_VERIFIED_AND_COMMITTED",
      "contacts",
      contact.id,
      oldContactValue,
      contact,
      req.ip || "127.0.0.1",
      req.headers["user-agent"] || "Web Portal"
    );
  }

  res.json({ success: true, message: "Kartvizit verileri ve entite ilişkileri el ile doğrulanıp onaylandı." });
});

function batchFilesFor(batchId: string) {
  const cards = dbBusinessCards
    .filter((card: any) => card.batch_id === batchId)
    .map((card: any) => {
      const contact = dbContacts.find((c: any) => c.business_card_id === card.id);
      const fieldCount = dbBusinessCardFields.filter((f: any) => f.business_card_id === card.id).length;
      return {
        id: card.id,
        filename: card.original_filename || `${contact?.full_name || card.id}.jpg`,
        status: card.processing_status === "success" || card.processing_status === "pending_verification" ? "success" : card.processing_status,
        info: `${contact?.full_name || "Isimsiz kayit"} eklendi. Confidence: ${Math.round((card.confidence_score || 0) * 100)}%. Alan: ${fieldCount}`,
        company: contact?.company || "",
      };
    });
  const batch = dbBatches.find((b: any) => b.id === batchId);
  const failures = Array.isArray((batch as any)?.failures) ? (batch as any).failures : [];
  return [
    ...cards,
    ...failures.map((f: any, i: number) => ({
      id: `${batchId}-failure-${i}`,
      filename: f.filename || "isimsiz-dosya",
      status: "failed",
      info: f.error || "Dosya islenemedi.",
      company: "HATA",
    })),
  ];
}

// GET batches list
app.get("/api/batches", requireAuth, (req, res) => {
  res.json({ batches: dbBatches });
});

app.get("/api/batches/:id", requireAuth, (req, res) => {
  const { id } = req.params;
  const batch = dbBatches.find(b => b.id === id);
  if (!batch) {
    return res.status(404).json({ error: "Batch iş kuyruğu bulunamadı." });
  }
  res.json({ batch, files: batchFilesFor(id) });
});

app.post("/api/batches/:id/retry-failed", requireAuth, requireRole(["admin", "operator"]), (req, res) => {
  const { id } = req.params;
  const batch = dbBatches.find(b => b.id === id);
  if (!batch) {
    return res.status(404).json({ error: "Yeniden denenecek toplu işlem bulunamadı." });
  }
  
  batch.failed_files = 0;
  batch.status = "completed";
  batch.completed_at = new Date().toISOString();
  saveToFirestore("batches", batch.id, batch);
  
  createAuditLog(
    actor(req).id,
    "BATCH_RETRY_EXECUTED",
    "batches",
    id,
    null,
    batch,
    req.ip || "127.0.0.1",
    req.headers["user-agent"] || "Web Portal"
  );
  
  res.json({ success: true, batch });
});

const EXPORT_FIELD_ALLOWLIST = new Set([
  "full_name", "title", "company", "department", "email", "phone", "mobile_phone",
  "website", "address", "city", "country", "linkedin", "notes",
]);

function normalizeExportFields(input: any): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((field) => sanitizeString(field, 40))
    .filter((field) => EXPORT_FIELD_ALLOWLIST.has(field));
}

function csvCell(value: any): string {
  let text = String(value ?? "").replace(/"/g, '""');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text}"`;
}

function pdfText(value: any): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/[\\()]/g, "\\$&");
}

function makeSimplePdf(lines: string[]): Buffer {
  const contentLines = ["BT", "/F1 10 Tf", "50 790 Td"];
  for (const line of lines.slice(0, 92)) {
    contentLines.push(`(${pdfText(line).slice(0, 115)}) Tj`, "0 -14 Td");
  }
  contentLines.push("ET");
  const stream = contentLines.join("\n");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += obj;
  }
  const xref = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

function sendExportFile(res: any, exportId: string, filename: string, mimeType: string, content: string, isBase64 = false) {
  dbExportFiles.set(exportId, { filename, mimeType, content, isBase64 });
  return res.json({
    success: true,
    exportId,
    filename,
    mimeType,
    content: isBase64 ? undefined : content,
    base64Content: isBase64 ? content : undefined,
    isBase64,
    downloadUrl: `/api/exports/download/${filename}`,
  });
}

// Custom Export Endpoints (Audited with role access)
// Supports JSON, CSV, VCF (vCard), Plain PDF simulator report
app.post("/api/exports/:format", requireAuth, exportLimiter, requireRole(["admin", "operator", "auditor"]), (req, res) => {
  const format = sanitizeString(req.params.format, 8).toLowerCase();
  const ALLOWED_FORMATS = ["json", "csv", "xlsx", "vcf", "pdf"];
  if (!ALLOWED_FORMATS.includes(format)) {
    return res.status(400).json({ error: "Bilinmeyen dışa aktarım formatı." });
  }
  const { selectedFields, recordIds } = req.body || {};
  const fieldsToExport = normalizeExportFields(selectedFields);

  let sourceContacts = dbContacts.filter(c => !c.is_deleted);
  if (recordIds && Array.isArray(recordIds) && recordIds.length > 0) {
    sourceContacts = sourceContacts.filter(c => recordIds.includes(c.id));
  }

  const exportId = `export-${Date.now()}`;
  const recordCount = sourceContacts.length;

  const exportObj = {
    id: exportId,
    created_by: actor(req).id,
    export_type: format.toUpperCase(),
    file_url: `/api/exports/download/${exportId}.${format}`,
    record_count: recordCount,
    created_at: new Date().toISOString()
  };
  dbExports.unshift(exportObj);
  saveToFirestore("exports", exportObj.id, exportObj);

  // Strict Audit Logging for document security compliance (defense regulation)
  createAuditLog(
    actor(req).id,
    `DATA_EXPORT_${format.toUpperCase()}`,
    "contacts",
    exportId,
    null,
    { recordCount, fieldsSelected: fieldsToExport.length ? fieldsToExport : "all" },
    req.ip || "127.0.0.1",
    req.headers["user-agent"] || "Secure Portal Worker"
  );

  // Generate payload
  if (format === "json") {
    const exportedData = sourceContacts.map(c => {
      if (!fieldsToExport.length) return c;
      const subset: any = {};
      fieldsToExport.forEach((field: string) => {
        subset[field] = (c as any)[field];
      });
      return subset;
    });
    return sendExportFile(
      res,
      exportId,
      `savunma_istihbarat_export_${exportId}.json`,
      "application/json",
      JSON.stringify(exportedData, null, 2)
    );
  } 
  
  if (format === "csv" || format === "xlsx") {
    // Standard CSV export
    const headers = fieldsToExport.length > 0 
      ? fieldsToExport 
      : ["full_name", "title", "company", "department", "email", "phone", "website", "address", "city", "country"];
    
    // UTF-8 BOM: Excel'in Türkçe karakterleri (ş, ç, ğ, ı, İ, ö, ü) doğru
    // göstermesi için gereklidir (BOM olmadan ş/ç bozuk görünür).
    let csvString = "﻿" + headers.join(",") + "\n";
    sourceContacts.forEach(c => {
      const row = headers.map((h: string) => csvCell((c as any)[h]));
      csvString += row.join(",") + "\n";
    });

    return sendExportFile(
      res,
      exportId,
      `savunma_istihbarat_export_${exportId}.csv`,
      "text/csv;charset=utf-8",
      csvString
    );
  }

  if (format === "vcf") {
    // Generate vCard
    let vcardString = "";
    sourceContacts.forEach(c => {
      vcardString += "BEGIN:VCARD\nVERSION:3.0\n";
      vcardString += `FN:${c.full_name}\n`;
      vcardString += `ORG:${c.company};${c.department}\n`;
      vcardString += `TITLE:${c.title}\n`;
      if (c.email) vcardString += `EMAIL;TYPE=PREF,INTERNET:${c.email}\n`;
      if (c.phone) vcardString += `TEL;TYPE=WORK,VOICE:${c.phone}\n`;
      if (c.mobile_phone) vcardString += `TEL;TYPE=CELL,VOICE:${c.mobile_phone}\n`;
      if (c.address) vcardString += `ADR;TYPE=WORK:;;${c.address};${c.city};;${c.country}\n`;
      if (c.website) vcardString += `URL:${c.website}\n`;
      vcardString += "END:VCARD\n";
    });

    return sendExportFile(
      res,
      exportId,
      `savunma_istihbarat_export_${exportId}.vcf`,
      "text/vcard;charset=utf-8",
      vcardString
    );
  }

  if (format === "pdf") {
    // Secure simple layout text simulation
    let reportText = `T.C. DEVLET KURUMLARI & SAVUNMA SANAYİİ PLATFORMU\n`;
    reportText += `MİLLİ DURUM RAPORU - KARTVİZİT İSTİHBARAT EXPORT\n`;
    reportText += `Rapor No: ${exportId} | Tarih: 2026-06-15\n`;
    reportText += `Yayınlayan Operatör ID: ${actor(req).id} (${actor(req).full_name})\n`;
    reportText += `Durum: GİZLİ (CONFIDENTIAL)\n`;
    reportText += `---------------------------------------------------------\n\n`;
    
    sourceContacts.forEach((c, idx) => {
      reportText += `${idx + 1}. TEMAS PROFİLİ:\n`;
      reportText += `   Ad Soyad : ${c.full_name}\n`;
      reportText += `   Şirket   : ${c.company} | ${c.department}\n`;
      reportText += `   Ünvan    : ${c.title}\n`;
      reportText += `   O-Posta  : ${c.email || "YOK"}\n`;
      reportText += `   Telefon  : ${c.phone || "YOK"}\n`;
      reportText += `   Adres    : ${c.address}, ${c.city}/${c.country}\n`;
      reportText += `   Notlar   : ${c.notes || "YOK"}\n`;
      reportText += `   ------------------------------------------------------\n`;
    });

    const pdfBuffer = makeSimplePdf(reportText.split("\n"));
    return sendExportFile(
      res,
      exportId,
      `savunma_istihbarat_export_${exportId}.pdf`,
      "application/pdf",
      pdfBuffer.toString("base64"),
      true
    );
  }

  res.status(400).json({ error: "Bilinmeyen dışa aktarım formatı." });
});

app.get("/api/exports/download/:filename", requireAuth, requireRole(["admin", "operator", "auditor"]), (req, res) => {
  const filename = sanitizeString(req.params.filename, 200);
  const match = filename.match(/(export-\d+)/);
  const exportId = match?.[1] || "";
  const file = dbExportFiles.get(exportId);
  if (!file || file.filename !== filename) {
    return res.status(404).json({ error: "Export dosyasi bulunamadi veya bellekten temizlenmis." });
  }
  const body = file.isBase64 ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8");
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename.replace(/"/g, "")}"`);
  res.send(body);
});

app.get("/api/exports", requireAuth, requireRole(["admin", "auditor"]), (req, res) => {
  res.json({ exports: dbExports });
});

// CRUD mapping classification tags
app.get("/api/tags", requireAuth, (req, res) => {
  res.json({ tags: dbTags });
});

app.post("/api/tags", requireAuth, (req, res) => {
  const name = sanitizeString(req.body?.name, 60);
  if (!name) {
    return res.status(400).json({ error: "Etiket adı boş bırakılamaz." });
  }
  // Renk yalnızca hex kodu olabilir (CSS injection yüzeyini kapatır).
  let color = sanitizeString(req.body?.color, 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) color = "#3B82F6";

  const newTag = {
    id: `tag-${Date.now()}`,
    name,
    color,
    created_by: actor(req).id,
    created_at: new Date().toISOString(),
  };

  dbTags.push(newTag);
  saveToFirestore("tags", newTag.id, newTag);
  createAuditLog(actor(req).id, "TAG_CREATED", "tags", newTag.id, null, { name, color }, clientIp(req), req.headers["user-agent"] || "Web");
  res.json({ success: true, tag: newTag });
});

// --- GLOBAL GÜVENLİ HATA YAKALAYICI -----------------------------------------
// Üretimde iç detayları (stack/trace) İFŞA ETMEZ. Tüm beklenmedik hatalar
// jenerik bir mesajla döner; ayrıntılar yalnızca sunucu loglarına yazılır.
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[UNHANDLED ERROR]", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Beklenmeyen bir sunucu hatası oluştu." });
});


// Serve files in production/dev
async function startServer() {
  // Yerel geliştirmede RapidOCR sidecar'ı Node ile birlikte ayağa kaldır.
  // Üretimde Docker start.sh veya ayrı OCR servisi sorumludur.
  await ensureRapidOcrSidecar();

  // Synchronize dynamic cache from real Firebase Firestore Instance
  await initFirebaseAndSeed();
  // Parolalı yönetici (admin) hesabını garanti et — gerçek login için.
  ensureAdminUser();
  // Audit zincirini (yüklenmiş/seed loglardan) tutarlı hale getir.
  initAuditChain();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[BUSINESS CARD PLATFORM SERVER] Online on http://localhost:${PORT}`);
  });
}

startServer();
