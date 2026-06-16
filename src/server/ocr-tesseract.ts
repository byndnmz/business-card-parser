/**
 * ocr-tesseract.ts — Self-hosted, API-KEY'SİZ, OFFLINE OCR sağlayıcısı.
 *
 * Görsel SUNUCUDAN ÇIKMAZ (veri egemenliği — savunma sanayii için kritik).
 * tesseract.js (WASM) ile Türkçe+İngilizce metin tanır, GERÇEK kelime kutularından
 * alan bazlı bounding box üretir. Worker tekil olarak cache'lenir.
 *
 * Etkinleştirme:  OCR_PROVIDER=tesseract   (varsayılan diller: tur+eng)
 */

import type { OcrProvider, OcrInput, ParsedCard } from "./parser";
import { extractCardFields, type OcrWord } from "./card-fields";
import { assessQuality, enhanceForOcr } from "./image-preprocess";

let workerPromise: Promise<any> | null = null;

async function getWorker(): Promise<any> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const langs = process.env.TESSERACT_LANGS || "tur+eng";
      console.log(`[TESSERACT] Worker başlatılıyor (diller: ${langs})...`);
      const worker = await createWorker(langs);
      console.log("[TESSERACT] Worker hazır.");
      return worker;
    })();
  }
  return workerPromise;
}

/** tesseract sonucundan (sürümden bağımsız) kelime listesini toplar. */
function collectWords(data: any): OcrWord[] {
  const toWord = (w: any): OcrWord => ({
    text: String(w.text || ""),
    confidence: Number(w.confidence ?? 0),
    bbox: {
      x0: Number(w.bbox?.x0 ?? 0), y0: Number(w.bbox?.y0 ?? 0),
      x1: Number(w.bbox?.x1 ?? 0), y1: Number(w.bbox?.y1 ?? 0),
    },
  });
  if (Array.isArray(data?.words) && data.words.length) return data.words.map(toWord);
  const out: any[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (Array.isArray(node.words)) out.push(...node.words);
    for (const k of ["blocks", "paragraphs", "lines"]) if (node[k]) walk(node[k]);
  };
  walk(data?.blocks || data);
  return out.map(toWord);
}

/** Base64 görsel başlığından (PNG/JPEG) genişlik/yükseklik okur. */
function imageSize(buf: Buffer): { w: number; h: number } {
  // PNG: IHDR @ offset 16 (width), 20 (height) — big-endian
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // JPEG: SOF0..SOF15 markerlarını tara
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue; }
      const marker = buf[off + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) };
      }
      off += 2 + buf.readUInt16BE(off + 2);
    }
  }
  return { w: 0, h: 0 };
}

export class TesseractProvider implements OcrProvider {
  readonly name = "tesseract";
  isReady() {
    return true; // tesseract.js her zaman kullanılabilir (anahtar gerekmez)
  }
  async extract(input: OcrInput): Promise<ParsedCard> {
    const clean = input.base64.startsWith("data:") ? input.base64.split(",")[1] : input.base64;
    const original = Buffer.from(clean, "base64");

    // 1) KALİTE ANALİZİ + OCR için GÖRÜNTÜ İYİLEŞTİRME (kötüyse daha agresif).
    let imgBuf = original;
    let imgW = 0;
    let imgH = 0;
    const qualityWarnings: string[] = [];
    try {
      const q = await assessQuality(original);
      if (q.issues.length) {
        qualityWarnings.push(`Görsel kalite (skor ${q.score}): ${q.issues.join(", ")} — otomatik iyileştirme uygulandı.`);
      }
      const enh = await enhanceForOcr(original, q);
      imgBuf = enh.data;
      imgW = enh.width;
      imgH = enh.height;
    } catch (e) {
      console.error("[TESSERACT] Ön-işleme atlandı (orijinal kullanılacak):", e);
      const s = imageSize(original);
      imgW = s.w;
      imgH = s.h;
    }

    // 2) ÇOK-GEÇİŞLİ OCR — birden çok sayfa-bölütleme modu (PSM) dene, EN YÜKSEK
    //    ortalama güvene sahip sonucu seç. Kartvizitler için 3 (auto) + 11 (sparse).
    const worker = await getWorker();
    const psms = (process.env.TESSERACT_PSM || "3,11").split(",").map((s) => s.trim()).filter(Boolean);
    let best: { text: string; words: OcrWord[]; conf: number } | null = null;
    for (const psm of psms) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: psm as any });
        const r = await worker.recognize(imgBuf, {}, { text: true, blocks: true });
        const words = collectWords(r.data || {});
        const text = String(r.data?.text || "");
        const conf = words.length
          ? words.reduce((a, w) => a + (w.confidence || 0), 0) / words.length
          : Number(r.data?.confidence || 0);
        if (!best || conf > best.conf) best = { text, words, conf };
      } catch (e) {
        console.error(`[TESSERACT] PSM ${psm} hatası:`, e);
      }
    }

    if (!best || !best.text.trim()) {
      return {
        full_name: "", title: "", company: "", department: "", email: "", phone: "",
        mobile_phone: "", website: "", address: "", city: "", country: "", linkedin: "",
        confidence_score: 0, fields: [], provider: "tesseract",
        warnings: [...qualityWarnings, "Görselde okunabilir metin bulunamadı (çok bulanık/düşük çözünürlük). Daha net bir fotoğraf önerilir."],
      };
    }

    const card = extractCardFields(best.text, best.words, imgW, imgH, "tesseract");
    card.warnings = [...qualityWarnings, ...card.warnings];
    return card;
  }
}
