/**
 * test-ocr.ts — GERÇEK OCR çalıştırıcı. Bir kartvizit görselini parser motorundan
 * geçirir ve çıkarılan alanları yazdırır.
 *
 * Kullanım:
 *   GEMINI_API_KEY=... npx tsx tools/test-ocr.ts <görsel-yolu>
 *   (örn:  GEMINI_API_KEY=xxx npx tsx tools/test-ocr.ts ./kart.jpg )
 *
 * Varsayılan sağlayıcı Gemini'dir. Tesseract şimdilik kapalıdır; yeniden denemek
 * için: OCR_PROVIDER=tesseract TESSERACT_ENABLED=true npx tsx tools/test-ocr.ts <görsel>
 */
import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"] });
import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { parseBusinessCard } from "../src/server/parser";
import { checkUpload } from "../src/server/security";

async function main() {
  const imgPath = process.argv[2];
  const hasKey = !!process.env.GEMINI_API_KEY;

  console.log("=== B-CIP OCR Test ===");
  console.log("GEMINI_API_KEY:", hasKey ? "VAR (gemini kullanılabilir)" : "YOK (Gemini için anahtar gerekli)");
  console.log("OCR_PROVIDER  :", process.env.OCR_PROVIDER || "gemini");
  console.log("Model         :", process.env.GEMINI_MODEL || "gemini-2.5-flash");

  if (!imgPath) {
    console.log("\nKullanım: npx tsx tools/test-ocr.ts <görsel-yolu>");
    console.log("Görsel verilmedi — yalnızca mock çıktısı gösteriliyor.\n");
  }

  let base64 = "";
  let mime = "image/jpeg";
  if (imgPath) {
    if (!fs.existsSync(imgPath)) { console.error("Dosya bulunamadı:", imgPath); process.exit(1); }
    base64 = fs.readFileSync(imgPath).toString("base64");
    const ext = path.extname(imgPath).toLowerCase();
    mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".pdf" ? "application/pdf" : "image/jpeg";
    const check = checkUpload(base64);
    if (!check.ok) { console.error("Dosya güvenlik kontrolü başarısız:", check.error); process.exit(1); }
    console.log("Dosya         :", imgPath, `(${Math.round(check.sizeBytes / 1024)} KB, imza: ${check.detectedType})`);
    mime = check.detectedType || mime;
  } else {
    // Görsel yoksa parser yine de mock döndürür (görseli okumadan).
    base64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]).toString("base64");
  }

  const ai = hasKey ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }) : null;

  console.log("\nAyrıştırılıyor...\n");
  const t0 = Date.now();
  const result = await parseBusinessCard(ai, { base64, mimeType: mime });
  const ms = Date.now() - t0;

  console.log("--- SONUÇ ---");
  console.log("Sağlayıcı     :", result.provider, result.provider === "mock-fallback" ? "  ⚠️  (GERÇEK OCR DEĞİL — GEMINI_API_KEY ayarlayın)" : "  ✅");
  console.log("Süre          :", ms, "ms");
  console.log("Genel güven   :", result.confidence_score);
  console.log("Ad Soyad      :", result.full_name);
  console.log("Ünvan         :", result.title);
  console.log("Şirket        :", result.company);
  console.log("E-posta       :", result.email);
  console.log("Telefon       :", result.phone);
  console.log("Web           :", result.website);
  console.log("Adres         :", result.address, `(${result.city}/${result.country})`);
  if (result.warnings.length) console.log("Uyarılar      :", result.warnings.join(" | "));
  console.log("\nAlanlar (bounding box %):");
  for (const f of result.fields) {
    console.log(`  - ${f.field_name.padEnd(14)} "${f.field_value}"  [güven ${f.confidence_score}, ${f.valid ? "geçerli" : "GEÇERSİZ"}]  box(${f.bounding_box.x},${f.bounding_box.y},${f.bounding_box.width}x${f.bounding_box.height})`);
  }
  console.log("");
}

main().catch((e) => { console.error("Hata:", e); process.exit(1); });
