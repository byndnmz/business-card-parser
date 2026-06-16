/**
 * assemble.ts — FieldHit listesini KORUNAN ParsedCard şemasına çevirir.
 *
 * Her alan için en yüksek güvenli aday seçilir. needsReview olan alanlar değer
 * olarak tutulur AMA bir uyarı eklenir (server.ts bunu görünce kaydı
 * "manual_review"e yönlendirir = "emin değilsen yanlış basma" ilkesi).
 */

import type { ParsedCard, ParsedField, FieldHit, FieldName } from "./schema";

const TOP_LEVEL: FieldName[] = [
  "full_name", "title", "company", "department", "email", "phone", "mobile_phone",
  "website", "address", "city", "country", "linkedin", "notes",
];

export function assembleCard(
  hits: FieldHit[],
  notes: string[],
  warnings: string[],
  provider: string
): ParsedCard {
  // Alan başına en yüksek güvenli hit
  const best = new Map<string, FieldHit>();
  for (const h of hits) {
    const cur = best.get(h.field_name);
    if (!cur || h.confidence > cur.confidence) best.set(h.field_name, h);
  }

  const fieldList: ParsedField[] = [];
  const reviewWarnings: string[] = [];
  for (const h of best.values()) {
    if (!h.value) continue;
    fieldList.push({
      field_name: h.field_name,
      field_value: h.value,
      confidence_score: h.confidence,
      valid: h.valid,
      bounding_box: h.bbox,
    });
    if (h.needsReview) reviewWarnings.push(`'${h.field_name}' alanı düşük güvenli — incelenmeli (${(h.confidence * 100).toFixed(0)}%).`);
  }

  const val = (n: FieldName) => best.get(n)?.value || "";
  const card: ParsedCard = {
    full_name: val("full_name"),
    title: val("title"),
    company: val("company"),
    department: val("department"),
    email: val("email"),
    phone: val("phone"),
    mobile_phone: val("mobile_phone"),
    website: val("website"),
    address: val("address"),
    city: val("city"),
    country: val("country"),
    linkedin: val("linkedin"),
    notes: notes.length ? notes.join("; ") : "",
    confidence_score: fieldList.length
      ? Number((fieldList.reduce((a, f) => a + f.confidence_score, 0) / fieldList.length).toFixed(3))
      : 0,
    fields: fieldList,
    provider,
    warnings: [...warnings, ...reviewWarnings],
  };
  return card;
}
