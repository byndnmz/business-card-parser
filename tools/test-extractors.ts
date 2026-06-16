/**
 * test-extractors.ts — Yeni RapidOCR-parser hattının birim testleri (sidecar'sız).
 *
 * Sentetik OCR kutularıyla layout → çıkarıcılar → skorlama → çapraz doğrulama →
 * birleştirme zincirini uçtan uca doğrular. Çalıştır: npx tsx tools/test-extractors.ts
 */
import type { OcrBox, FieldHit, QrPayload } from "../src/server/schema";
import { buildLayout } from "../src/server/layout/reconstruct";
import { extractAllFields } from "../src/server/scoring";
import { crossValidate } from "../src/server/cross-validate";
import { assembleCard } from "../src/server/assemble";
import { mergeQrWithOcr, identityConflict } from "../src/server/ocr/qr-merge";

let pass = 0, fail = 0;
function ok(n: string, c: boolean) {
  c ? (pass++, console.log("  \x1b[32mPASS\x1b[0m", n)) : (fail++, console.log("  \x1b[31mFAIL\x1b[0m", n));
}

const IMG_W = 1000, IMG_H = 600;

/** Bir satırı kelime kutularına böler (basit yatay yerleşim). */
function line(words: string[], x0: number, y0: number, h: number, conf = 0.92, gap = 12): OcrBox[] {
  let x = x0;
  return words.map((w) => {
    const wpx = Math.max(24, Math.round(w.length * h * 0.55));
    const box: OcrBox = { text: w, confidence: conf, bbox: { x0: x, y0, x1: x + wpx, y1: y0 + h } };
    x += wpx + gap;
    return box;
  });
}

function runCard(boxes: OcrBox[], imageWidth = IMG_W, imageHeight = IMG_H) {
  const layout = buildLayout(boxes, imageWidth, imageHeight);
  const ex = extractAllFields(layout);
  const xv = crossValidate(ex.hits);
  return { card: assembleCard(xv.hits, ex.notes, [...ex.warnings, ...xv.warnings], "test"), layout };
}

// --- 1) TAM, NET KART ---
console.log("\n[NET KART]");
const boxes: OcrBox[] = [
  ...line(["Dr.", "Ahmet", "Sadık", "Şahiner"], 60, 80, 56),
  ...line(["Siber", "Güvenlik", "Grup", "Lideri"], 60, 175, 34),
  ...line(["LİMİT", "SAVUNMA", "TEKNOLOJİLERİ", "A.Ş."], 60, 270, 48),
  ...line(["Siber", "Savunma", "Daire", "Başkanlığı"], 60, 350, 30),
  ...line(["ahmet@limitsavunma.com.tr"], 60, 430, 28),
  ...line(["+90", "312", "444", "88", "55"], 60, 470, 28),
  ...line(["GSM:", "+90", "532", "111", "22", "33"], 350, 470, 28),
  ...line(["www.limitsavunma.com.tr"], 60, 510, 28),
  ...line(["Savunma", "Sanayii", "Vadisi,", "Blok", "B,", "Çankaya", "/", "Ankara"], 60, 560, 26),
];
const { card } = runCard(boxes);
console.log("  →", JSON.stringify({ name: card.full_name, title: card.title, company: card.company, email: card.email, phone: card.phone, mobile: card.mobile_phone, web: card.website, city: card.city }, null, 0));

ok("isim ayrıştırıldı", /Şahiner/.test(card.full_name));
ok("isim büyük puntodan seçildi (rakam/@ yok)", !/[@\d]/.test(card.full_name));
ok("unvan (sözlük: Lider)", /Lider/i.test(card.title));
ok("şirket (A.Ş./SAVUNMA)", /SAVUNMA/i.test(card.company));
ok("departman (Daire/Başkanlığı)", /(Daire|Başkanlığı)/i.test(card.department || ""));
ok("email birebir", card.email === "ahmet@limitsavunma.com.tr");
ok("telefon E.164 (sabit)", card.phone === "+903124448855");
ok("cep E.164 (mobil ayrıldı)", card.mobile_phone === "+905321112233");
ok("website e-posta domaininden ayrı/normalize", card.website === "limitsavunma.com.tr");
ok("şehir = Ankara", card.city === "Ankara");
ok("ülke = Türkiye", card.country === "Türkiye");
const nameField = card.fields.find((f) => f.field_name === "full_name");
ok("isim bbox gerçek kutudan (% > 0)", !!nameField && nameField.bounding_box.width > 0 && nameField.bounding_box.x > 0);
const companyField = card.fields.find((f) => f.field_name === "company");
ok("şirket güveni e-posta domaini ile yükseldi", !!companyField && companyField.confidence_score >= 0.6);

// --- 2) FAKS numarası telefon/cep'e BASILMAMALI ---
console.log("\n[FAKS AYRIMI]");
const faxBoxes: OcrBox[] = [
  ...line(["Mehmet", "Yılmaz"], 60, 80, 50),
  ...line(["Genel", "Müdür"], 60, 160, 32),
  ...line(["Tel:", "+90", "216", "555", "10", "20"], 60, 240, 28),
  ...line(["Faks:", "+90", "216", "555", "10", "21"], 60, 280, 28),
];
const fax = runCard(faxBoxes).card;
ok("sabit telefon alındı", fax.phone === "+902165551020");
ok("faks telefon alanına BASILMADI", fax.phone !== "+902165551021");
ok("faks cep alanına da BASILMADI", fax.mobile_phone !== "+902165551021");

// --- 3) DÜŞÜK KALİTE → sustur + uyarı (yanlış basma) ---
console.log("\n[DÜŞÜK KALİTE]");
const junk: OcrBox[] = [
  ...line(["###", "|||"], 60, 100, 20, 0.2),
  ...line(["~~", "::"], 60, 160, 20, 0.2),
];
const j = runCard(junk).card;
ok("çöp girdide isim BASILMADI", j.full_name === "");
ok("çöp girdide uyarı döndü", j.warnings.some((w) => /Ad\/Soyad/.test(w)));

// --- 4) Sadece cep varsa: phone boş, mobile dolu ---
console.log("\n[YALNIZ CEP]");
const onlyMobile: OcrBox[] = [
  ...line(["Ayşe", "Demir"], 60, 80, 50),
  ...line(["Uzman"], 60, 160, 32),
  ...line(["0532", "111", "22", "33"], 60, 240, 28),
];
const om = runCard(onlyMobile).card;
ok("cep E.164 (0532 → +90...)", om.mobile_phone === "+905321112233");

// --- 5) Etiket yapismasi + kisaltma unvan ---
console.log("\n[CZM EDGE]");
const czmEdge: OcrBox[] = [
  ...line(["CZM", "GRUP"], 230, 390, 52),
  ...line(["HAKKI", "ÇIZMECI"], 360, 475, 36),
  ...line(["Yön.", "Krl.", "B$k.", "Yrd."], 360, 495, 27),
  ...line(["Eh.cizmeci@czmgrup.com"], 330, 619, 37),
];
const czm = runCard(czmEdge).card;
ok("email E etiketi ayiklandi", czm.email === "h.cizmeci@czmgrup.com");
ok("kisaltma unvan normalize edildi", /B\u015fk/i.test(czm.title));

// --- 6) Logo + harf aralikli alt satir: sirket tam adina tamamlanmali ---
console.log("\n[BEYOND COMPANY COMPLETION]");
const beyondDamla: OcrBox[] = [
  ...line(["BEYOND"], 610, 105, 38, 0.99),
  ...line(["T", "E", "C", "H", "N", "O", "L", "O", "G", "I", "E", "S"], 650, 150, 18, 0.92, 4),
  ...line(["Damla", "Reçber"], 160, 225, 46, 0.99),
  ...line(["Project", "Assistant", "Specialist"], 160, 295, 24, 0.99),
  ...line(["damlarecber@beyondtech.com.tr"], 160, 460, 28, 0.99),
];
const bd = runCard(beyondDamla).card;
ok("BEYOND sirket adi TECHNOLOGIES ile tamamlandi", bd.company === "BEYOND TECHNOLOGIES");

// --- 7) 90 derece donuk kart: dikey OCR kutulari tek satira birlesmemeli ---
console.log("\n[DÖNÜK KART]");
const rotatedBeyond: OcrBox[] = [
  { text: "www.beyondtech.com.tr", confidence: 1, bbox: { x0: 462, y0: 484, x1: 520, y1: 912 } },
  { text: "kadioglu@beyondtech.com.tr", confidence: 1, bbox: { x0: 520, y0: 487, x1: 580, y1: 1001 } },
  { text: "+90 532 205 56 98", confidence: 0.97, bbox: { x0: 587, y0: 492, x1: 650, y1: 846 } },
  { text: "CEO", confidence: 1, bbox: { x0: 787, y0: 512, x1: 835, y1: 618 } },
  { text: "Dr. Yasin Murat KADIOGLU", confidence: 0.97, bbox: { x0: 823, y0: 513, x1: 880, y1: 1058 } },
  { text: "BEYOND", confidence: 1, bbox: { x0: 931, y0: 1167, x1: 1000, y1: 1502 } },
  { text: "ECHNOLOGIES", confidence: 1, bbox: { x0: 910, y0: 1246, x1: 970, y1: 1453 } },
];
const rb = runCard(rotatedBeyond, 1536, 2048).card;
ok("donuk kartta isim logo degil", /Yasin Murat/i.test(rb.full_name));
ok("donuk kartta unvan", rb.title === "CEO");
ok("donuk kartta sirket tam adiyla eslesti", rb.company === "BEYOND TECHNOLOGIES");

// --- 8) QR FARKLI kişiye aitse yok sayılmalı (karttaki yazı esas) ---
console.log("\n[QR KİMLİK ÇAKIŞMASI]");
const fh = (name: string, value: string, conf = 0.9): FieldHit =>
  ({ field_name: name as any, value, confidence: conf, bbox: { x: 0, y: 0, width: 0, height: 0 }, source: "ocr", valid: true });

const ocrDamla: FieldHit[] = [
  fh("full_name", "Damla Reçber"), fh("title", "Project Assistant Specialist"),
  fh("email", "damlarecber@beyondtech.com.tr"), fh("mobile_phone", "+905308741807"),
];
const qrEce: QrPayload = {
  raw: "", format: "vcard",
  fields: { full_name: "Ece Saral", title: "Business Development Specialist", email: "ecesaral@beyondtech.com.tr", mobile_phone: "+905527952920" },
};
const m8 = mergeQrWithOcr(ocrDamla, qrEce);
ok("farklı kimlikli QR yok sayıldı", m8.qrIgnored === true);
ok("karttaki yazı korundu (Ece Saral basılmadı)", !m8.hits.some((h) => /Ece Saral/i.test(h.value)));
ok("identityConflict: Damla vs Ece = çakışma", identityConflict("Damla Reçber", "Ece Saral") === true);
ok("identityConflict: aynı kişi = çakışma yok", identityConflict("Damla Reçber", "Damla R Reçber") === false);

// --- 9) AYNI kişi: QR yalnızca eksik alanı doldurur ---
console.log("\n[QR EKSİK DOLDURMA]");
const ocrPartial: FieldHit[] = [fh("full_name", "Damla Reçber"), fh("email", "damlarecber@beyondtech.com.tr")];
const qrSame: QrPayload = { raw: "", format: "vcard", fields: { full_name: "Damla Reçber", mobile_phone: "+905308741807" } };
const m9 = mergeQrWithOcr(ocrPartial, qrSame);
ok("aynı kişi QR yok sayılmadı", m9.qrIgnored === false);
ok("QR eksik alanı doldurdu (mobile)", m9.hits.some((h) => h.field_name === "mobile_phone" && h.value === "+905308741807"));

console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
