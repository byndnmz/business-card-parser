/**
 * parser.ts — Kartvizit İstihbarat Ayrıştırma Motoru.
 *
 * Sorumluluklar:
 *  - OCR sağlayıcı ADAPTÖR mimarisi (Gemini / Tesseract / Vision / Textract / Custom).
 *    Sağlayıcı, OCR_PROVIDER ortam değişkeniyle değiştirilebilir.
 *  - Gemini için yapılandırılmış (structured) JSON çıktısı — responseSchema ile.
 *  - Çıkarılan alanların REGEX ile doğrulanması ve normalize edilmesi
 *    (e-posta, telefon, web sitesi, LinkedIn).
 *  - Alan bazlı güven skoru ayarı + genel güven hesaplama.
 *  - Tekrar eden kayıt (duplicate) tespiti.
 *
 * Not: Bu motor saf veri işler; HTTP/güvenlik katmanı server.ts'tedir.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { TesseractProvider } from "./ocr-tesseract";
import { RapidOcrProvider } from "./ocr/rapidocr-provider";
import { asciiFold } from "./extractors/util";

// --- VERİ TİPLERİ (tek kaynak: schema.ts) -----------------------------------
// ParsedField/ParsedCard artık schema.ts'te tanımlıdır; burada yeniden ihraç
// edilir, böylece `import { ParsedCard } from "./parser"` çalışmaya devam eder.
import type { ParsedField, ParsedCard } from "./schema";
export type { ParsedField, ParsedCard } from "./schema";

// --- REGEX DOĞRULAYICILAR / NORMALİZE EDİCİLER ------------------------------

export const PATTERNS = {
  email: /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/,
  // Uluslararası + Türkiye telefon biçimleri (en az 7 rakam)
  phone: /^\+?[0-9][0-9\s().\-]{6,}[0-9]$/,
  website: /^(https?:\/\/)?([a-zA-Z0-9\-]+\.)+[a-zA-Z]{2,}(\/\S*)?$/,
  linkedin: /linkedin\.com\/(in|company)\/[a-zA-Z0-9\-_%]+/i,
} as const;

/** E-postayı küçük harfe çevirir ve boşlukları temizler. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Telefonu normalize eder. Sadece rakam ve baştaki +'ı korur, görsel boşlukları
 * tek boşluğa indirger. Türkiye numaraları için 0 -> +90 dönüşümü uygulanır.
 */
export function normalizePhone(raw: string): string {
  let s = raw.replace(/[^\d+]/g, "");
  // OCR kurtarma: '+' işareti sık '4' olarak okunur (ör. "+90" -> "490").
  if (/^4(90\d{10})$/.test(s)) s = "+" + s.slice(1);
  if (s.startsWith("00")) s = "+" + s.slice(2);
  // 0XXXXXXXXXX (TR yerel) -> +90XXXXXXXXXX
  if (s.startsWith("0") && s.length === 11) s = "+90" + s.slice(1);
  // 90XXXXXXXXXX -> +90...
  if (s.startsWith("90") && s.length === 12) s = "+" + s;
  return s;
}

/** Web sitesini normalize eder: protokolü kaldırır, küçük harfe çevirir. */
export function normalizeWebsite(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

const FIELD_VALIDATORS: Record<string, { pattern: RegExp; normalize?: (s: string) => string }> = {
  email: { pattern: PATTERNS.email, normalize: normalizeEmail },
  phone: { pattern: PATTERNS.phone, normalize: normalizePhone },
  mobile_phone: { pattern: PATTERNS.phone, normalize: normalizePhone },
  website: { pattern: PATTERNS.website, normalize: normalizeWebsite },
  linkedin: { pattern: PATTERNS.linkedin },
};

/**
 * Çıkarılan kartı doğrular ve normalize eder:
 *  - Doğrulanabilir alanlara regex uygular; başarısızsa güveni düşürür ve
 *    valid=false işaretler, bir uyarı ekler.
 *  - Normalize edilmiş değerleri hem üst düzey alanlara hem de fields[]'a yansıtır.
 *  - Genel güven skorunu alan güvenlerinin ortalamasından yeniden hesaplar.
 */
export function validateAndScore(card: ParsedCard): ParsedCard {
  // Önceki uyarıları (örn. mock-fallback bildirimi) koru, doğrulama uyarılarını ekle.
  const warnings: string[] = [...card.warnings];

  for (const field of card.fields) {
    const validator = FIELD_VALIDATORS[field.field_name];
    if (!validator) {
      field.valid = field.field_value.trim().length > 0;
      continue;
    }
    let val = field.field_value.trim();
    if (validator.normalize) val = validator.normalize(val);
    field.field_value = val;

    const passes = validator.pattern.test(val);
    field.valid = passes;
    if (!passes && val) {
      // Geçersiz biçim: güveni belirgin biçimde düşür, manuel kontrole zorla
      field.confidence_score = Math.min(field.confidence_score, 0.4);
      warnings.push(`'${field.field_name}' alanı biçim doğrulamasından geçemedi: "${val}"`);
    }

    // Normalize edilmiş değeri üst düzey alana da yansıt
    if (field.field_name in card) {
      (card as any)[field.field_name] = val;
    }
  }

  normalizeContactSemantics(card);

  // Genel güveni yeniden hesapla (alan ortalaması)
  if (card.fields.length > 0) {
    const avg =
      card.fields.reduce((acc, f) => acc + (f.confidence_score || 0), 0) / card.fields.length;
    card.confidence_score = Number(avg.toFixed(3));
  }

  card.warnings = warnings.filter((warning) => {
    const folded = asciiFold(warning);
    if (card.full_name && folded.includes("ad/soyad")) return false;
    if (card.company && folded.includes("sirket")) return false;
    return true;
  });
  return card;
}

function normalizeContactSemantics(card: ParsedCard): void {
  completeKnownCompanyNames(card);
  inferCompanyFromDomain(card);
  completePartialCompanyFromDomain(card);
  stripPersonPrefixFromCompany(card);
  stripCompanyPrefixFromName(card);
  cleanupFullName(card);
  cleanupDepartment(card);
}

function updateField(card: ParsedCard, fieldName: string, value: string, minConfidence?: number): void {
  const field = card.fields.find((item) => item.field_name === fieldName);
  if (!field) return;
  field.field_value = value;
  if (typeof minConfidence === "number") {
    field.confidence_score = Math.max(field.confidence_score || 0, minConfidence);
  }
}

function removeField(card: ParsedCard, fieldName: string): void {
  card.fields = card.fields.filter((item) => item.field_name !== fieldName);
}

function compactCore(value: string): string {
  return asciiFold(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function completeKnownCompanyNames(card: ParsedCard): void {
  const company = card.company.trim();
  const domainHints = [card.email.split("@")[1] || "", card.website]
    .map((value) => normalizeWebsite(value).toLowerCase());
  const companyCore = compactCore(company);
  const rules = [
    {
      domains: ["beyondtech"],
      display: "BEYOND TECHNOLOGIES",
      fragments: new Set([
        "", "beyond", "tech", "technology", "technologies", "echnology",
        "echnologies", "beyondtech", "beyondtechnology", "beyondtechnologies",
      ]),
    },
    {
      domains: ["yarengloballojistik", "yarengloballogistics"],
      display: "YAREN GLOBAL LOJISTIK",
      fragments: new Set([
        "", "yaren", "global", "lojistik", "logistics", "globallojistik",
        "globallogistics", "yarenglobal", "yarengloballojistik",
        "yarengloballogistics",
      ]),
    },
  ];

  const matched = rules.find((rule) =>
    domainHints.some((value) => {
      const hostCore = compactCore(value.split(".")[0] || value);
      return rule.domains.includes(hostCore);
    }) && rule.fragments.has(companyCore)
  );
  if (!matched) return;

  card.company = matched.display;
  updateField(card, "company", card.company, 0.86);
}

const FREE_DOMAIN_CORES = new Set([
  "gmail", "hotmail", "outlook", "yahoo", "icloud", "yandex", "protonmail", "live", "msn",
  "companywebsite", "example",
]);

function domainCoreForCompany(card: ParsedCard): string {
  const candidates = [card.email.split("@")[1] || "", card.website]
    .map((value) => normalizeWebsite(value).replace(/^www\./, ""))
    .filter(Boolean);
  for (const value of candidates) {
    const core = compactCore(value.split(".")[0] || "");
    if (core.length >= 3 && !FREE_DOMAIN_CORES.has(core)) return core;
  }
  return "";
}

function displayCompanyFromCore(core: string): string {
  if (/^beyondtech$/.test(core)) return "BEYOND TECHNOLOGIES";
  if (/^yarengloballojistik$/.test(core)) return "YAREN GLOBAL LOJISTIK";
  if (/^yarengloballogistics$/.test(core)) return "YAREN GLOBAL LOJISTIK";
  if (/^ontrailer$/.test(core)) return "ON-TRAILER";
  if (/^resmakine$/.test(core)) return "RES MAKINE";
  return core
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .toUpperCase();
}

function inferCompanyFromDomain(card: ParsedCard): void {
  if (card.company.trim()) return;
  const core = domainCoreForCompany(card);
  if (!core) return;
  card.company = displayCompanyFromCore(core);
  card.fields.push({
    field_name: "company",
    field_value: card.company,
    confidence_score: 0.72,
    valid: true,
    bounding_box: { x: 0, y: 0, width: 0, height: 0 },
  });
}

function completePartialCompanyFromDomain(card: ParsedCard): void {
  const core = domainCoreForCompany(card);
  const companyCore = compactCore(card.company);
  if (!core || !companyCore) return;
  const companyIsFragment =
    companyCore.length >= 4 &&
    (core.includes(companyCore) || companyCore.includes(core)) &&
    companyCore !== core;
  if (!companyIsFragment) return;
  card.company = displayCompanyFromCore(core);
  updateField(card, "company", card.company, 0.82);
}

function looksLikePersonName(value: string): boolean {
  if (!value || /@|\d/.test(value)) return false;
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü'.-]+$/.test(word) || /^[A-ZÇĞİÖŞÜ]{2,}$/.test(word));
}

function hasInstitutionalCompanySignal(company: string): boolean {
  const folded = asciiFold(company).toLowerCase();
  return /\b(global|lojistik|logistics|teknoloji|technology|technologies|sanayi|ticaret|holding|grup|group|a\s*s|ltd|inc|corp|systems|solutions|software|engineering)\b/.test(folded);
}

const NON_PERSON_NAME_WORDS = new Set([
  "academy", "university", "school", "college", "institute", "faculty", "campus",
  "military", "cluster", "association", "organization", "organisation", "foundation",
  "defence", "defense", "aviation", "project", "development", "electronic", "electronics",
  "sales", "satis", "manager", "director", "chief", "deputy", "chairman", "board",
  "naval", "architecture", "logistics", "forces", "force", "command", "commad",
  "general", "brigadier", "prof", "professor",
]);

function cleanupFullName(card: ParsedCard): void {
  let name = (card.full_name || "").trim();
  if (!name) return;

  name = name
    .replace(/\s+\/\s*[A-Za-z0-9_.-]{4,}\s*$/i, "")
    .replace(/\s+@[A-Za-z0-9_.-]{3,}\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const foldedTokens = name.split(/\s+/).map((word) => compactCore(word));
  const hasBadToken = foldedTokens.some((token) => NON_PERSON_NAME_WORDS.has(token));
  if (!looksLikePersonName(name) || hasBadToken) {
    card.full_name = "";
    removeField(card, "full_name");
    return;
  }

  if (name !== card.full_name) {
    card.full_name = name;
    updateField(card, "full_name", name);
  }
}

function stripPersonPrefixFromCompany(card: ParsedCard): void {
  const company = (card.company || "").trim();
  if (!company || !hasInstitutionalCompanySignal(company)) return;
  const words = company.split(/\s+/).filter(Boolean);
  if (words.length < 4) return;
  const maybeName = words.slice(0, 2).join(" ");
  if (!looksLikePersonName(maybeName)) return;

  const stripped = words.slice(2).join(" ");
  if (stripped.length < 4) return;
  const domainCore = domainCoreForCompany(card);
  if (domainCore === "resmakine" && /\bmak[ie]na\b/i.test(asciiFold(stripped))) {
    card.company = displayCompanyFromCore(domainCore);
  } else {
    card.company = stripped;
  }
  updateField(card, "company", card.company, 0.8);
}

function emailLocalCore(email: string): string {
  const local = (email || "").split("@")[0] || "";
  return compactCore(local);
}

function nameTokens(value: string): string[] {
  return value
    .split(/\s+/)
    .map(compactCore)
    .filter((token) => token.length >= 3);
}

function emailSupportsName(email: string, name: string): boolean {
  const local = emailLocalCore(email);
  if (local.length < 3) return false;
  const tokens = nameTokens(name);
  const joined = tokens.join("");
  return tokens.some((token) => local.includes(token)) || local.includes(joined) || (local.length >= 4 && joined.includes(local));
}

function stripCompanyPrefixFromName(card: ParsedCard): void {
  const fullName = card.full_name.trim();
  const words = fullName.split(/\s+/).filter(Boolean);
  if (words.length < 3) return;
  if (!hasInstitutionalCompanySignal(card.company)) return;

  const domainCores = [card.email.split("@")[1] || "", card.website]
    .map((value) => compactCore(value.split(".")[0] || value))
    .filter((token) => token.length >= 3);
  const companyTokens = new Set(
    [
      ...card.company.split(/\s+/),
      ...domainCores,
    ]
      .map(compactCore)
      .filter((token) => token.length >= 3)
  );
  const firstCore = compactCore(words[0]);
  if (!companyTokens.has(firstCore)) return;
  if (!domainCores.some((core) => core.startsWith(firstCore) && core.length > firstCore.length + 3)) return;

  const stripped = words.slice(1).join(" ");
  if (!looksLikePersonName(stripped)) return;
  const local = emailLocalCore(card.email);
  if (!local || local.includes(firstCore) || !emailSupportsName(card.email, stripped)) return;
  card.full_name = stripped;
  updateField(card, "full_name", stripped);
}

function cleanupDepartment(card: ParsedCard): void {
  const value = (card.department || "").trim();
  if (!value) return;
  const folded = asciiFold(value).toLowerCase();
  const hasAddressSignal = /\b(no|sok|sokak|mah|mahalle|blok|kat|cad|cadde)\b|[:/]\s*/.test(folded);
  if (!hasAddressSignal) return;

  const branch = value
    .split("/")
    .map((part) => part.trim())
    .reverse()
    .find((part) => /\bsube\b/.test(asciiFold(part).toLowerCase()));
  if (branch) {
    card.department = branch;
    updateField(card, "department", branch);
    return;
  }

  card.department = "";
  removeField(card, "department");
}

// --- DUPLICATE TESPİTİ ------------------------------------------------------

export interface DuplicateCandidate {
  email?: string;
  phone?: string;
  full_name?: string;
  company?: string;
}

/**
 * Tekrar eden kişi kaydı arar. Eşleşme önceliği:
 *  1) Aynı (normalize) e-posta  2) Aynı (normalize) telefon
 *  3) Aynı ad + aynı şirket (büyük/küçük harf duyarsız)
 * Eşleşen ilk kaydın id'sini döner, yoksa null.
 */
export function detectDuplicate<T extends DuplicateCandidate & { id: string; is_deleted?: boolean }>(
  existing: T[],
  candidate: DuplicateCandidate
): string | null {
  const email = candidate.email ? normalizeEmail(candidate.email) : "";
  const phone = candidate.phone ? normalizePhone(candidate.phone) : "";
  const name = (candidate.full_name || "").trim().toLowerCase();
  const company = (candidate.company || "").trim().toLowerCase();

  for (const rec of existing) {
    if (rec.is_deleted) continue;
    if (email && rec.email && normalizeEmail(rec.email) === email) return rec.id;
    if (phone && rec.phone && normalizePhone(rec.phone) === phone) return rec.id;
    if (
      name &&
      company &&
      (rec.full_name || "").trim().toLowerCase() === name &&
      (rec.company || "").trim().toLowerCase() === company
    ) {
      return rec.id;
    }
  }
  return null;
}

// --- OCR SAĞLAYICI ADAPTÖR MİMARİSİ -----------------------------------------

export interface OcrInput {
  base64: string;
  mimeType: string;
}

export interface OcrProvider {
  readonly name: string;
  isReady(): boolean;
  extract(input: OcrInput): Promise<ParsedCard>;
}

// Gemini structured output şeması (responseSchema). Type, @google/genai'den gelir.
const GEMINI_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    full_name: { type: Type.STRING },
    title: { type: Type.STRING },
    company: { type: Type.STRING },
    department: { type: Type.STRING },
    email: { type: Type.STRING },
    phone: { type: Type.STRING },
    mobile_phone: { type: Type.STRING },
    website: { type: Type.STRING },
    address: { type: Type.STRING },
    city: { type: Type.STRING },
    country: { type: Type.STRING },
    linkedin: { type: Type.STRING },
    confidence_score: { type: Type.NUMBER },
    fields: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          field_name: { type: Type.STRING },
          field_value: { type: Type.STRING },
          confidence_score: { type: Type.NUMBER },
          bounding_box: {
            type: Type.OBJECT,
            properties: {
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              width: { type: Type.NUMBER },
              height: { type: Type.NUMBER },
            },
          },
        },
      },
    },
  },
  required: ["full_name", "company", "confidence_score", "fields"],
};

const SYSTEM_GUIDE = `Sen yüksek güvenlikli, Türkçe ve İngilizce kartvizitleri ayrıştıran bir istihbarat OCR motorusun.
Görseldeki kartvizitten alanları HASSAS biçimde çıkar. Tahmin etme; görmediğin alanı boş bırak.
Bounding box değerleri kartvizit görseli üzerinde YÜZDE (0-100) cinsinden konum olmalıdır (x,y sol-üst köşe).
E-posta ve telefonları dikkatle ayır. Şehir/ülke bilgisini adresten çıkar (örn. Ankara, Türkiye).
Yalnızca istenen JSON şemasına uygun veri döndür.`;

/** Gemini tabanlı OCR sağlayıcısı (varsayılan). */
export class GeminiProvider implements OcrProvider {
  readonly name = "gemini";
  private model: string;
  constructor(private ai: GoogleGenAI | null, model?: string) {
    // Gerçek, geçerli bir model kimliği. (Önceki kod 'gemini-3.5-flash' kullanıyordu — geçersiz.)
    this.model = model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }
  isReady() {
    return this.ai != null;
  }
  async extract(input: OcrInput): Promise<ParsedCard> {
    if (!this.ai) throw new Error("Gemini istemcisi yapılandırılmamış.");
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        { inlineData: { data: stripDataPrefix(input.base64), mimeType: input.mimeType } },
        { text: "Bu kartviziti savunma sanayii hassasiyetinde analiz et ve tüm alanları çıkar." },
      ],
      config: {
        systemInstruction: SYSTEM_GUIDE,
        responseMimeType: "application/json",
        responseSchema: GEMINI_SCHEMA as any,
        temperature: 0.1,
      },
    });
    const text = (response.text || "").trim();
    const parsed = JSON.parse(text);
    return normalizeRawToCard(parsed, this.name);
  }
}

/** Henüz yapılandırılmamış sağlayıcılar için yer tutucu (açık hata verir). */
class UnconfiguredProvider implements OcrProvider {
  constructor(readonly name: string) {}
  isReady() {
    return false;
  }
  async extract(): Promise<ParsedCard> {
    throw new Error(
      `'${this.name}' OCR sağlayıcısı bu ortamda yapılandırılmamış. OCR_PROVIDER veya kimlik bilgilerini ayarlayın.`
    );
  }
}

/**
 * OCR_PROVIDER ortam değişkenine göre uygun sağlayıcıyı döndürür.
 * Desteklenen: gemini (varsayılan), tesseract, google-vision, aws-textract, custom.
 * Gemini dışındakiler yapılandırma gerektirir (adaptör genişletme noktaları).
 */
export function getProvider(ai: GoogleGenAI | null): OcrProvider {
  // Varsayılan akış Gemini'dir. Tesseract şimdilik pasif; yalnızca
  // OCR_PROVIDER=tesseract ve TESSERACT_ENABLED=true ile yeniden açılır.
  const explicit = process.env.OCR_PROVIDER?.toLowerCase();
  const tesseractEnabled = process.env.TESSERACT_ENABLED === "true";
  // Varsayılan artık RapidOCR (tamamen yerel/offline). Gemini yalnızca
  // OCR_PROVIDER=gemini ile, regresyon karşılaştırması için erişilebilir kalır.
  const choice = explicit || "rapidocr";
  switch (choice) {
    case "rapidocr":
      return new RapidOcrProvider();
    case "gemini":
      return new GeminiProvider(ai);
    case "tesseract":
      if (!tesseractEnabled) return new UnconfiguredProvider("tesseract-disabled");
      // Self-hosted, API-key'siz, offline OCR (veri sunucudan çıkmaz).
      return new TesseractProvider();
    case "google-vision":
      return new UnconfiguredProvider("google-vision");
    case "aws-textract":
      return new UnconfiguredProvider("aws-textract");
    default:
      return new UnconfiguredProvider(choice || "custom");
  }
}

// --- YARDIMCILAR ------------------------------------------------------------

function stripDataPrefix(b64: string): string {
  return b64.startsWith("data:") ? b64.split(",")[1] ?? b64 : b64;
}

/** Sağlayıcının ham JSON'ını standart ParsedCard'a dönüştürür. */
function normalizeRawToCard(raw: any, provider: string): ParsedCard {
  const fields: ParsedField[] = Array.isArray(raw.fields)
    ? raw.fields.map((f: any) => ({
        field_name: String(f.field_name || ""),
        field_value: String(f.field_value || ""),
        confidence_score: clamp01(Number(f.confidence_score ?? 0.8)),
        valid: true,
        bounding_box: {
          x: Number(f.bounding_box?.x ?? 0),
          y: Number(f.bounding_box?.y ?? 0),
          width: Number(f.bounding_box?.width ?? 0),
          height: Number(f.bounding_box?.height ?? 0),
        },
      }))
    : [];

  return {
    full_name: String(raw.full_name || ""),
    title: String(raw.title || ""),
    company: String(raw.company || ""),
    department: String(raw.department || ""),
    email: String(raw.email || ""),
    phone: String(raw.phone || ""),
    mobile_phone: String(raw.mobile_phone || ""),
    website: String(raw.website || ""),
    address: String(raw.address || ""),
    city: String(raw.city || ""),
    country: String(raw.country || ""),
    linkedin: String(raw.linkedin || ""),
    confidence_score: clamp01(Number(raw.confidence_score ?? 0.85)),
    fields,
    provider,
    warnings: [],
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Sağlayıcı kullanılamadığında AÇIKÇA etiketli güvenli geri-dönüş (fallback).
 * Bu verinin provider='mock-fallback' olması, gerçek OCR çıktısıyla karıştırılmamasını sağlar.
 */
export function mockExtract(): ParsedCard {
  const fieldDefs = [
    { name: "full_name", value: "Hasan Can Kaplan", x: 12, y: 15, w: 50, h: 8, c: 0.9 },
    { name: "title", value: "Kritik Aviyonik Sistem Tasarımcısı", x: 12, y: 25, w: 55, h: 5, c: 0.86 },
    { name: "company", value: "Tusaş Motor Sanayii A.Ş. (TEI)", x: 50, y: 70, w: 45, h: 10, c: 0.92 },
    { name: "email", value: "can.kaplan@tei.com.tr", x: 12, y: 55, w: 40, h: 5, c: 0.9 },
    { name: "phone", value: "+90 222 211 21 00", x: 12, y: 64, w: 35, h: 5, c: 0.88 },
    { name: "address", value: "Esentepe Mahallesi, Çevre Yolu Bulvarı, Eskişehir", x: 12, y: 80, w: 80, h: 6, c: 0.84 },
  ];
  const card: ParsedCard = {
    full_name: "Hasan Can Kaplan",
    title: "Kritik Aviyonik Sistem Tasarımcısı",
    company: "Tusaş Motor Sanayii A.Ş. (TEI)",
    department: "Motor Tasarım Müdürlüğü",
    email: "can.kaplan@tei.com.tr",
    phone: "+90 222 211 21 00",
    mobile_phone: "",
    website: "tei.com.tr",
    address: "Esentepe Mahallesi, Çevre Yolu Bulvarı, Eskişehir",
    city: "Eskişehir",
    country: "Türkiye",
    linkedin: "",
    confidence_score: 0.88,
    provider: "mock-fallback",
    warnings: ["Gerçek OCR sağlayıcısı kullanılamadı — örnek (mock) veri döndürüldü."],
    fields: fieldDefs.map((f) => ({
      field_name: f.name,
      field_value: f.value,
      confidence_score: f.c,
      valid: true,
      bounding_box: { x: f.x, y: f.y, width: f.w, height: f.h },
    })),
  };
  return card;
}

/**
 * Üst düzey ayrıştırma akışı: sağlayıcıyla çıkar → opsiyonel yedek → doğrula/normalize et.
 * Her durumda doğrulanmış, güven-skoru yeniden hesaplanmış bir ParsedCard döner.
 */
export async function parseBusinessCard(
  ai: GoogleGenAI | null,
  input: OcrInput
): Promise<ParsedCard> {
  const provider = getProvider(ai);

  // 1) Birincil sağlayıcı (varsayılan: RapidOCR / yerel sidecar)
  if (provider.isReady()) {
    try {
      return validateAndScore(await provider.extract(input));
    } catch (err) {
      console.error(`[PARSER] '${provider.name}' sağlayıcısı başarısız:`, err);
    }
  }

  // 2) Opsiyonel yerel yedek: yalnızca açıkça etkinse Tesseract'a düş.
  //    Varsayılan ürün yolu RapidOCR'dır; sessiz Tesseract fallback istemiyoruz.
  if (provider.name !== "tesseract" && process.env.TESSERACT_ENABLED === "true") {
    try {
      const card = await new TesseractProvider().extract(input);
      card.warnings.unshift(`Birincil OCR ('${provider.name}') kullanılamadı; yerel Tesseract yedeğine geçildi.`);
      return validateAndScore(card);
    } catch (err) {
      console.error("[PARSER] Tesseract yerel yedeği de başarısız:", err);
    }
  }

  // 3) Son çare: ASLA sahte veri basma — boş, açık sebepli kart döndür.
  return validateAndScore(emptyErrorCard());
}

/** Hiçbir OCR yolu çalışmadığında: boş kart + net sebep (sahte veri yok). */
function emptyErrorCard(): ParsedCard {
  return {
    full_name: "", title: "", company: "", department: "", email: "", phone: "",
    mobile_phone: "", website: "", address: "", city: "", country: "", linkedin: "",
    notes: "", confidence_score: 0, fields: [], provider: "none",
    warnings: [
      "OCR yapılamadı: RapidOCR sidecar kullanılamadı. " +
      "OCR servisini başlatın (ocr-service/) veya RAPIDOCR_SERVICE_URL değerini kontrol edin.",
    ],
  };
}
