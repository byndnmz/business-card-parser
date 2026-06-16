/**
 * extractors/address.ts — Adres + şehir + ülke çıkarıcı (TR kalıpları).
 *
 * Mah./Cad./Sok./No/Kat, 5 haneli posta kodu, 81 il sözlüğü kullanılır.
 * Adres satırları birleştirilir; bbox bunların birleşimidir.
 */

import type { LayoutModel, LayoutLine, FieldHit } from "../schema";
import { ADDRESS_KEYWORDS, TR_PROVINCES, TR_DISTRICTS, COUNTRY_TOKENS } from "../config/dictionaries";
import { toPercentBox } from "../layout/reconstruct";
import { makeHit, lineBox } from "./util";

const POSTAL = /\b\d{5}\b/;

function isAddressLine(line: LayoutLine): boolean {
  const lower = line.text.toLowerCase();
  if (ADDRESS_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))) return true;
  if (POSTAL.test(line.text) && TR_PROVINCES.some((p) => new RegExp(`\\b${p}\\b`, "i").test(line.text))) return true;
  return false;
}

export function extractAddress(m: LayoutModel): FieldHit[] {
  const addrLines = m.lines.filter(isAddressLine);
  const flat = m.flatText;
  const hits: FieldHit[] = [];

  if (addrLines.length) {
    const value = addrLines.map((l) => l.text).join(", ").replace(/\s+/g, " ").trim();
    const x0 = Math.min(...addrLines.map((l) => l.bbox.x0));
    const y0 = Math.min(...addrLines.map((l) => l.bbox.y0));
    const x1 = Math.max(...addrLines.map((l) => l.bbox.x1));
    const y1 = Math.max(...addrLines.map((l) => l.bbox.y1));
    const conf = addrLines.reduce((a, l) => a + l.confidence, 0) / addrLines.length;
    hits.push(makeHit("address", value, Math.max(0.6, conf),
      toPercentBox({ x0, y0, x1, y1 }, m.imageWidth, m.imageHeight), "address"));
  }

  // Şehir: önce il, yoksa ilçe→il bağlamı (ilçe varsa düşük güvenle şehir ipucu)
  const province = TR_PROVINCES.find((p) => new RegExp(`\\b${p}\\b`, "i").test(flat));
  if (province) {
    const line = m.lines.find((l) => new RegExp(`\\b${province}\\b`, "i").test(l.text));
    hits.push(makeHit("city", province, 0.8, line ? lineBox(line, m) : { x: 0, y: 0, width: 0, height: 0 }, "city:province"));
  } else {
    const district = TR_DISTRICTS.find((d) => new RegExp(`\\b${d}\\b`, "i").test(flat));
    if (district) {
      const line = m.lines.find((l) => new RegExp(`\\b${district}\\b`, "i").test(l.text));
      hits.push(makeHit("city", district, 0.55, line ? lineBox(line, m) : { x: 0, y: 0, width: 0, height: 0 }, "city:district"));
    }
  }

  const country = COUNTRY_TOKENS.find((c) => c.match.test(flat));
  if (country) {
    hits.push(makeHit("country", country.value, 0.85, { x: 0, y: 0, width: 0, height: 0 }, "country"));
  } else if (province) {
    // İl bulunduysa ülke Türkiye varsayılır (düşük-orta güven).
    hits.push(makeHit("country", "Türkiye", 0.6, { x: 0, y: 0, width: 0, height: 0 }, "country:inferred"));
  }
  return hits;
}
