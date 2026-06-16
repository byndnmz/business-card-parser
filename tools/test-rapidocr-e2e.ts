/**
 * test-rapidocr-e2e.ts — UÇTAN UCA entegrasyon testi (Node ↔ Python sidecar).
 *
 * Türkçe bir kartvizit görseli üretir (sharp/SVG), çalışan RapidOCR sidecar'ına
 * gönderir ve TAM hattı (OCR → layout → çıkarıcılar → skorlama → ParsedCard)
 * doğrular. Sidecar çalışıyor olmalı:  cd ocr-service && .venv\Scripts\python app.py
 *
 * Çalıştır:  OCR_PROVIDER=rapidocr npx tsx tools/test-rapidocr-e2e.ts
 */
process.env.OCR_PROVIDER = process.env.OCR_PROVIDER || "rapidocr";
import sharpImport from "sharp";
import { parseBusinessCard } from "../src/server/parser";

const sharp: any = (sharpImport as any).default || sharpImport;

const CARD_SVG = `
<svg width="1000" height="640" xmlns="http://www.w3.org/2000/svg">
  <rect width="1000" height="640" fill="#ffffff"/>
  <text x="60" y="110" font-family="DejaVu Sans, Arial, sans-serif" font-size="48" font-weight="bold" fill="#111">Dr. Ahmet Sadık Şahiner</text>
  <text x="60" y="165" font-family="DejaVu Sans, Arial, sans-serif" font-size="32" fill="#333">Siber Güvenlik Grup Lideri</text>
  <text x="60" y="250" font-family="DejaVu Sans, Arial, sans-serif" font-size="36" font-weight="bold" fill="#1e3a8a">LİMİT SAVUNMA TEKNOLOJİLERİ A.Ş.</text>
  <text x="60" y="330" font-family="DejaVu Sans, Arial, sans-serif" font-size="28" fill="#222">Siber Savunma Daire Başkanlığı</text>
  <text x="60" y="410" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" fill="#222">ahmet@limitsavunma.com.tr</text>
  <text x="60" y="455" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" fill="#222">Tel: +90 312 444 88 55</text>
  <text x="520" y="455" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" fill="#222">GSM: +90 532 111 22 33</text>
  <text x="60" y="500" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" fill="#222">www.limitsavunma.com.tr</text>
  <text x="60" y="560" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="#444">Esentepe Mah. Çevre Yolu Bulvarı No:12, Çankaya / Ankara</text>
</svg>`;

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) =>
  c ? (pass++, console.log("  \x1b[32mPASS\x1b[0m", n)) : (fail++, console.log("  \x1b[31mFAIL\x1b[0m", n));

async function main() {
  const png: Buffer = await sharp(Buffer.from(CARD_SVG)).png().toBuffer();
  const base64 = png.toString("base64");

  console.log(`Sidecar: ${process.env.RAPIDOCR_SERVICE_URL || "http://127.0.0.1:8765"}  |  sağlayıcı: ${process.env.OCR_PROVIDER}`);
  const t0 = Date.now();
  const card = await parseBusinessCard(null, { base64, mimeType: "image/png" });
  const ms = Date.now() - t0;

  console.log(`\nSağlayıcı: ${card.provider} | süre: ${ms}ms | genel güven: ${card.confidence_score}`);
  console.log("  Ad     :", card.full_name);
  console.log("  Ünvan  :", card.title);
  console.log("  Şirket :", card.company);
  console.log("  Depart.:", card.department);
  console.log("  E-posta:", card.email);
  console.log("  Telefon:", card.phone, "| Cep:", card.mobile_phone);
  console.log("  Web    :", card.website);
  console.log("  Adres  :", card.address, `(${card.city}/${card.country})`);
  if (card.warnings.length) console.log("  Uyarı  :", card.warnings.join(" | "));
  console.log("  Alanlar:", card.fields.map((f) => `${f.field_name}(${(f.confidence_score * 100) | 0}%)`).join(", "));

  console.log("\n[DOĞRULAMA]");
  if (card.provider !== "rapidocr") {
    console.log("  \x1b[31mFAIL\x1b[0m sağlayıcı rapidocr DEĞİL — sidecar çalışıyor mu? (provider:", card.provider, ")");
    fail++;
  } else {
    ok("sağlayıcı = rapidocr", true);
    ok("e-posta okundu", /@limitsavunma\.com\.tr/i.test(card.email));
    ok("telefon E.164 (+90)", card.phone.startsWith("+90"));
    ok("cep ayrıldı (+90 5..)", !card.mobile_phone || /^\+905/.test(card.mobile_phone));
    ok("isim okundu (Şahiner/Sahiner)", /[şs]ahiner/i.test(card.full_name));
    ok("şirket (SAVUNMA)", /savunma/i.test(card.company));
    ok("şehir = Ankara", /ankara/i.test(card.city || ""));
    ok("bbox üretildi (% > 0)", card.fields.some((f) => f.bounding_box.width > 0));
  }

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("Hata:", e); process.exit(2); });
