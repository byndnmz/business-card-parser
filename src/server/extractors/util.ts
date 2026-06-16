/**
 * extractors/util.ts — Çıkarıcılar için ortak yardımcılar.
 *
 * Bir değerin görseldeki KAYNAK kutusunu (yüzde) ve güvenini, layout satır/kelime
 * kutularından türetir. Karakter-oranı tahminiyle satır içi alt-kutu da üretir
 * (overlay'in doğru oturması için).
 */

import type { LayoutModel, LayoutLine, OcrBox, BoundingBox, FieldHit, FieldName } from "../schema";
import { toPercentBox } from "../layout/reconstruct";
import { THRESHOLDS } from "../config/thresholds";

export function normToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9ğüşıöçİ@.+\-]/gi, "");
}

/** Türkçe-duyarlı küçük harf: İ→i, I→ı (JS toLowerCase TR'de hatalıdır). */
export function trLower(s: string): string {
  return s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

/**
 * ASCII katlama — yalnızca EŞLEŞTİRME için (gösterim değil). Türkçe diakritikleri
 * ve I/İ/ı varyantlarını ASCII'ye indirger; e-posta domaini (ASCII) ile OCR'lı
 * şirket adını güvenle karşılaştırmayı sağlar (LİMİT/LIMIT/lımıt → limit).
 */
export function asciiFold(s: string): string {
  return s
    .replace(/[İIıîÎ]/g, "i")
    .replace(/[şŞ]/g, "s").replace(/[çÇ]/g, "c").replace(/[ğĞ]/g, "g")
    .replace(/[öÖ]/g, "o").replace(/[üÜ]/g, "u")
    .toLowerCase();
}

/** Bir sözcük Baş-Harfi-Büyük mü (Türkçe karakter dâhil)? */
export function isCapWord(w: string): boolean {
  return /^[A-ZÇĞİÖŞÜ][a-zçğıöşü'.]+$/.test(w);
}

/** Metnin çoğunluğu BÜYÜK HARF mi (şirket adı eğilimi)? */
export function isMostlyCaps(s: string): boolean {
  const letters = s.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, "");
  if (letters.length < 3) return false;
  const upper = (s.match(/[A-ZÇĞİÖŞÜ]/g) || []).length;
  return upper / letters.length >= 0.7;
}

const WORD_CHARS = "a-z0-9ğüşıöç";

function escapeTerm(term: string): string {
  return trLower(term).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
}

/**
 * TAM SÖZCÜK eşleşmesi (her iki uçta sınır + sondaki opsiyonel nokta).
 * Kısa ekler (sa, ag, co.) kelime İÇİNDE substring olarak eşleşmez —
 * "sadık" içindeki "sa" YANLIŞ pozitif vermez. ("a.ş." gibi noktalı/boşluklu
 * biçimler de desteklenir.)
 */
export function containsWord(lower: string, term: string): boolean {
  const esc = escapeTerm(term);
  if (!esc) return false;
  return new RegExp(`(?<![${WORD_CHARS}])${esc}\\.?(?![${WORD_CHARS}])`, "i").test(lower);
}

/**
 * KÖK eşleşmesi (yalnızca baş sınır, son sınır YOK) — Türkçe ek-toleransı için.
 * "müdür" → "müdürü", "sanayi" → "sanayii", "lider" → "lideri" yakalanır.
 */
export function containsStem(lower: string, stem: string): boolean {
  const esc = escapeTerm(stem);
  if (!esc) return false;
  return new RegExp(`(?<![${WORD_CHARS}])${esc}`, "i").test(lower);
}

/** Bir satırın tüm kutusunu yüzde olarak verir. */
export function lineBox(line: LayoutLine, m: LayoutModel): BoundingBox {
  const box = line.sourceBbox ?? line.bbox;
  const imgW = line.sourceBbox ? (m.sourceImageWidth ?? m.imageWidth) : m.imageWidth;
  const imgH = line.sourceBbox ? (m.sourceImageHeight ?? m.imageHeight) : m.imageHeight;
  return toPercentBox(box, imgW, imgH);
}

/**
 * Satır içindeki bir alt-dizginin kutusunu, karakter indeks oranıyla TAHMİN eder.
 * Tek değerli satırlarda satırın tamamına eşittir; etiketli satırlarda (ör.
 * "Tel: +90...") değerin bulunduğu x-aralığını yaklaşık verir.
 */
export function subBox(line: LayoutLine, fullText: string, sub: string, m: LayoutModel): BoundingBox {
  if (line.sourceBbox) return lineBox(line, m);
  const idx = fullText.toLowerCase().indexOf(sub.toLowerCase());
  if (idx < 0 || fullText.length === 0) return lineBox(line, m);
  const startRatio = idx / fullText.length;
  const endRatio = (idx + sub.length) / fullText.length;
  const { x0, x1, y0, y1 } = line.bbox;
  const w = x1 - x0;
  return toPercentBox(
    { x0: x0 + w * startRatio, y0, x1: x0 + w * endRatio, y1 },
    m.imageWidth,
    m.imageHeight
  );
}

/** Bir değere karşılık gelen kelimelerin güvenini (0..1) döndürür. */
export function wordConfidence(line: LayoutLine, fallback = THRESHOLDS.fallbackWordConfidence): number {
  if (!line.words.length) return fallback;
  const c = line.words.reduce((a, w) => a + (w.confidence || 0), 0) / line.words.length;
  return c > 0 ? Number(c.toFixed(3)) : fallback;
}

/** İlk eşleşen satırı ve eşleşen metni döndürür. */
export function findInLines(
  m: LayoutModel,
  re: RegExp
): { line: LayoutLine; match: RegExpMatchArray } | null {
  for (const line of m.lines) {
    const match = line.text.match(re);
    if (match) return { line, match };
  }
  return null;
}

export function makeHit(
  field_name: FieldName,
  value: string,
  confidence: number,
  bbox: BoundingBox,
  source: string,
  opts: { valid?: boolean; signals?: Record<string, number> } = {}
): FieldHit {
  return {
    field_name,
    value,
    confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(3)),
    bbox,
    source,
    valid: opts.valid ?? true,
    needsReview: confidence < THRESHOLDS.reviewBelow,
    signals: opts.signals,
  };
}

/** Bir satırın görselin üst bölgesinde olup olmadığı (isim/şirket sinyali). */
export function isTopRegion(line: LayoutLine, m: LayoutModel): boolean {
  if (m.imageHeight <= 0) return false;
  return (line.yCenter / m.imageHeight) * 100 <= THRESHOLDS.topRegionPct;
}

/** Satır yüksekliğinin medyana oranı (punto vekili). */
export function fontRatio(line: LayoutLine, m: LayoutModel): number {
  if (!m.medianHeight) return 1;
  return line.height / m.medianHeight;
}
