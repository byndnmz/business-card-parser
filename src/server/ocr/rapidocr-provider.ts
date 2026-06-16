/**
 * ocr/rapidocr-provider.ts — RapidOCR tabanlı OcrProvider (Gemini'nin yerine).
 *
 * Akış: sidecar OCR → layout (kutu→satır→blok) → çıkarıcılar → çok-sinyalli
 * skorlama → çapraz doğrulama → ParsedCard. QR/vCard varsa: karttaki YAZILI metin
 * ESAS alınır; QR yalnızca eksik alanları doldurur ve farklı kişiye aitse yok
 * sayılır (bkz. qr-merge.ts).
 *
 * Model sidecar'da BİR KEZ yüklenir (singleton); bu istemci sadece HTTP çağırır.
 */

import type { OcrProvider, OcrInput } from "../parser";
import type { ParsedCard, OcrResult } from "../schema";
import { runOcr } from "./rapidocr-client";
import { buildLayout } from "../layout/reconstruct";
import { extractAllFields } from "../scoring";
import { crossValidate } from "../cross-validate";
import { assembleCard } from "../assemble";
import { mergeQrWithOcr } from "./qr-merge";

function emptyCard(provider: string, warnings: string[]): ParsedCard {
  return {
    full_name: "", title: "", company: "", department: "", email: "", phone: "",
    mobile_phone: "", website: "", address: "", city: "", country: "", linkedin: "",
    notes: "", confidence_score: 0, fields: [], provider, warnings,
  };
}

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

    // 2) QR/vCard: karttaki YAZI esas; QR eksikleri doldurur; farklı kişiyse yok sayılır
    const qrMerge = mergeQrWithOcr(extracted.hits, ocr.qr);
    warnings.push(...qrMerge.warnings);

    // 3) Çapraz doğrulama + birleştirme
    const xv = crossValidate(qrMerge.hits);
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
