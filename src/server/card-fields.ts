/**
 * card-fields.ts — Ham OCR metninden kartvizit alanlarını çıkaran SAF ayrıştırıcı.
 *
 * Tesseract gibi bir OCR motorundan gelen metin + kelime kutularını alır;
 * Türkçe/İngilizce sezgisel kurallar + regex ile ad/ünvan/şirket/e-posta/telefon/
 * web/adres/şehir/ülke alanlarını ayırır ve her alan için GERÇEK bounding box
 * (kelime kutularının birleşimi, yüzde cinsinden) üretir.
 *
 * Bu modül tesseract'a bağımlı DEĞİLDİR (birim test edilebilir).
 */

import type { ParsedCard, ParsedField } from "./parser";

export interface OcrWord {
  text: string;
  confidence: number; // 0..100
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?\d[\d\s().\-]{8,}\d)/g;
const URL_RE = /\b((?:https?:\/\/)?(?:www\.)?[A-Za-z0-9\-]+\.(?:com|net|org|gov|edu|mil|io|tr|mss|com\.tr|gov\.tr|org\.tr)(?:\.[A-Za-z]{2,})?(?:\/\S*)?)\b/i;
const LINKEDIN_RE = /linkedin\.com\/(?:in|company)\/[A-Za-z0-9\-_%]+/i;

// Ünvan (title). Türkçe kökler EK-TOLERANSLI (yalnızca baş sınır → "Lideri",
// "Müdürü", "Direktörü" de yakalanır); İngilizce sözcükler tam sınırlı.
const TITLE_KW = /\b(?:m[üu]d[üu]r|y[öo]netici|direkt[öo]r|uzman|m[üu]hendis|lider|[şs]ef|ba[şs]kan|koordinat[öo]r|sorumlu|dan[ıi][şs]man|geli[şs]tirici|ba[şs]m[üu]hendis|amir|teknisyen|analist|mimar)|\b(?:engineer|manager|director|specialist|officer|chief|head|lead|developer|consultant|architect|ceo|cto|cfo|coo|president)\b/i;

// Şirket (company) ekleri/anahtarları (Türkçe kökler ek-toleranslı).
const COMPANY_KW = /\b(?:a\.?[şs]\.?|ltd|inc|gmbh|llc|corp|holding)\b|\b(?:san(?:ayi)?|tic(?:aret)?|teknoloji|technolog|savunma|sanayi|sistem|elektronik|electronic|defen[cs]e|aerospace|havac[ıi]l[ıi]k|group|grup)/i;

// Departman anahtarları (ek-toleranslı).
const DEPT_KW = /\b(?:daire|m[üu]d[üu]rl[üu][ğg]|departman|birim|[şs]ube|b[öo]l[üu]m|ba[şs]kanl[ıi][ğg]|division|department)/i;

// Adres anahtarları
const ADDR_KW = /\b(mah(?:alle(?:si)?)?\.?|cad(?:de(?:si)?)?\.?|sok(?:ak)?\.?|bulvar[ıi]?|blok|no\s*[:.]?\s*\d|kat\s*[:.]?|osb|organize|yerle[şs]ke|plaza|sanayi sitesi|d:\d|\/\s*[A-Za-z])\b/i;

// Büyük Türkiye şehirleri (şehir/ülke tahmini için)
const TR_CITIES = [
  "Adana","Ankara","Antalya","Bursa","Denizli","Diyarbakır","Eskişehir","Gaziantep",
  "İstanbul","Istanbul","İzmir","Izmir","Kayseri","Kocaeli","Konya","Malatya","Mersin",
  "Samsun","Sakarya","Şanlıurfa","Trabzon","Çankaya","Elmadağ","Gebze","Pendik","Tuzla",
];

/**
 * E-postayı toleranslı biçimde bulur. Tesseract '@' işaretini sık yanlış okur
 * (boşluk, ©, ®, (, < vb.) — bu durumları kurtarır.
 */
function findEmail(text: string): string {
  const direct = text.match(EMAIL_RE);
  if (direct) return direct[0].toLowerCase();
  // '@' yerine boşluk ve/veya benzer sembol(ler):  ahmet (at) / ahmet © domain
  const loose = text.match(/([A-Za-z0-9._%+\-]{2,})\s*(?:\(?\s*at\s*\)?|[@＠©®(<{*]{1,2})\s*([A-Za-z0-9.\-]+\.[A-Za-z]{2,})/i);
  if (loose) {
    const local = loose[1].replace(/\s+/g, "");
    const domain = loose[2].replace(/\s+/g, "");
    if (!/^www\.?$/i.test(local)) return `${local}@${domain}`.toLowerCase();
  }
  return "";
}

function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }
function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9ğüşıöç@.+\-]/gi, ""); }

/** Bir değere karşılık gelen kelimelerin birleşik kutusunu (% cinsinden) bulur. */
function boxFor(value: string, words: OcrWord[], imgW: number, imgH: number) {
  const tokens = value.split(/\s+/).map(norm).filter((t) => t.length >= 2);
  if (tokens.length === 0 || imgW <= 0 || imgH <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const matched = words.filter((w) => {
    const nw = norm(w.text);
    return nw.length >= 2 && tokens.some((t) => t.includes(nw) || nw.includes(t));
  });
  if (matched.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const x0 = Math.min(...matched.map((m) => m.bbox.x0));
  const y0 = Math.min(...matched.map((m) => m.bbox.y0));
  const x1 = Math.max(...matched.map((m) => m.bbox.x1));
  const y1 = Math.max(...matched.map((m) => m.bbox.y1));
  return {
    x: Number(((x0 / imgW) * 100).toFixed(1)),
    y: Number(((y0 / imgH) * 100).toFixed(1)),
    width: Number((((x1 - x0) / imgW) * 100).toFixed(1)),
    height: Number((((y1 - y0) / imgH) * 100).toFixed(1)),
  };
}

/** Bir değere karşılık gelen kelimelerin ortalama güvenini (0..1) döndürür. */
function confFor(value: string, words: OcrWord[], fallback = 0.7) {
  const tokens = value.split(/\s+/).map(norm).filter((t) => t.length >= 2);
  const matched = words.filter((w) => tokens.some((t) => norm(w.text).includes(t) || t.includes(norm(w.text))));
  if (matched.length === 0) return fallback;
  return clamp01(matched.reduce((a, w) => a + (w.confidence || 0), 0) / matched.length / 100);
}

/** Bir satırın ad (full_name) gibi görünüp görünmediğini sezgisel değerlendirir. */
function looksLikeName(line: string): boolean {
  if (EMAIL_RE.test(line) || /\d/.test(line)) return false;
  if (COMPANY_KW.test(line) || TITLE_KW.test(line) || ADDR_KW.test(line)) return false;
  const words = line.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  // Çoğu kelime Baş Harfi Büyük olmalı (unvan ekleri Dr./Prof. hariç)
  const capWords = words.filter((w) => /^[A-ZÇĞİÖŞÜ][a-zçğıöşü'.]+$/.test(w) || /^(Dr|Prof|Doç|Müh)\.?$/.test(w));
  return capWords.length >= Math.max(2, words.length - 1);
}

/**
 * Ham OCR metni + kelime kutularından yapılandırılmış ParsedCard üretir.
 * imgW/imgH bilinmiyorsa bounding box'lar (0,0,0,0) kalır (alanlar yine çıkarılır).
 */
export function extractCardFields(
  text: string,
  words: OcrWord[],
  imgW = 0,
  imgH = 0,
  provider = "tesseract"
): ParsedCard {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
  const flat = lines.join("  ");

  // --- Regex tabanlı alanlar (yüksek kesinlik) ---
  const email = findEmail(flat);
  const linkedin = flat.match(LINKEDIN_RE)?.[0] || "";
  const phones = Array.from(flat.matchAll(PHONE_RE))
    .map((m) => m[0].replace(/[^\d+]/g, ""))
    .filter((p) => p.replace(/\D/g, "").length >= 10);
  const mobile = phones.find((p) => /^(\+?90)?0?5\d{9}$/.test(p.replace(/\D/g, "").replace(/^90/, ""))) || "";
  const phone = phones.find((p) => p !== mobile) || phones[0] || "";
  let website = "";
  for (const l of lines) {
    const m = l.match(URL_RE);
    if (m && !m[0].includes("@") && (!email || !email.includes(m[1].replace(/^www\./, "")))) { website = m[1]; break; }
  }
  // Web sitesi e-posta domeninden de türetilebilir
  if (!website && email.includes("@")) website = email.split("@")[1];

  // --- Sezgisel alanlar ---
  const nameLine = lines.find(looksLikeName) || "";
  const titleLine = lines.find((l) => TITLE_KW.test(l) && l !== nameLine && !EMAIL_RE.test(l)) || "";
  const companyLine =
    lines.find((l) => COMPANY_KW.test(l) && l !== nameLine && l !== titleLine) ||
    lines.find((l) => /^[A-ZÇĞİÖŞÜ0-9 .,&'-]{4,}$/.test(l) && l !== nameLine && l !== titleLine && !EMAIL_RE.test(l) && !/\d{4,}/.test(l)) ||
    "";
  const deptLine = lines.find((l) => DEPT_KW.test(l) && l !== companyLine) || "";
  const addrLines = lines.filter((l) => ADDR_KW.test(l));
  const address = addrLines.join(", ");
  const city = TR_CITIES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(flat)) || "";
  const country = /\bt[üu]rkiye\b|\bturkey\b/i.test(flat) ? "Türkiye" : "";

  // --- Alan listesi + bounding box + güven ---
  const fieldDefs: Array<{ name: string; value: string }> = [
    { name: "full_name", value: nameLine },
    { name: "title", value: titleLine },
    { name: "company", value: companyLine },
    { name: "department", value: deptLine },
    { name: "email", value: email },
    { name: "phone", value: phone },
    { name: "mobile_phone", value: mobile },
    { name: "website", value: website },
    { name: "address", value: address },
    { name: "linkedin", value: linkedin },
  ].filter((f) => f.value);

  const fields: ParsedField[] = fieldDefs.map((f) => {
    // Regex-doğrulanan alanlara güven takviyesi
    const base = ["email", "phone", "mobile_phone"].includes(f.name) ? 0.92 : confFor(f.value, words, 0.75);
    return {
      field_name: f.name,
      field_value: f.value,
      confidence_score: Number(base.toFixed(2)),
      valid: true,
      bounding_box: boxFor(f.value, words, imgW, imgH),
    };
  });

  const overall = fields.length
    ? Number((fields.reduce((a, f) => a + f.confidence_score, 0) / fields.length).toFixed(3))
    : 0.5;

  return {
    full_name: nameLine,
    title: titleLine,
    company: companyLine,
    department: deptLine,
    email,
    phone,
    mobile_phone: mobile,
    website,
    address,
    city,
    country,
    linkedin,
    confidence_score: overall,
    fields,
    provider,
    warnings: nameLine ? [] : ["Ad/Soyad güvenle ayrıştırılamadı — manuel kontrol önerilir."],
  };
}
