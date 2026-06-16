/**
 * ocr/rapidocr-client.ts — Python RapidOCR sidecar'ına HTTP istemcisi.
 *
 * Sidecar OCR + ağır görüntü işini (OpenCV) yapar; bu istemci yalnızca onu çağırır.
 * Kutular ORİJİNAL görsel koordinat sisteminde döner (sidecar warp/deskew uygularsa
 * ters dönüşümle geri eşler) → frontend overlay'i bozulmaz, şema değişmez.
 *
 * Bağlantı/zaman aşımı hatalarında NET mesaj fırlatır (sessiz çöp üretmez).
 */

import type { OcrResult, OcrBox, QrPayload } from "../schema";
import { THRESHOLDS } from "../config/thresholds";

function baseUrl(): string {
  return (process.env.RAPIDOCR_SERVICE_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
}

function stripDataPrefix(b64: string): string {
  return b64.startsWith("data:") ? b64.split(",")[1] ?? b64 : b64;
}

/** Sidecar sağlık kontrolü (opsiyonel; isReady için). */
export async function pingHealth(timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function runOcr(base64: string, mimeType: string): Promise<OcrResult> {
  const url = `${baseUrl()}/ocr`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), THRESHOLDS.ocrServiceTimeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: stripDataPrefix(base64), mime_type: mimeType }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OCR servisi ${res.status} döndü: ${text.slice(0, 200)}`);
    }
    return normalizeResponse(await res.json());
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(`OCR servisi zaman aşımına uğradı (${THRESHOLDS.ocrServiceTimeoutMs}ms).`);
    }
    if (e?.message?.startsWith("OCR servisi")) throw e;
    throw new Error(
      `OCR servisine ulaşılamadı (${baseUrl()}): ${e?.message || e}. Sidecar çalışıyor mu? (ocr-service/)`
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Python JSON'unu tip güvenli OcrResult'a çevirir. */
function normalizeResponse(data: any): OcrResult {
  const boxes: OcrBox[] = Array.isArray(data?.boxes)
    ? data.boxes.map((b: any): OcrBox => ({
        text: String(b?.text ?? ""),
        confidence: clamp01(Number(b?.confidence ?? 0)),
        bbox: {
          x0: Number(b?.bbox?.x0 ?? 0),
          y0: Number(b?.bbox?.y0 ?? 0),
          x1: Number(b?.bbox?.x1 ?? 0),
          y1: Number(b?.bbox?.y1 ?? 0),
        },
      }))
    : [];

  let qr: QrPayload | null = null;
  if (data?.qr && typeof data.qr === "object") {
    qr = {
      raw: String(data.qr.raw ?? ""),
      format: data.qr.format ?? "text",
      fields: data.qr.fields ?? {},
    };
  }

  return {
    engine: String(data?.engine ?? "rapidocr"),
    boxes,
    imageWidth: Number(data?.image_width ?? 0),
    imageHeight: Number(data?.image_height ?? 0),
    qr,
    processedImageBase64: data?.processed_image_base64 ?? null,
    timings: data?.timings ?? {},
    warnings: Array.isArray(data?.warnings) ? data.warnings.map(String) : [],
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
