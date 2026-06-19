/**
 * scoring.ts — Alan ATAMA orkestratörü.
 *
 * 1) Deterministik çıkarıcıları çalıştırır (email/phone/url/adres/sosyal/vkn).
 * 2) Bu satırları semantik adaylardan DIŞLAR.
 * 3) Kalan satırları unvan/departman/şirket/isim için skorlar.
 * 4) Konum sinyalleriyle (isim, unvanın hemen üstündedir) ve eşik baskılamayla
 *    (emin değilse BASMA) en iyi atamayı yapar.
 *
 * Çıktı: FieldHit[] (değer + güven + kaynak bbox) — parser bunları ParsedCard'a çevirir.
 */

import type { LayoutModel, LayoutLine, FieldHit, BoundingBox } from "./schema";
import { THRESHOLDS } from "./config/thresholds";
import { ADDRESS_KEYWORDS, COMPANY_SECTOR_WORDS } from "./config/dictionaries";
import { trLower, asciiFold, makeHit, lineBox, subBox, containsWord, isCapWord, isMostlyCaps } from "./extractors/util";
import { toPercentBox } from "./layout/reconstruct";
import { extractEmail } from "./extractors/email";
import { extractPhones } from "./extractors/phone";
import { extractUrl } from "./extractors/url";
import { extractAddress } from "./extractors/address";
import { extractSocial } from "./extractors/social";
import { extractVkn } from "./extractors/vkn";
import { titleScore, departmentScore, companyScore, nameScore } from "./extractors/semantic";

const EMAIL_LINE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}|\(at\)|\s©\s/i;
const URL_LINE = /(?:https?:\/\/|www\.)\S+|\b[A-Za-z0-9\-]+\.(?:com|net|org|gov|edu|tr|io|mss)(?:\.[a-z]{2,})?\b/i;
const PHONE_LINE = /(?:\+?\d[\d\s().\-\/]{7,}\d)/;

const FREE_MAIL = new Set(["gmail", "hotmail", "outlook", "yahoo", "icloud", "yandex", "protonmail", "live", "msn"]);

interface Cand { i: number; line: LayoutLine; score: number; signals: Record<string, number>; }

export interface ExtractionOutput {
  hits: FieldHit[];
  notes: string[];
  warnings: string[];
}

function deriveDomainCore(emailHits: FieldHit[]): string | undefined {
  const email = emailHits[0]?.value;
  if (!email || !email.includes("@")) return undefined;
  const domain = email.split("@")[1] || "";
  const core = domain.split(".")[0] || "";
  if (!core || FREE_MAIL.has(core.toLowerCase())) return undefined;
  return core;
}

function isDeterministicLine(line: LayoutLine): boolean {
  const t = line.text;
  if (EMAIL_LINE.test(t)) return true;
  if (URL_LINE.test(t)) return true;
  if (PHONE_LINE.test(t) && t.replace(/\D/g, "").length >= 10) return true;
  const lower = trLower(t);
  if (ADDRESS_KEYWORDS.some((k) => containsWord(lower, k))) return true;
  return false;
}

function pickBest(cands: Cand[], assigned: Set<number>, threshold: number): Cand | null {
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  for (const c of sorted) {
    if (assigned.has(c.i)) continue;
    if (c.score < threshold) return null;
    assigned.add(c.i);
    return c;
  }
  return null;
}

function normalizeTitleValue(value: string): string {
  return value
    .replace(/\u014d/g, "\u00f6")
    .replace(/\u014c/g, "\u00d6")
    .replace(/\bB\$k\.?/gi, "B\u015fk.");
}

const INLINE_TITLE_RE = /\b((?:genel\s+)?(?:koordinat[o\u00f6\u014d]r|m[u\u00fc]d[u\u00fc]r|direkt[o\u00f6]r|uzman|m[u\u00fc]hendis|lider|developer|manager|specialist|ceo|cto|cfo|coo|sales|sat[iı\u0131]s|general|brigadier\s+general|chair|prof\.?|associate\s+prof\.?|assoc\.?\s+prof\.?))\b/i;
const ACADEMIC_NAME_RE = /(?:chair,?\s*)?(?:(?:assoc\.?|associate)\s*)?prof\.?\s*(?:dr\.?\s*)?([A-Z\u00c7\u011e\u0130\u00d6\u015e\u00dc][A-Za-z\u00c7\u011e\u0130\u00d6\u015e\u00dc\u00e7\u011f\u0131\u00f6\u015f\u00fc'.-]+\s+[A-Z\u00c7\u011e\u0130\u00d6\u015e\u00dc][A-Za-z\u00c7\u011e\u0130\u00d6\u015e\u00dc\u00e7\u011f\u0131\u00f6\u015f\u00fc'.-]+)/i;

function likelyNameWord(word: string): boolean {
  const cleaned = word.replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, "");
  if (!cleaned) return false;
  return isCapWord(cleaned) || isMostlyCaps(cleaned) || /^(Dr|Prof|Do[c\u00e7]|Av|M[u\u00fc]h)\.?$/i.test(cleaned);
}

function inlineNameTitle(line: LayoutLine): { name?: string; title?: string; titleRaw?: string } | null {
  const match = line.text.match(INLINE_TITLE_RE);
  if (!match || match.index === undefined) return null;

  const before = line.text.slice(0, match.index).trim();
  const titleRaw = match[1].trim();
  const words = before.split(/\s+/).filter(Boolean);
  const picked: string[] = [];
  for (let i = words.length - 1; i >= 0; i--) {
    if (!likelyNameWord(words[i])) break;
    picked.unshift(words[i].replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, ""));
    if (picked.length >= THRESHOLDS.nameMaxWords) break;
  }
  let name = picked.length >= THRESHOLDS.nameMinWords ? picked.join(" ") : "";
  if (!name) {
    const academicName = line.text.match(ACADEMIC_NAME_RE)?.[1]?.trim();
    if (academicName) name = academicName;
  }
  if (!name && !titleRaw) return null;
  return { name, title: normalizeTitleValue(titleRaw), titleRaw };
}

const COMPANY_CONTINUATIONS = [
  { core: "tech", display: "TECH" },
  { core: "technology", display: "TECHNOLOGY" },
  { core: "technologies", display: "TECHNOLOGIES" },
  { core: "systems", display: "SYSTEMS" },
  { core: "solutions", display: "SOLUTIONS" },
  { core: "software", display: "SOFTWARE" },
  { core: "engineering", display: "ENGINEERING" },
  { core: "industries", display: "INDUSTRIES" },
  { core: "defense", display: "DEFENSE" },
  { core: "defence", display: "DEFENCE" },
  { core: "aerospace", display: "AEROSPACE" },
];

const COMPANY_SECTOR_CORES = new Set(
  [...COMPANY_SECTOR_WORDS, ...COMPANY_CONTINUATIONS.map((c) => c.core)]
    .map((word) => asciiFold(word).replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
);

function compactLetterSpaced(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 4 && words.every((word) => /^[A-Za-zÇĞİÖŞÜçğıöşü]$/.test(word))) {
    return words.join("");
  }
  return text.trim().replace(/\s+/g, " ");
}

function normalizeCompanyText(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => {
      const core = companyCore(token);
      if (core === "echnology") return "TECHNOLOGY";
      if (core === "echnologies") return "TECHNOLOGIES";
      return token;
    })
    .join(" ")
    .replace(/\s+/g, " ");
}

function companyCore(text: string): string {
  return asciiFold(compactLetterSpaced(text)).replace(/[^a-z0-9]/g, "");
}

function canonicalCompanyContinuation(text: string): string | null {
  const compact = compactLetterSpaced(text);
  const core = companyCore(compact);
  if (!core || core.length < 4) return null;

  const known = COMPANY_CONTINUATIONS.find((entry) =>
    core === entry.core ||
    (entry.core.endsWith(core) && core.length >= 6 && entry.core.length - core.length <= 2)
  );
  if (known) return known.display;

  if (COMPANY_SECTOR_CORES.has(core)) return compact;
  return null;
}

function horizontalOverlapRatio(a: LayoutLine, b: LayoutLine): number {
  const left = Math.max(a.bbox.x0, b.bbox.x0);
  const right = Math.min(a.bbox.x1, b.bbox.x1);
  const overlap = Math.max(0, right - left);
  const minWidth = Math.max(1, Math.min(a.bbox.x1 - a.bbox.x0, b.bbox.x1 - b.bbox.x0));
  return overlap / minWidth;
}

function isCompanyContinuation(base: LayoutLine, candidate: LayoutLine, m: LayoutModel): boolean {
  if (isDeterministicLine(candidate)) return false;
  if (!canonicalCompanyContinuation(candidate.text)) return false;

  const gap = candidate.bbox.y0 - base.bbox.y1;
  const maxGap = Math.max(base.height, m.medianHeight || base.height) * 1.25;
  if (gap < -Math.max(base.height, candidate.height) * 0.45 || gap > maxGap) return false;

  const baseCenter = (base.bbox.x0 + base.bbox.x1) / 2;
  const candidateCenter = (candidate.bbox.x0 + candidate.bbox.x1) / 2;
  const centerDelta = Math.abs(baseCenter - candidateCenter);
  const baseWidth = Math.max(1, base.bbox.x1 - base.bbox.x0);
  return horizontalOverlapRatio(base, candidate) >= 0.3 || centerDelta <= baseWidth * 0.35;
}

function combinedLineBox(lines: LayoutLine[], m: LayoutModel) {
  const useSource = lines.some((line) => line.sourceBbox);
  const boxes = lines.map((line) => useSource ? (line.sourceBbox ?? line.bbox) : line.bbox);
  const x0 = Math.min(...boxes.map((box) => box.x0));
  const y0 = Math.min(...boxes.map((box) => box.y0));
  const x1 = Math.max(...boxes.map((box) => box.x1));
  const y1 = Math.max(...boxes.map((box) => box.y1));
  return toPercentBox(
    { x0, y0, x1, y1 },
    useSource ? (m.sourceImageWidth ?? m.imageWidth) : m.imageWidth,
    useSource ? (m.sourceImageHeight ?? m.imageHeight) : m.imageHeight
  );
}

function expandCompanyCandidate(bestCompany: Cand, assigned: Set<number>, m: LayoutModel): { value: string; conf: number; bbox: BoundingBox; signals: Record<string, number> } {
  const continuationIndexes: number[] = [];
  for (let i = bestCompany.i + 1; i < m.lines.length && i <= bestCompany.i + 3; i++) {
    if (assigned.has(i)) continue;
    if (!isCompanyContinuation(bestCompany.line, m.lines[i], m)) continue;
    continuationIndexes.push(i);
  }

  if (!continuationIndexes.length) {
    return {
      value: normalizeCompanyText(bestCompany.line.text),
      conf: scoreToConf(bestCompany),
      bbox: lineBox(bestCompany.line, m),
      signals: bestCompany.signals,
    };
  }

  const lines = [bestCompany.line, ...continuationIndexes.map((i) => m.lines[i])];
  const continuationText = continuationIndexes
    .map((i) => canonicalCompanyContinuation(m.lines[i].text) || compactLetterSpaced(m.lines[i].text));
  const avgOcr = lines.reduce((sum, line) => sum + (line.confidence || THRESHOLDS.fallbackWordConfidence), 0) / lines.length;
  const conf = Number(Math.min(1, 0.5 * Math.min(1, bestCompany.score + 0.08) + 0.5 * avgOcr).toFixed(3));
  continuationIndexes.forEach((i) => assigned.add(i));

  return {
    value: [bestCompany.line.text, ...continuationText].join(" ").replace(/\s+/g, " ").trim(),
    conf,
    bbox: combinedLineBox(lines, m),
    signals: { ...bestCompany.signals, continuation: continuationIndexes.length },
  };
}

export function extractAllFields(m: LayoutModel): ExtractionOutput {
  const hits: FieldHit[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];

  // --- 1) Deterministik alanlar ---
  const emailHits = extractEmail(m);
  const phoneHits = extractPhones(m);
  const urlHits = extractUrl(m);
  const addrHits = extractAddress(m);
  const social = extractSocial(m);
  const vknHits = extractVkn(m);
  hits.push(...emailHits, ...phoneHits, ...urlHits, ...addrHits, ...social.hits, ...vknHits);
  notes.push(...social.others);

  const emailDomainCore = deriveDomainCore(emailHits);

  // --- 2) Tüketilen satırları işaretle ---
  const consumed = new Set<number>();
  m.lines.forEach((line, i) => { if (isDeterministicLine(line)) consumed.add(i); });

  // --- 3) Semantik adayları skorla ---
  m.lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    const inline = inlineNameTitle(line);
    if (!inline) return;
    const conf = Math.max(0.78, Math.min(0.96, line.confidence || THRESHOLDS.fallbackWordConfidence));
    if (inline.name) {
      hits.push(makeHit("full_name", inline.name, conf, subBox(line, line.text, inline.name, m), "inline:name-title"));
    }
    if (inline.title && inline.titleRaw) {
      hits.push(makeHit("title", inline.title, conf, subBox(line, line.text, inline.titleRaw, m), "inline:name-title"));
    }
    consumed.add(i);
  });

  const titleC: Cand[] = [], deptC: Cand[] = [], companyC: Cand[] = [], nameC: Cand[] = [];
  m.lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    const t = titleScore(line, m); if (t.score > 0) titleC.push({ i, line, score: t.score, signals: t.signals });
    const d = departmentScore(line, m); if (d.score > 0) deptC.push({ i, line, score: d.score, signals: d.signals });
    const c = companyScore(line, m, emailDomainCore); if (c.score > 0) companyC.push({ i, line, score: c.score, signals: c.signals });
    const n = nameScore(line, m); if (n.score > 0) nameC.push({ i, line, score: n.score, signals: n.signals });
  });

  const assigned = new Set<number>();

  // --- 4) Atama: önce unvan (güçlü anahtar), sonra konum-boost'lu isim ---
  const bestTitle = pickBest(titleC, assigned, THRESHOLDS.semanticSuppressBelow);
  if (bestTitle) {
    hits.push(makeHit("title", normalizeTitleValue(bestTitle.line.text), scoreToConf(bestTitle), lineBox(bestTitle.line, m), "title", { signals: bestTitle.signals }));
  }

  // İsim genelde unvanın HEMEN ÜSTÜndedir → o adayı güçlendir.
  if (bestTitle) {
    for (const c of nameC) if (c.i === bestTitle.i - 1) c.score = Math.min(1, c.score + 0.15);
  }
  const bestName = pickBest(nameC, assigned, THRESHOLDS.semanticSuppressBelow);
  if (bestName) {
    hits.push(makeHit("full_name", bestName.line.text, scoreToConf(bestName), lineBox(bestName.line, m), "name", { signals: bestName.signals }));
  }

  const bestCompany = pickBest(companyC, assigned, THRESHOLDS.semanticSuppressBelow);
  if (bestCompany) {
    const company = expandCompanyCandidate(bestCompany, assigned, m);
    hits.push(makeHit("company", company.value, company.conf, company.bbox, "company", { signals: company.signals }));
  }

  const bestDept = pickBest(deptC, assigned, 0.5);
  if (bestDept) {
    hits.push(makeHit("department", bestDept.line.text, scoreToConf(bestDept), lineBox(bestDept.line, m), "department", { signals: bestDept.signals }));
  }

  // --- Baskılama uyarıları (emin değilse sustur + sebep) ---
  if (!bestName) warnings.push("Ad/Soyad yeterli güvenle ayrıştırılamadı — manuel kontrol önerilir.");
  if (!bestCompany) warnings.push("Şirket yeterli güvenle ayrıştırılamadı.");

  const finalWarnings = warnings.filter((warning) => {
    const folded = asciiFold(warning);
    if (hits.some((h) => h.field_name === "full_name") && folded.includes("ad/soyad")) return false;
    if (hits.some((h) => h.field_name === "company") && folded.includes("sirket")) return false;
    return true;
  });

  return { hits, notes, warnings: finalWarnings };
}

/** Skoru (0..1) güven skoruna çevirir; tabanı korur. */
function scoreToConf(c: Cand): number {
  // OCR kutu güveni ile sinyal skorunu harmanla
  const ocr = c.line.confidence || THRESHOLDS.fallbackWordConfidence;
  return Number((0.5 * c.score + 0.5 * ocr).toFixed(3));
}
