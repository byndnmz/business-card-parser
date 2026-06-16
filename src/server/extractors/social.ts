/**
 * extractors/social.ts — LinkedIn ve diğer sosyal medya hesapları.
 *
 * Şemada yalnızca `linkedin` alanı olduğundan FieldHit olarak o üretilir;
 * diğer sosyal hesaplar (twitter/x, instagram...) tespit edilir ve orkestratöre
 * "notes" ipucu olarak döndürülmek üzere ayrı liste hâlinde sunulur.
 */

import type { LayoutModel, FieldHit } from "../schema";
import { THRESHOLDS } from "../config/thresholds";
import { SOCIAL_DOMAINS } from "../config/dictionaries";
import { makeHit, subBox } from "./util";

export interface SocialResult {
  hits: FieldHit[];
  others: string[]; // linkedin dışı hesaplar (notes'a eklenebilir)
}

export function extractSocial(m: LayoutModel): SocialResult {
  const hits: FieldHit[] = [];
  const others: string[] = [];

  for (const def of SOCIAL_DOMAINS) {
    for (const line of m.lines) {
      const match = line.text.match(def.path);
      if (!match) continue;
      const value = match[0].replace(/^https?:\/\//i, "").toLowerCase();
      if (def.key === "linkedin") {
        hits.push(makeHit("linkedin", value, THRESHOLDS.deterministicConfidence,
          subBox(line, line.text, match[0], m), "social:linkedin"));
      } else {
        others.push(`${def.key}: ${value}`);
      }
      break; // her platformdan ilk eşleşme yeter
    }
  }
  return { hits, others };
}
