/**
 * extractors/semantic.ts — Semantik alanlar için ÇOK-SİNYALLİ skorlayıcılar.
 *
 * İsim / unvan / şirket TEK kuralla değil, sinyallerin TOPLAMIYLA bulunur:
 * konum (üst blok), punto boyutu (bbox yüksekliği), regex/sözlük eşleşmesi,
 * e-posta domaini ilişkisi, Title-Case/ALL-CAPS eğilimi. Her satır her alan
 * tipine karşı skorlanır; atama orkestratörde (scoring.ts) yapılır.
 */

import type { LayoutModel, LayoutLine } from "../schema";
import { THRESHOLDS } from "../config/thresholds";
import {
  TITLE_KEYWORDS_TR, TITLE_KEYWORDS_EN, TITLE_PREFIXES,
  COMPANY_LEGAL_SUFFIXES, COMPANY_SECTOR_WORDS, DEPARTMENT_KEYWORDS,
  ADDRESS_KEYWORDS, TR_COMMON_NAMES, TR_COMMON_SURNAMES,
} from "../config/dictionaries";
import { trLower, asciiFold, isCapWord, isMostlyCaps, isTopRegion, fontRatio, containsWord, containsStem } from "./util";

export interface Score {
  score: number;
  signals: Record<string, number>;
}

const EMAIL_OR_URL = /@|https?:\/\/|www\.|\.(com|net|org|gov|edu|tr|io)\b/i;
const HAS_DIGIT = /\d/;

/** TAM sözcük (sınırlı) — kısa eklerin kelime içinde yanlış eşleşmesini önler. */
const anyWord = (lower: string, words: string[]): boolean => words.some((w) => containsWord(lower, w) || containsWord(asciiFold(lower), asciiFold(w)));
/** KÖK (ek-toleranslı) — TR çekim eklerini yakalar. */
const anyStem = (lower: string, words: string[]): boolean => words.some((w) => containsStem(lower, w) || containsStem(asciiFold(lower), asciiFold(w)));

function hasTitleKw(lower: string): boolean {
  if (anyStem(lower, TITLE_KEYWORDS_TR)) return true; // TR kökleri ek-toleranslı
  return TITLE_KEYWORDS_EN.some((k) => new RegExp(`\\b${k}\\b`, "i").test(lower)); // EN sınırlı
}

// --- UNVAN ------------------------------------------------------------------
function hasTitleAbbrev(text: string): boolean {
  const folded = asciiFold(text).replace(/\$/g, "s").toLowerCase();
  return /\b(yon|krl|kurul|bsk|bask|yrd|yard)\b/.test(folded);
}

export function titleScore(line: LayoutLine, m: LayoutModel): Score {
  const text = line.text.trim();
  const lower = trLower(text);
  const signals: Record<string, number> = {};
  if (EMAIL_OR_URL.test(text)) return { score: 0, signals };
  let score = 0;
  if (hasTitleKw(lower)) { score += 0.6; signals.keyword = 1; }
  if (hasTitleAbbrev(text)) { score += 0.5; signals.abbrev = 1; }
  const words = text.split(/\s+/);
  if (words.length >= 1 && words.length <= 6) score += 0.1;
  if (HAS_DIGIT.test(text)) score -= 0.2;
  // Departman sözcükleri unvana benzeyebilir ama ayrı alandır → hafif ceza
  if (anyWord(lower, DEPARTMENT_KEYWORDS) && !signals.keyword) score -= 0.1;
  return { score: clamp(score), signals };
}

// --- DEPARTMAN --------------------------------------------------------------
export function departmentScore(line: LayoutLine, m: LayoutModel): Score {
  const lower = trLower(line.text);
  const signals: Record<string, number> = {};
  if (EMAIL_OR_URL.test(line.text)) return { score: 0, signals };
  let score = 0;
  if (anyWord(lower, DEPARTMENT_KEYWORDS)) { score += 0.55; signals.keyword = 1; }
  return { score: clamp(score), signals };
}

// --- ŞİRKET -----------------------------------------------------------------
export function companyScore(line: LayoutLine, m: LayoutModel, emailDomainCore?: string): Score {
  const text = line.text.trim();
  const lower = trLower(text);
  const signals: Record<string, number> = {};
  if (EMAIL_OR_URL.test(text)) return { score: 0, signals };
  let score = 0;

  if (anyWord(lower, COMPANY_LEGAL_SUFFIXES)) { score += 0.45; signals.legal = 1; }
  if (anyStem(lower, COMPANY_SECTOR_WORDS)) { score += 0.2; signals.sector = 1; }

  // E-POSTA DOMAİNİYLE EŞLEŞME — çok güçlü sinyal
  if (emailDomainCore && domainMatchesCompany(text, emailDomainCore)) {
    score += 0.4; signals.domain = 1;
  }
  if (fontRatio(line, m) >= THRESHOLDS.largeFontRatio) { score += 0.12; signals.bigFont = 1; }
  if (isTopRegion(line, m)) score += 0.05;
  if (isMostlyCaps(text)) { score += 0.08; signals.caps = 1; }
  const words = text.split(/\s+/).filter(Boolean);
  if (
    words.length === 1 &&
    isTopRegion(line, m) &&
    fontRatio(line, m) >= Math.max(1.5, THRESHOLDS.largeFontRatio + 0.25) &&
    !HAS_DIGIT.test(text)
  ) {
    score += 0.35;
    signals.logoBrand = 1;
  }
  if (anyWord(lower, ADDRESS_KEYWORDS)) score -= 0.15; // adres satırı şirket değil
  return { score: clamp(score), signals };
}

/** Şirket adı ile e-posta domain çekirdeği örtüşüyor mu? */
export function domainMatchesCompany(company: string, domainCore: string): boolean {
  // ASCII-fold: OCR'lı "LİMİT/LIMIT/lımıt" ile domain "limit" güvenle eşleşsin.
  const condensed = asciiFold(company).replace(/[^a-z0-9]/g, "");
  const core = asciiFold(domainCore).replace(/[^a-z0-9]/g, "");
  if (!condensed || core.length < 3) return false;
  if (condensed.includes(core) || core.includes(condensed)) return true;
  // İlk anlamlı şirket token'ı domain çekirdeğinde mi?
  const firstTok = asciiFold(company).split(/\s+/).map((t) => t.replace(/[^a-z0-9]/g, "")).find((t) => t.length >= 3);
  return !!firstTok && core.includes(firstTok);
}

// --- İSİM -------------------------------------------------------------------
export function nameScore(line: LayoutLine, m: LayoutModel): Score {
  const text = line.text.trim();
  const lower = trLower(text);
  const signals: Record<string, number> = {};
  if (HAS_DIGIT.test(text) || /@/.test(text)) return { score: 0, signals };
  if (hasTitleKw(lower) || anyWord(lower, COMPANY_LEGAL_SUFFIXES) ||
      anyStem(lower, COMPANY_SECTOR_WORDS) || anyWord(lower, ADDRESS_KEYWORDS)) {
    return { score: 0, signals };
  }
  // Ön-ekleri (Dr., Prof.) ayıkla, gerçek isim sözcüklerini say
  const rawWords = text.split(/\s+/);
  const words = rawWords.filter((w) => !TITLE_PREFIXES.includes(trLower(w).replace(/\.$/, "")));
  if (words.length < THRESHOLDS.nameMinWords || words.length > THRESHOLDS.nameMaxWords) {
    return { score: 0, signals };
  }
  let score = 0;
  const capWords = words.filter((w) => isCapWord(w) || isMostlyCaps(w));
  const capRatio = capWords.length / words.length;
  score += capRatio * 0.5;
  signals.capRatio = Number(capRatio.toFixed(2));

  if (isTopRegion(line, m)) { score += 0.12; signals.top = 1; }
  if (fontRatio(line, m) >= THRESHOLDS.largeFontRatio) { score += 0.12; signals.bigFont = 1; }

  const tokens = words.map((w) => trLower(w).replace(/[^a-zğüşıöç]/gi, ""));
  if (tokens.some((t) => TR_COMMON_NAMES.includes(t))) { score += 0.18; signals.knownName = 1; }
  if (tokens.some((t) => TR_COMMON_SURNAMES.includes(t))) { score += 0.12; signals.knownSurname = 1; }
  return { score: clamp(score), signals };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}
