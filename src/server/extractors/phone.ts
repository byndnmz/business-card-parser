/**
 * extractors/phone.ts — Telefon çıkarıcı. libphonenumber-js (region TR) ile parse
 * + E.164 normalize. Cep / sabit / faks ayrımı; birden fazla numara desteği.
 *
 * Faks numarası ASLA telefon/cep alanına yazılmaz (yanlış basmama ilkesi);
 * şemada faks alanı yoktur, bu yüzden tanınır ama ana alanlara atanmaz.
 */

import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { LayoutModel, LayoutLine, FieldHit } from "../schema";
import { THRESHOLDS } from "../config/thresholds";
import { makeHit, subBox } from "./util";

const CAND = /(?:\+?\d[\d\s().\-\/]{7,}\d)/g;
const FAX_LABEL = /\b(faks|fax|f\s*:|fx)\b/i;
const MOBILE_LABEL = /\b(gsm|cep|mobil|mobile|cell)\b/i;

type Kind = "mobile" | "fax" | "fixed";

function cleanOcrPhone(raw: string): string {
  let s = raw.replace(/[^\d+]/g, "");
  // OCR kurtarma: '+' sık '4' okunur ("+90" -> "490").
  if (/^4(90\d{9,11})$/.test(s)) s = "+" + s.slice(1);
  if (s.startsWith("00")) s = "+" + s.slice(2);
  return s;
}

export function extractPhones(m: LayoutModel): FieldHit[] {
  type Found = { line: LayoutLine; raw: string; e164: string; kind: Kind; conf: number };
  const found: Found[] = [];

  for (const line of m.lines) {
    // Yeni RegExp: aynı y'de iki numara tek satıra düşse bile etiketi NUMARANIN
    // hemen ÖNÜNDEKİ pencereyle ilişkilendirebilmek için index gerekir.
    const re = new RegExp(CAND.source, "g");
    let mt: RegExpExecArray | null;
    while ((mt = re.exec(line.text)) !== null) {
      const raw = mt[0];
      const cleaned = cleanOcrPhone(raw);
      if (cleaned.replace(/\D/g, "").length < 10) continue;
      const pn = parsePhoneNumberFromString(cleaned, "TR");
      if (!pn || !pn.isValid()) continue;
      const national = pn.nationalNumber || "";
      // Etiketi SADECE numaranın hemen önündeki ~12 karakterden oku (satırın
      // tamamından değil) — yan yana sabit+cep karışmasını önler.
      const window = line.text.slice(Math.max(0, mt.index - 12), mt.index);
      const typeMobile = (pn.getType?.() || "").includes("MOBILE") || national.startsWith("5");
      const kind: Kind = FAX_LABEL.test(window)
        ? "fax"
        : MOBILE_LABEL.test(window) || typeMobile
        ? "mobile"
        : "fixed";
      if (found.some((f) => f.e164 === pn.number)) continue;
      found.push({ line, raw, e164: pn.number, kind, conf: line.confidence || THRESHOLDS.deterministicConfidence });
    }
  }

  const hits: FieldHit[] = [];
  const mobile = found.find((f) => f.kind === "mobile");
  const fixed = found.find((f) => f.kind === "fixed");
  // Sabit yoksa ve cep dışında bir numara da yoksa: tek numara sabit gibi davranır
  const primary = fixed || found.find((f) => f.kind !== "fax" && f !== mobile) || null;

  if (primary) {
    hits.push(makeHit("phone", primary.e164, THRESHOLDS.deterministicConfidence,
      subBox(primary.line, primary.line.text, primary.raw, m), "phone:fixed"));
  }
  if (mobile && mobile !== primary) {
    hits.push(makeHit("mobile_phone", mobile.e164, THRESHOLDS.deterministicConfidence,
      subBox(mobile.line, mobile.line.text, mobile.raw, m), "phone:mobile"));
  }
  // Faks numaraları bilinçli olarak atanmaz (şemada alan yok, yanlış basma riski).
  return hits;
}
