/**
 * extractors/url.ts — Web sitesi/URL çıkarıcı. E-posta domaininden AYIRIR.
 *
 * Sosyal medya (linkedin/twitter...) ayrı çıkarıcıya bırakılır; burada yalnızca
 * kurumsal web sitesi hedeflenir. Normalize: protokol/sondaki / kaldırılır.
 */

import type { LayoutModel, FieldHit } from "../schema";
import { THRESHOLDS } from "../config/thresholds";
import { KNOWN_TLDS, SOCIAL_DOMAINS } from "../config/dictionaries";
import { makeHit, subBox } from "./util";

const tldAlt = KNOWN_TLDS.slice().sort((a, b) => b.length - a.length).join("|").replace(/\./g, "\\.");
const URL_RE = new RegExp(
  `\\b((?:https?:\\/\\/)?(?:www\\.)?[A-Za-z0-9\\-]+(?:\\.[A-Za-z0-9\\-]+)*\\.(?:${tldAlt}))(\\/[\\w\\-./?%&=#]*)?\\b`,
  "i"
);

export function normalizeWebsite(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export function extractUrl(m: LayoutModel): FieldHit[] {
  const isSocial = (s: string) => SOCIAL_DOMAINS.some((d) => s.toLowerCase().includes(d.host));

  for (const line of m.lines) {
    const match = line.text.match(URL_RE);
    if (!match) continue;
    const raw = match[1] + (match[2] || "");
    if (raw.includes("@")) continue; // e-posta parçası
    if (isSocial(raw)) continue; // sosyal medya ayrı
    const value = normalizeWebsite(raw);
    // Çok kısa/şüpheli domainleri ele (ör. tek harf)
    if (value.replace(/\..*$/, "").length < 2) continue;
    return [
      makeHit("website", value, THRESHOLDS.deterministicConfidence,
        subBox(line, line.text, match[0], m), "url"),
    ];
  }
  return [];
}
