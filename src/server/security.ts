/**
 * security.ts — Savunma sanayii seviyesi güvenlik birincilleri (primitives).
 *
 * Bu modül gerçekten uygulanan (yorum olarak bırakılmayan) güvenlik kontrolleri sağlar:
 *  - HMAC imzalı oturum token'ları (sabit string yerine kriptografik imza)
 *  - In-memory rate limiting (kaba kuvvet / DoS yüzeyini daraltır)
 *  - Şema tabanlı input doğrulama + string sanitizasyonu (XSS/injection azaltma)
 *  - Dosya imzası (magic-byte) doğrulaması — istemcinin bildirdiği MIME'a güvenmez
 *  - Hassas veri maskeleme (denetçi görünümleri için)
 *  - Güvenli HTTP başlıkları (sıkılaştırılmış CSP)
 *
 * Yalnızca Node yerleşik modüllerini kullanır (harici bağımlılık yok).
 */

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

// --- OTURUM (SESSION) TOKEN İMZALAMA ---------------------------------------

// Üretimde SESSION_SECRET zorunlu kılınmalı. Tanımsızsa her açılışta rastgele
// bir sır üretiriz; bu, process yeniden başladığında tüm oturumları geçersiz
// kılar (güvenli ama kalıcı değil) — bu davranış kasıtlıdır.
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");

if (!process.env.SESSION_SECRET) {
  console.warn(
    "[SECURITY] SESSION_SECRET tanımlı değil — geçici rastgele sır kullanılıyor. Üretimde mutlaka ayarlayın."
  );
}

export interface SessionPayload {
  sub: string; // user id
  role: string;
  email: string;
  iat: number; // issued-at (ms)
  exp: number; // expiry (ms)
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/** İmzalı, süreli bir oturum token'ı üretir. */
export function signSession(
  payload: Omit<SessionPayload, "iat" | "exp">,
  ttlMs = 8 * 60 * 60 * 1000 // 8 saat
): string {
  const now = Date.now();
  const full: SessionPayload = { ...payload, iat: now, exp: now + ttlMs };
  const body = b64url(JSON.stringify(full));
  const sig = b64url(
    crypto.createHmac("sha256", SESSION_SECRET).update(body).digest()
  );
  return `${body}.${sig}`;
}

/** Token'ı doğrular; imza/expiry geçersizse null döner (timing-safe karşılaştırma). */
export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = b64url(
    crypto.createHmac("sha256", SESSION_SECRET).update(body).digest()
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8")) as SessionPayload;
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Express cookie başlığından tek bir cookie değerini ayrıştırır. */
export function parseCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

/** httpOnly + SameSite=Strict güvenli oturum cookie'si kurar. */
export function setSessionCookie(res: Response, token: string, ttlMs = 8 * 60 * 60 * 1000) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `bcip_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(
      ttlMs / 1000
    )}${secure}`
  );
}

export function clearSessionCookie(res: Response) {
  res.setHeader("Set-Cookie", "bcip_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
}

// --- RATE LIMITING ----------------------------------------------------------

interface Bucket {
  hits: number[];
}
const rateStore = new Map<string, Bucket>();

/**
 * Kayan pencere (sliding window) rate limiter. IP + route anahtarına göre sınırlar.
 * Belleği sınırlı tutmak için her çağrıda eski kayıtları temizler.
 */
export function rateLimit(opts: { windowMs: number; max: number; key?: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      req.ip ||
      "unknown";
    const routeKey = opts.key || req.path;
    const k = `${ip}:${routeKey}`;
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    let bucket = rateStore.get(k);
    if (!bucket) {
      bucket = { hits: [] };
      rateStore.set(k, bucket);
    }
    bucket.hits = bucket.hits.filter((t) => t > windowStart);

    if (bucket.hits.length >= opts.max) {
      const retryAfter = Math.ceil((bucket.hits[0] + opts.windowMs - now) / 1000);
      res.setHeader("Retry-After", String(Math.max(1, retryAfter)));
      return res.status(429).json({
        error: "Çok fazla istek. Hız sınırı aşıldı. Lütfen kısa süre sonra tekrar deneyin.",
      });
    }
    bucket.hits.push(now);

    // Periyodik hafif temizlik (bellek sızıntısını önler)
    if (rateStore.size > 5000) {
      for (const [key, b] of rateStore) {
        b.hits = b.hits.filter((t) => t > windowStart);
        if (b.hits.length === 0) rateStore.delete(key);
      }
    }
    next();
  };
}

// --- STRING SANITIZASYONU ---------------------------------------------------

// Kontrol karakterleri (TAB \x09, LF \x0A, CR \x0D hariç) ve null byte.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Depolanan string'leri temizler: null byte / kontrol karakterlerini söker,
 * uzunluğu sınırlar, baş/son boşlukları kırpar. React çıktıyı zaten escape
 * ettiği için saklama katmanında kontrol karakteri temizliğine odaklanırız.
 */
export function sanitizeString(value: unknown, maxLen = 2000): string {
  if (value == null) return "";
  let s = String(value).replace(CONTROL_CHARS, "");
  s = s.trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

// --- ŞEMA TABANLI INPUT DOĞRULAMA -------------------------------------------

export type FieldRule = {
  type: "string" | "number" | "boolean" | "array" | "object";
  required?: boolean;
  maxLen?: number;
  min?: number;
  max?: number;
  enum?: readonly string[];
  pattern?: RegExp;
};

export type Schema = Record<string, FieldRule>;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  value: Record<string, any>;
}

/** Hafif, bağımlılıksız şema doğrulayıcı. Bilinmeyen alanları eler. */
export function validate(body: any, schema: Schema): ValidationResult {
  const errors: string[] = [];
  const value: Record<string, any> = {};
  const src = body && typeof body === "object" ? body : {};

  for (const [key, rule] of Object.entries(schema)) {
    const raw = src[key];
    const present = raw !== undefined && raw !== null && raw !== "";

    if (!present) {
      if (rule.required) errors.push(`'${key}' alanı zorunludur.`);
      continue;
    }

    switch (rule.type) {
      case "string": {
        const s = sanitizeString(raw, rule.maxLen ?? 5000);
        if (rule.enum && !rule.enum.includes(s)) {
          errors.push(`'${key}' geçersiz bir değer içeriyor.`);
          continue;
        }
        if (rule.pattern && !rule.pattern.test(s)) {
          errors.push(`'${key}' beklenen biçime uymuyor.`);
          continue;
        }
        value[key] = s;
        break;
      }
      case "number": {
        const n = Number(raw);
        if (Number.isNaN(n)) {
          errors.push(`'${key}' sayısal olmalıdır.`);
          continue;
        }
        if (rule.min != null && n < rule.min) errors.push(`'${key}' çok küçük.`);
        if (rule.max != null && n > rule.max) errors.push(`'${key}' çok büyük.`);
        value[key] = n;
        break;
      }
      case "boolean":
        value[key] = Boolean(raw);
        break;
      case "array":
        if (!Array.isArray(raw)) {
          errors.push(`'${key}' bir dizi olmalıdır.`);
          continue;
        }
        value[key] = raw;
        break;
      case "object":
        if (typeof raw !== "object" || Array.isArray(raw)) {
          errors.push(`'${key}' bir nesne olmalıdır.`);
          continue;
        }
        value[key] = raw;
        break;
    }
  }

  return { ok: errors.length === 0, errors, value };
}

// --- DOSYA İMZASI (MAGIC-BYTE) DOĞRULAMA ------------------------------------

const SIGNATURES: { mime: string; bytes: number[]; offset?: number }[] = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
];

/**
 * Base64 verisinin baş baytlarından gerçek dosya türünü tespit eder.
 * İstemcinin bildirdiği MIME'a GÜVENMEZ — gerçek imzayı doğrular.
 * Tanınmazsa null döner. WEBP, RIFF...WEBP yapısıyla ayrıca kontrol edilir.
 */
export function detectFileType(base64: string): string | null {
  try {
    const clean = base64.startsWith("data:") ? base64.split(",")[1] ?? "" : base64;
    const head = Buffer.from(clean.slice(0, 64), "base64");
    for (const sig of SIGNATURES) {
      const off = sig.offset ?? 0;
      if (sig.bytes.every((b, i) => head[off + i] === b)) return sig.mime;
    }
    // WEBP: "RIFF"(0..3) + "WEBP"(8..11)
    if (
      head[0] === 0x52 &&
      head[1] === 0x49 &&
      head[2] === 0x46 &&
      head[3] === 0x46 &&
      head[8] === 0x57 &&
      head[9] === 0x45 &&
      head[10] === 0x42 &&
      head[11] === 0x50
    ) {
      return "image/webp";
    }
    return null;
  } catch {
    return null;
  }
}

const ALLOWED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export interface FileCheck {
  ok: boolean;
  detectedType: string | null;
  sizeBytes: number;
  error?: string;
}

/** Yükleme güvenlik kapısı: imza + boyut + izinli tür kontrolü. */
export function checkUpload(base64: string, maxBytes = 10 * 1024 * 1024): FileCheck {
  if (!base64 || typeof base64 !== "string") {
    return { ok: false, detectedType: null, sizeBytes: 0, error: "Geçersiz veya boş dosya verisi." };
  }
  const clean = base64.startsWith("data:") ? base64.split(",")[1] ?? "" : base64;
  const sizeBytes = Buffer.byteLength(clean, "base64");
  if (sizeBytes > maxBytes) {
    return {
      ok: false,
      detectedType: null,
      sizeBytes,
      error: `Dosya boyutu ${Math.round(maxBytes / 1024 / 1024)}MB limitini aşıyor.`,
    };
  }
  const detected = detectFileType(clean);
  if (!detected || !ALLOWED_UPLOAD_TYPES.has(detected)) {
    return {
      ok: false,
      detectedType: detected,
      sizeBytes,
      error:
        "Dosya imzası tanınmadı veya izinli değil. Yalnızca JPEG, PNG, WEBP, GIF, PDF kabul edilir (içerik imzasıyla doğrulanır).",
    };
  }
  return { ok: true, detectedType: detected, sizeBytes };
}

// --- HASSAS VERİ MASKELEME ---------------------------------------------------

/** E-posta/telefon gibi PII'yi kısmen maskeler (denetçi/sınırlı görünümler için). */
export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return email;
  const [local, domain] = email.split("@");
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return phone;
  return `${phone.slice(0, 3)}${"*".repeat(Math.max(0, phone.length - 5))}${phone.slice(-2)}`;
}

// --- GÜVENLİ HTTP BAŞLIKLARI ------------------------------------------------

/**
 * Sıkılaştırılmış güvenlik başlıkları. CSP mümkün olduğunca dar; 'unsafe-eval'
 * kaldırıldı. ('unsafe-inline' style, Tailwind/inline stil için korunur.)
 */
export function securityHeaders() {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        // Vite dev/prod bundle'ı için script-src; 'unsafe-eval' KALDIRILDI
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' https: data:",
        "connect-src 'self' https:",
        "frame-ancestors 'none'", // (önceki 'frame-ancestor' yazımı düzeltildi)
        "object-src 'none'",
        "base-uri 'self'",
      ].join("; ")
    );
    next();
  };
}
