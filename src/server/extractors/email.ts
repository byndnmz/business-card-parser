/**
 * extractors/email.ts — E-posta çıkarıcı: sağlam regex + OCR hatası toleransı.
 *
 * Tesseract/RapidOCR '@' işaretini sık yanlış okur (boşluk, ©, ®, (at), <, {).
 * Bu durumlar kurtarılır ama kurtarılan değer DÜŞÜK güvenle işaretlenir.
 */

import type { LayoutModel, FieldHit } from "../schema";
import { THRESHOLDS } from "../config/thresholds";
import { makeHit, subBox, findInLines } from "./util";

const STRICT = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
// '@' yerine boşluk/sembol; "ahmet (at) domain", "ahmet © domain.com"
const LOOSE = /([A-Za-z0-9._%+\-]{2,})\s*(?:\(?\s*at\s*\)?|[＠©®(<{*]{1,2})\s*([A-Za-z0-9.\-]+\.[A-Za-z]{2,})/i;

function normalizeStrictEmail(raw: string, lineText: string): string {
  let value = raw.toLowerCase().replace(/\s+/g, "");
  const rawIndex = lineText.toLowerCase().indexOf(raw.toLowerCase());
  const linePrefix = rawIndex >= 0 ? lineText.slice(0, rawIndex) : "";
  const local = value.split("@")[0] || "";
  if (/^e[a-z]\./.test(local) && linePrefix.trim() === "") {
    const stripped = value.slice(1);
    if (STRICT.test(stripped)) value = stripped;
  }
  return value;
}

export function extractEmail(m: LayoutModel): FieldHit[] {
  // 1) Doğrudan eşleşme (yüksek güven)
  const direct = findInLines(m, STRICT);
  if (direct) {
    const value = normalizeStrictEmail(direct.match[0], direct.line.text);
    return [
      makeHit("email", value, THRESHOLDS.deterministicConfidence,
        subBox(direct.line, direct.line.text, direct.match[0], m), "email:strict", { valid: true }),
    ];
  }

  // 2) OCR-toleranslı kurtarma (düşük güven → incelenmeli)
  const loose = findInLines(m, LOOSE);
  if (loose) {
    const local = loose.match[1].replace(/\s+/g, "");
    const domain = loose.match[2].replace(/\s+/g, "");
    if (!/^www\.?$/i.test(local)) {
      const value = `${local}@${domain}`.toLowerCase();
      return [
        makeHit("email", value, 0.55,
          subBox(loose.line, loose.line.text, loose.match[0], m), "email:loose",
          { valid: STRICT.test(value), signals: { recovered: 1 } }),
      ];
    }
  }
  return [];
}
