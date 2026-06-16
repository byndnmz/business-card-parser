/**
 * extractors/vkn.ts — Vergi Kimlik Numarası (VKN, 10 hane).
 *
 * Telefon numaralarıyla karışmaması için: ya VKN bağlam sözcüğü (vergi no, VKN,
 * v.d. ...) aynı satırda olmalı, YA DA token tam 10 hane ve '+' / 11+ haneli bir
 * telefon parçası olmamalı. Emin değilse üretmez (yanlış basmama).
 */

import type { LayoutModel, FieldHit } from "../schema";
import { VKN_CONTEXT } from "../config/dictionaries";
import { makeHit, subBox } from "./util";

const TEN_DIGITS = /\b(\d{10})\b/;

export function extractVkn(m: LayoutModel): FieldHit[] {
  for (const line of m.lines) {
    const lower = line.text.toLowerCase();
    const hasContext = VKN_CONTEXT.some((c) => lower.includes(c));
    const match = line.text.match(TEN_DIGITS);
    if (!match) continue;

    // '+' veya 11+ hane bitişikse telefon olabilir → atla (bağlam yoksa).
    const around = line.text;
    const looksLikePhone = /\+\d|\d{11,}/.test(around.replace(/[\s().\-]/g, ""));

    if (hasContext || (!looksLikePhone && /^\d{10}$/.test(line.text.replace(/[^\d]/g, "")))) {
      const value = match[1];
      const conf = hasContext ? 0.9 : 0.6;
      return [makeHit("tax_info", value, conf, subBox(line, line.text, match[1], m), "vkn",
        { signals: { hasContext: hasContext ? 1 : 0 } })];
    }
  }
  return [];
}
