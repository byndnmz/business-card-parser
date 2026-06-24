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
const EMAIL_FRAGMENT_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/gi;
const URL_FRAGMENT_RE = /(?:https?:\/\/|www\.)\S+|\b[A-Za-z0-9\-]+\.(?:com|net|org|gov|edu|tr|io|mss)(?:\.[a-z]{2,})?\b/gi;
const PHONE_FRAGMENT_RE = /(?:\+?\d[\d\s().\-\/]{7,}\d)(?:\s*\((?:tel|fax|gsm|mobile|cep|phone|pbx|santral)[^)]+\))?/gi;

const FREE_MAIL = new Set(["gmail", "hotmail", "outlook", "yahoo", "icloud", "yandex", "protonmail", "live", "msn"]);

interface Cand { i: number; line: LayoutLine; score: number; signals: Record<string, number>; }

export interface ExtractionOutput {
  hits: FieldHit[];
  notes: string[];
  warnings: string[];
}

function coreFromHost(value: string): string | undefined {
  const host = value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0] || "";
  const core = host.split(".")[0] || "";
  if (!core || FREE_MAIL.has(core.toLowerCase())) return undefined;
  return core;
}

function deriveDomainCore(emailHits: FieldHit[], urlHits: FieldHit[]): string | undefined {
  for (const emailHit of emailHits) {
    const domain = emailHit.value.includes("@") ? emailHit.value.split("@")[1] : "";
    const core = coreFromHost(domain);
    if (core) return core;
  }
  for (const urlHit of urlHits) {
    const core = coreFromHost(urlHit.value);
    if (core) return core;
  }
  return undefined;
}

function emailLocalCores(emailHits: FieldHit[]): string[] {
  return emailHits
    .map((hit) => hit.value.split("@")[0] || "")
    .map((local) => asciiFold(local).toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((local) => local.length >= 4);
}

function personNameCores(value: string): string[] {
  return value
    .split(/\s+/)
    .map((word) => asciiFold(word).toLowerCase().replace(/[^a-z]/g, ""))
    .filter((word) => word.length >= 3);
}

function emailLocalSupportsName(local: string, name: string): boolean {
  const tokens = personNameCores(name);
  if (tokens.length < 2) return false;
  const joined = tokens.join("");
  return local.includes(joined) || tokens.every((token) => local.includes(token)) || joined.includes(local);
}

function boostNamesFromEmail(nameC: Cand[], emailHits: FieldHit[]): void {
  const locals = emailLocalCores(emailHits);
  if (!locals.length) return;
  for (const candidate of nameC) {
    if (!locals.some((local) => emailLocalSupportsName(local, candidate.line.text))) continue;
    candidate.score = Math.min(1, candidate.score + 0.28);
    candidate.signals = { ...candidate.signals, emailLocal: 1 };
  }
}

function looksLikeSingleNamePart(value: string): boolean {
  const word = value.trim();
  if (!word || /\s|@|\d/.test(word)) return false;
  const core = asciiFold(word).toLowerCase().replace(/[^a-z]/g, "");
  if (core.length < 3 || INLINE_NON_NAME_CORES.has(core)) return false;
  return isMostlyCaps(word) || /^[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü'.-]+$/.test(word);
}

function emailLocalSupportsSplitName(emailHits: FieldHit[], baseName: string, namePart: string): boolean {
  const part = personNameCores(namePart)[0] || "";
  if (!part) return false;
  const baseTokens = personNameCores(baseName);
  if (!baseTokens.length) return false;
  return emailLocalCores(emailHits).some((local) =>
    local.includes(part) && baseTokens.some((token) => local.includes(token))
  );
}

function mergedNameLine(base: LayoutLine, part: LayoutLine): LayoutLine {
  const text = `${base.text} ${part.text}`.replace(/\s+/g, " ").trim();
  const bbox = {
    x0: Math.min(base.bbox.x0, part.bbox.x0),
    y0: Math.min(base.bbox.y0, part.bbox.y0),
    x1: Math.max(base.bbox.x1, part.bbox.x1),
    y1: Math.max(base.bbox.y1, part.bbox.y1),
  };
  const sourceBoxes = [base.sourceBbox, part.sourceBbox].filter(Boolean) as NonNullable<LayoutLine["sourceBbox"]>[];
  const sourceBbox = sourceBoxes.length ? {
    x0: Math.min(...sourceBoxes.map((box) => box.x0)),
    y0: Math.min(...sourceBoxes.map((box) => box.y0)),
    x1: Math.max(...sourceBoxes.map((box) => box.x1)),
    y1: Math.max(...sourceBoxes.map((box) => box.y1)),
  } : undefined;
  return {
    ...base,
    text,
    bbox,
    sourceBbox,
    yCenter: (bbox.y0 + bbox.y1) / 2,
    height: Math.max(base.height, part.height),
    confidence: (base.confidence + part.confidence) / 2,
    words: [],
  };
}

function addSplitNameCandidates(nameC: Cand[], parts: Cand[], emailHits: FieldHit[]): void {
  if (!parts.length) return;
  const additions: Cand[] = [];
  for (const base of nameC) {
    if (base.line.text.split(/\s+/).filter(Boolean).length >= THRESHOLDS.nameMaxWords) continue;
    for (const part of parts) {
      if (Math.abs(part.i - base.i) > 1) continue;
      if (!emailLocalSupportsSplitName(emailHits, base.line.text, part.line.text)) continue;
      additions.push({
        i: base.i,
        line: mergedNameLine(base.line, part.line),
        score: Math.min(1, base.score + 0.22),
        signals: { ...base.signals, splitNamePart: 1 },
      });
    }
  }
  nameC.push(...additions);
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

function stripDeterministicFragments(text: string): string {
  return text
    .replace(EMAIL_FRAGMENT_RE, " ")
    .replace(URL_FRAGMENT_RE, " ")
    .replace(PHONE_FRAGMENT_RE, " ")
    .replace(/\b(?:tel|fax|gsm|mobile|cep|phone|pbx|santral)\b/gi, " ")
    .replace(/[()&:|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function institutionTailFromAddress(text: string): string {
  const match = text.match(
    /\b((?:National|Turkish|Military|Defence|Defense|University|Academy|School|College|Institute|Faculty)[A-Za-z&'. -]*(?:University|Academy|School|College|Institute|Faculty))\b/i
  );
  return match?.[1]?.replace(/\s+/g, " ").trim() || "";
}

function semanticResiduesFromConsumedLine(text: string): string[] {
  const deterministicResidue = companyPrefixFromTaxLine(text) ? "" : stripDeterministicFragments(text);
  const residues = [deterministicResidue, institutionTailFromAddress(text)]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 4 && value !== text);
  return [...new Set(residues)];
}

const INLINE_TITLE_RE = /\b((?:genel\s+)?(?:koordinat[o\u00f6\u014d]r|m[u\u00fc]d[u\u00fc]r|direkt[o\u00f6]r|uzman|m[u\u00fc]hendis|lider|developer|manager|specialist|ceo|cto|cfo|coo|sales|sat[iı\u0131]s|general|brigadier\s+general|chair|prof\.?|associate\s+prof\.?|assoc\.?\s+prof\.?))\b/i;
const ACADEMIC_NAME_RE = /(?:chair,?\s*)?(?:(?:assoc\.?|associate)\s*)?prof\.?\s*(?:dr\.?\s*)?([A-Z\u00c7\u011e\u0130\u00d6\u015e\u00dc][A-Za-z\u00c7\u011e\u0130\u00d6\u015e\u00dc\u00e7\u011f\u0131\u00f6\u015f\u00fc'.-]+\s+[A-Z\u00c7\u011e\u0130\u00d6\u015e\u00dc][A-Za-z\u00c7\u011e\u0130\u00d6\u015e\u00dc\u00e7\u011f\u0131\u00f6\u015f\u00fc'.-]+)/i;
const INLINE_NON_NAME_CORES = new Set([
  "project", "assistant", "specialist", "development", "electronic", "electronics",
  "sales", "satis", "manager", "director", "chief", "deputy", "chairman", "board",
  "brigadier", "general", "naval", "architecture", "logistics", "forces", "force",
  "command", "commad", "academy", "university", "school", "college", "institute",
  "faculty", "campus", "military", "cluster", "association", "organization",
  "organisation", "foundation", "defence", "defense", "aviation", "muhendis",
  "mudur", "yonetici", "yonetim", "kurulu", "baskan", "baskani", "başkani",
  "koordinator", "developer", "architect", "domestic", "purchasing", "procurement", "buyer",
]);
const INLINE_TITLE_MODIFIER_CORES = new Set([
  "project", "assistant", "development", "electronic", "electronics", "sales",
  "satis", "senior", "junior", "lead", "yonetim", "kurulu", "baskan", "baskani",
  "domestic", "purchasing", "procurement", "buyer",
]);

function likelyNameWord(word: string): boolean {
  const cleaned = word.replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, "");
  if (!cleaned) return false;
  return isCapWord(cleaned) || isMostlyCaps(cleaned) || /^(Dr|Prof|Do[c\u00e7]|Av|M[u\u00fc]h)\.?$/i.test(cleaned);
}

function inlineNameCore(word: string): string {
  return asciiFold(word).replace(/[^a-z0-9]/g, "");
}

function inlineWordsLookLikePersonName(words: string[]): boolean {
  if (words.length < THRESHOLDS.nameMinWords || words.length > THRESHOLDS.nameMaxWords) return false;
  return words.every(likelyNameWord) && !words.some((word) => INLINE_NON_NAME_CORES.has(inlineNameCore(word)));
}

function cleanInlineWord(word: string): string {
  return word.replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, "");
}

function inlineNameTitle(line: LayoutLine): { name?: string; title?: string; titleRaw?: string } | null {
  const match = line.text.match(INLINE_TITLE_RE);
  if (!match || match.index === undefined) return null;

  const before = line.text.slice(0, match.index).trim();
  const titleRaw = match[1].trim();
  const words = before.split(/\s+/).filter(Boolean).map(cleanInlineWord).filter(Boolean);
  const titlePrefixWords: string[] = [];
  while (words.length && INLINE_TITLE_MODIFIER_CORES.has(inlineNameCore(words[words.length - 1]))) {
    titlePrefixWords.unshift(words.pop()!);
  }
  const picked: string[] = [];
  for (let i = words.length - 1; i >= 0; i--) {
    if (!likelyNameWord(words[i])) break;
    picked.unshift(words[i]);
    if (picked.length >= THRESHOLDS.nameMaxWords) break;
  }
  let name = inlineWordsLookLikePersonName(picked) ? picked.join(" ") : "";
  if (!name) {
    const academicName = line.text.match(ACADEMIC_NAME_RE)?.[1]?.trim();
    if (academicName) name = academicName;
  }
  if (!name && !titleRaw) return null;
  if (!name) {
    return { title: normalizeTitleValue(line.text), titleRaw: line.text };
  }
  const fullTitleRaw = [...titlePrefixWords, titleRaw].join(" ").trim() || titleRaw;
  return { name, title: normalizeTitleValue(fullTitleRaw), titleRaw: fullTitleRaw };
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

function companyPrefixFromTaxLine(text: string): string {
  const folded = asciiFold(text);
  if (!/\b(v\.?\s*d\.?|vergi|tax)\b|\b\d{10,11}\b/.test(folded)) return "";
  let prefix = text
    .split(/\b(?:V\.?\s*D\.?|Vergi|Tax)\b/i)[0]
    .replace(/\/?\s*\b\d{10,11}\b.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!prefix) return "";

  if (/\bV\.?\s*D\.?/i.test(text)) {
    const words = prefix.split(/\s+/).filter(Boolean);
    if (words.length >= 3) prefix = words.slice(0, -1).join(" ");
  }

  const clean = prefix.replace(/[^\p{L}0-9&'. -]+/gu, " ").replace(/\s+/g, " ").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return "";
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(clean)) return "";
  if (EMAIL_LINE.test(clean) || URL_LINE.test(clean) || PHONE_LINE.test(clean)) return "";
  return clean;
}

function findCompanyPrefixLine(bestCompany: Cand, assigned: Set<number>, m: LayoutModel): { i: number; value: string } | null {
  const start = Math.max(0, bestCompany.i - 3);
  const end = Math.min(m.lines.length - 1, bestCompany.i + 3);
  for (let i = start; i <= end; i++) {
    if (i === bestCompany.i || assigned.has(i)) continue;
    const prefix = companyPrefixFromTaxLine(m.lines[i].text);
    if (!prefix) continue;
    if (companyCore(bestCompany.line.text).includes(companyCore(prefix))) continue;
    return { i, value: prefix };
  }
  return null;
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
  const prefix = findCompanyPrefixLine(bestCompany, assigned, m);

  if (!continuationIndexes.length && !prefix) {
    return {
      value: normalizeCompanyText(bestCompany.line.text),
      conf: scoreToConf(bestCompany),
      bbox: lineBox(bestCompany.line, m),
      signals: bestCompany.signals,
    };
  }

  const lines = [
    ...(prefix ? [m.lines[prefix.i]] : []),
    bestCompany.line,
    ...continuationIndexes.map((i) => m.lines[i]),
  ];
  const continuationText = continuationIndexes
    .map((i) => canonicalCompanyContinuation(m.lines[i].text) || compactLetterSpaced(m.lines[i].text));
  const avgOcr = lines.reduce((sum, line) => sum + (line.confidence || THRESHOLDS.fallbackWordConfidence), 0) / lines.length;
  const conf = Number(Math.min(1, 0.5 * Math.min(1, bestCompany.score + 0.08) + 0.5 * avgOcr).toFixed(3));
  continuationIndexes.forEach((i) => assigned.add(i));
  if (prefix) assigned.add(prefix.i);

  return {
    value: [prefix?.value, bestCompany.line.text, ...continuationText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
    conf,
    bbox: combinedLineBox(lines, m),
    signals: { ...bestCompany.signals, continuation: continuationIndexes.length, taxPrefix: prefix ? 1 : 0 },
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

  const emailDomainCore = deriveDomainCore(emailHits, urlHits);

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

  const titleC: Cand[] = [], deptC: Cand[] = [], companyC: Cand[] = [], nameC: Cand[] = [], namePartC: Cand[] = [];
  m.lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    const t = titleScore(line, m); if (t.score > 0) titleC.push({ i, line, score: t.score, signals: t.signals });
    const d = departmentScore(line, m); if (d.score > 0) deptC.push({ i, line, score: d.score, signals: d.signals });
    const c = companyScore(line, m, emailDomainCore); if (c.score > 0) companyC.push({ i, line, score: c.score, signals: c.signals });
    const n = nameScore(line, m); if (n.score > 0) nameC.push({ i, line, score: n.score, signals: n.signals });
  });
  m.lines.forEach((line, i) => {
    if (!consumed.has(i)) return;
    for (const residue of semanticResiduesFromConsumedLine(line.text)) {
      const residueLine: LayoutLine = { ...line, text: residue, words: [] };
      const t = titleScore(residueLine, m);
      if (t.score > 0) titleC.push({ i, line: residueLine, score: Math.min(1, t.score + 0.08), signals: { ...t.signals, residue: 1 } });
      const c = companyScore(residueLine, m, emailDomainCore);
      if (c.score > 0) companyC.push({ i, line: residueLine, score: Math.min(1, c.score + 0.05), signals: { ...c.signals, residue: 1 } });
      const n = nameScore(residueLine, m);
      if (n.score > 0) nameC.push({ i, line: residueLine, score: Math.min(1, n.score + 0.08), signals: { ...n.signals, residue: 1 } });
      if (looksLikeSingleNamePart(residue)) namePartC.push({ i, line: residueLine, score: 0.5, signals: { residue: 1, singleNamePart: 1 } });
    }
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
  boostNamesFromEmail(nameC, emailHits);
  addSplitNameCandidates(nameC, namePartC, emailHits);
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
