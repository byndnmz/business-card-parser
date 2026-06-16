/**
 * ocr-selftest.ts — Tesseract OCR + görüntü iyileştirme zincirini SENTETİK bir
 * kartvizit görseliyle uçtan uca doğrular (gerçek metin tanıma).
 *
 * Çalıştır:  npx tsx tools/ocr-selftest.ts
 * (Anahtar gerekmez — tamamen offline Tesseract.)
 */
process.env.OCR_PROVIDER = "tesseract";
process.env.TESSERACT_ENABLED = "true";
import sharpImport from "sharp";
import { parseBusinessCard } from "../src/server/parser";
import { assessQuality } from "../src/server/image-preprocess";

const sharp: any = (sharpImport as any).default || sharpImport;

const CARD_SVG = `
<svg width="1000" height="620" xmlns="http://www.w3.org/2000/svg">
  <rect width="1000" height="620" fill="#ffffff"/>
  <text x="60" y="120" font-family="sans-serif" font-size="48" font-weight="bold" fill="#111111">Ahmet Sadik Sahiner</text>
  <text x="60" y="178" font-family="sans-serif" font-size="32" fill="#333333">Siber Guvenlik Grup Lideri</text>
  <text x="60" y="270" font-family="sans-serif" font-size="36" font-weight="bold" fill="#1e3a8a">LIMIT SAVUNMA TEKNOLOJILERI A.S.</text>
  <text x="60" y="400" font-family="sans-serif" font-size="30" fill="#222222">ahmet@limitsavunma.com.tr</text>
  <text x="60" y="450" font-family="sans-serif" font-size="30" fill="#222222">+90 312 444 88 55</text>
  <text x="60" y="500" font-family="sans-serif" font-size="30" fill="#222222">www.limitsavunma.com.tr</text>
  <text x="60" y="560" font-family="sans-serif" font-size="26" fill="#444444">Savunma Sanayii Vadisi, Blok B, Cankaya / Ankara</text>
</svg>`;

async function run(label: string, png: Buffer) {
  const q = await assessQuality(png);
  console.log(`\n=== ${label} ===`);
  console.log(`Kalite: ${q.width}x${q.height}, parlaklık ${q.brightness}, netlik ${q.sharpness}, skor ${q.score}` + (q.issues.length ? `  ⚠️ ${q.issues.join(", ")}` : "  ✓"));
  const t0 = Date.now();
  const res = await parseBusinessCard(null, { base64: png.toString("base64"), mimeType: "image/png" });
  console.log(`Süre: ${Date.now() - t0}ms | sağlayıcı: ${res.provider} | genel güven: ${res.confidence_score}`);
  console.log(`  Ad     : ${res.full_name}`);
  console.log(`  Ünvan  : ${res.title}`);
  console.log(`  Şirket : ${res.company}`);
  console.log(`  E-posta: ${res.email}`);
  console.log(`  Telefon: ${res.phone}`);
  console.log(`  Web    : ${res.website}`);
  console.log(`  Şehir  : ${res.city}`);
  if (res.warnings.length) console.log(`  Uyarı  : ${res.warnings.join(" | ")}`);
  return res;
}

(async () => {
  const clean = await sharp(Buffer.from(CARD_SVG)).png().toBuffer();

  // 1) Net kart
  const r1 = await run("NET KARTVIZIT (1000x620)", clean);

  // 2) Kötü kart: küçült (340px) + bulanıklaştır + karart → ön-işleme devreye girmeli
  const degraded = await sharp(clean)
    .resize({ width: 340 })
    .blur(1.4)
    .linear(0.6, -10) // karart (loş)
    .png()
    .toBuffer();
  const r2 = await run("KÖTÜ KART (340px, bulanık, loş) — oto-iyileştirme", degraded);

  // Değerlendirme
  const hit = (r: any) => [/@/.test(r.email), /\d{10,}/.test(r.phone.replace(/\D/g, "")), !!r.full_name].filter(Boolean).length;
  console.log("\n--- SONUÇ ---");
  console.log(`Net kart  : email${/@/.test(r1.email) ? "✓" : "✗"} tel${/\d{10}/.test(r1.phone.replace(/\D/g, "")) ? "✓" : "✗"} ad${r1.full_name ? "✓" : "✗"}`);
  console.log(`Kötü kart : email${/@/.test(r2.email) ? "✓" : "✗"} tel${/\d{10}/.test(r2.phone.replace(/\D/g, "")) ? "✓" : "✗"} ad${r2.full_name ? "✓" : "✗"}`);
  const ok = hit(r1) >= 2;
  console.log(ok ? "\n✅ OCR gerçek kartı OKUDU." : "\n❌ OCR başarısız (font/render sorunu olabilir).");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("Hata:", e); process.exit(1); });
