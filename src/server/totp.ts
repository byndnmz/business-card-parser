/**
 * totp.ts — RFC 6238 TOTP (Time-based One-Time Password) — saf Node crypto.
 *
 * Google Authenticator / Authy / Microsoft Authenticator ile uyumlu:
 *   HMAC-SHA1, 6 hane, 30 sn periyot. Doğrulamada ±1 zaman penceresi toleransı.
 *
 * Demo sabit kodu yerine GERÇEK MFA. Sır (secret) base32 olarak saklanır,
 * provisioning için otpauth:// URI üretilir (QR olarak gösterilebilir).
 */

import crypto from "crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Rastgele bayttan base32 (RFC 4648, padding'siz) sır üretir. */
export function generateSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP(secret, counter) — RFC 4226 dinamik kesme ile 6 haneli kod. */
function hotp(secretBase32: string, counter: number, digits = 6): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  // 64-bit big-endian sayaç (JS bit işlemleri 32-bit; üst/alt yarıyı ayrı yaz).
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, "0");
}

const PERIOD = 30;

/** Belirli bir zaman için TOTP kodu üretir (test/doğrulama amaçlı). */
export function generateTOTP(secretBase32: string, forTime = Date.now()): string {
  return hotp(secretBase32, Math.floor(forTime / 1000 / PERIOD));
}

/**
 * Kodu doğrular. ±1 pencere (±30 sn) toleransı saat kaymasına izin verir.
 * timing-safe karşılaştırma kullanır.
 */
export function verifyTOTP(secretBase32: string, token: string, window = 1): boolean {
  if (!secretBase32 || !/^\d{6}$/.test((token || "").trim())) return false;
  const t = token.trim();
  const counter = Math.floor(Date.now() / 1000 / PERIOD);
  for (let w = -window; w <= window; w++) {
    const expected = hotp(secretBase32, counter + w);
    const a = Buffer.from(expected);
    const b = Buffer.from(t);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** Authenticator uygulamalarının okuyabileceği otpauth:// provisioning URI'si. */
export function otpauthURI(secretBase32: string, account: string, issuer = "B-CIP"): string {
  // Etiket "issuer:account" — issuer ve account ayrı ayrı encode edilir; aralarındaki
  // ':' ayırıcı LİTERAL kalır (uygulamalar issuer önekini bu ':' ile ayırır).
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
