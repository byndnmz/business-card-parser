/**
 * ocr/qr-merge.ts — QR/vCard verisini OCR ile birleştirme (saf, test edilebilir).
 *
 * İLKE: Karttaki YAZILI metin (OCR) esastır. QR şu rollerde kullanılır:
 *   - OCR'ın BULAMADIĞI alanları doldurur (boşluk doldurma),
 *   - OCR ile çelişen bir alan varsa karttaki yazı tercih edilir (QR not düşülür),
 *   - QR FARKLI bir kişiye aitse (şablon/yanlış gömülmüş vCard) TAMAMEN yok sayılır.
 *
 * Sebep: QR'lar bazen şablon/yanlış kişi içerir (ör. kartta "Damla Reçber" yazar
 * ama QR "Ece Saral"). Kör QR tercihi yanlış kimlik basar; bu önlenir.
 */

import type { FieldHit, QrPayload, FieldName } from "../schema";
import { makeHit, asciiFold } from "../extractors/util";

const cmp = (s: string) => asciiFold(s).replace(/\s+/g, "");

function nameTokens(s: string): string[] {
  return asciiFold(s).replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length >= 2);
}

/** İki isim hiç ortak sözcük paylaşmıyorsa farklı kimlik sayılır. */
export function identityConflict(ocrName: string, qrName: string): boolean {
  const a = new Set(nameTokens(ocrName));
  const b = nameTokens(qrName);
  if (!a.size || !b.length) return false;
  return !b.some((t) => a.has(t));
}

function qrToHits(qr: QrPayload): FieldHit[] {
  const hits: FieldHit[] = [];
  for (const [key, value] of Object.entries(qr.fields)) {
    if (!value) continue;
    hits.push(makeHit(key as FieldName, String(value), 0.95,
      { x: 0, y: 0, width: 0, height: 0 }, "qr", { valid: true }));
  }
  return hits;
}

export interface QrMergeResult {
  hits: FieldHit[];
  warnings: string[];
  qrIgnored: boolean;
}

export function mergeQrWithOcr(ocrHits: FieldHit[], qr: QrPayload | null | undefined): QrMergeResult {
  if (!qr || !qr.fields || !Object.keys(qr.fields).length) {
    return { hits: ocrHits, warnings: [], qrIgnored: false };
  }
  const warnings: string[] = [];
  const ocrName = ocrHits.find((h) => h.field_name === "full_name" && h.value)?.value || "";
  const qrName = qr.fields.full_name || "";

  // QR farklı bir kişiye ait → tamamen yok say, karttaki yazıyı kullan.
  if (ocrName && qrName && identityConflict(ocrName, qrName)) {
    warnings.push(
      `Karttaki QR farklı bir kişiye ait görünüyor ("${qrName}"); karttaki YAZILI bilgiler esas alındı, QR yok sayıldı.`
    );
    return { hits: ocrHits, warnings, qrIgnored: true };
  }

  // QR güvenilir: yalnızca eksik alanları doldur; çakışmada karttaki yazıyı koru.
  const toAdd: FieldHit[] = [];
  for (const qh of qrToHits(qr)) {
    const oh = ocrHits.find((h) => h.field_name === qh.field_name && h.value);
    if (!oh) {
      toAdd.push(qh);
    } else if (cmp(oh.value) !== cmp(qh.value)) {
      warnings.push(`QR'da farklı '${qh.field_name}' var ("${qh.value}"); karttaki yazı tercih edildi.`);
    }
  }
  return { hits: [...ocrHits, ...toAdd], warnings, qrIgnored: false };
}
