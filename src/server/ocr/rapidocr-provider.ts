/**
 * ocr/rapidocr-provider.ts — RapidOCR tabanlı OcrProvider (Gemini'nin yerine).
 *
 * Akış: sidecar OCR → layout (kutu→satır→blok) → çıkarıcılar → çok-sinyalli
 * skorlama → çapraz doğrulama → ParsedCard. QR/vCard varsa alanlar DOĞRUDAN
 * oradan alınır (yapısal, %100 güvenilir) ve OCR ile çapraz doğrulanır.
 *
 * Model sidecar'da BİR KEZ yüklenir (singleton); bu istemci sadece HTTP çağırır.
 */

import type { OcrProvider, OcrInput } from "../parser";
import type { ParsedCard, FieldHit, QrPayload, FieldName, OcrResult } from "../schema";
import { runOcr } from "./rapidocr-client";
import { buildLayout } from "../layout/reconstruct";
import { extractAllFields } from "../scoring";
import { crossValidate } from "../cross-validate";
import { assembleCard } from "../assemble";
import { makeHit } from "../extractors/util";

function emptyCard(provider: string, warnings: string[]): ParsedCard {
  return {
    full_name: "", title: "", company: "", department: "", email: "", phone: "",
    mobile_phone: "", website: "", address: "", city: "", country: "", linkedin: "",
    notes: "", confidence_score: 0, fields: [], provider, warnings,
  };
}

/** QR/vCard alanlarını yüksek güvenli (yapısal) hit'lere çevirir. */
function qrToHits(qr: QrPayload): FieldHit[] {
  const hits: FieldHit[] = [];
  for (const [key, value] of Object.entries(qr.fields)) {
    if (!value) continue;
    hits.push(makeHit(key as FieldName, String(value), 0.99,
      { x: 0, y: 0, width: 0, height: 0 }, "qr", { valid: true }));
  }
  return hits;
}

const cmp = (s: string) => s.toLowerCase().replace(/\s+/g, "");

export class RapidOcrProvider implements OcrProvider {
  readonly name = "rapidocr";

  isReady(): boolean {
    return true; // yapılandırma env ile; bağlantı hatası extract'ta net döner
  }

  async extract(input: OcrInput): Promise<ParsedCard> {
    const t0 = Date.now();
    const ocr: OcrResult = await runOcr(input.base64, input.mimeType);
    const warnings: string[] = [...(ocr.warnings || [])];

    if (!ocr.boxes.length && !ocr.qr) {
      return emptyCard("rapidocr", [
        ...warnings,
        "Görselde okunabilir metin veya QR bulunamadı (çok düşük kalite olabilir). Daha net bir görsel önerilir.",
      ]);
    }

    // 1) Layout + OCR tabanlı çıkarım
    const layout = buildLayout(ocr.boxes, ocr.imageWidth, ocr.imageHeight);
    const extracted = extractAllFields(layout);
    let hits = extracted.hits;

    // 2) QR kısa yolu — yapısal alanlar OCR'ı ezer; çelişki işaretlenir
    if (ocr.qr?.fields && Object.keys(ocr.qr.fields).length) {
      const qrHits = qrToHits(ocr.qr);
      for (const qh of qrHits) {
        const oh = extracted.hits.find((h) => h.field_name === qh.field_name);
        if (oh && oh.value && cmp(oh.value) !== cmp(qh.value)) {
          warnings.push(`QR ve OCR '${qh.field_name}' için farklı değer verdi; QR (yapısal) tercih edildi.`);
        }
      }
      hits = [...extracted.hits, ...qrHits]; // assemble en yüksek güveni (QR) seçer
    }

    // 3) Çapraz doğrulama + birleştirme
    const xv = crossValidate(hits);
    const card = assembleCard(
      xv.hits,
      extracted.notes,
      [...warnings, ...extracted.warnings, ...xv.warnings],
      "rapidocr"
    );

    const totalMs = Date.now() - t0;
    console.log(`[RAPIDOCR] ${totalMs}ms (alan: ${card.fields.length}, güven: ${card.confidence_score})`, ocr.timings || {});
    return card;
  }
}
