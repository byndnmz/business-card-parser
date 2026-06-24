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
import { validateAndScore } from "../src/server/parser";
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
ok("BEYOND kartinda isim rol satirindan ezilmez", bd.full_name === "Damla Reçber");
ok("BEYOND kartinda unvan tam korunur", bd.title === "Project Assistant Specialist");
ok("BEYOND sirket adi TECHNOLOGIES ile tamamlandi", bd.company === "BEYOND TECHNOLOGIES");

const beyondMergedNameTitle: OcrBox[] = [
  ...line(["BEYOND"], 610, 105, 38, 0.99),
  ...line(["Damla", "Reçber", "Project", "Assistant", "Specialist"], 160, 225, 38, 0.98),
  ...line(["damlarecber@beyondtech.com.tr"], 160, 460, 28, 0.99),
];
const bdm = runCard(beyondMergedNameTitle).card;
ok("BEYOND birlesik satirda isim kurtarilir", bdm.full_name === "Damla Reçber");
ok("BEYOND birlesik satirda unvan tam kurtarilir", bdm.title === "Project Assistant Specialist");

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
// --- 8) Kisi adi olmayan servis karti: hizmet satiri isim yapilmamali ---
console.log("\n[NO PERSON SERVICE CARD]");
const serviceOnly: OcrBox[] = [
  ...line(["Ustaoglu"], 140, 155, 145, 0.99),
  ...line(["Egzoz"], 320, 240, 42, 0.99),
  ...line(["PARTIKUL", "&", "KATALIZOR", "0545", "360", "55", "49", "0544", "855", "02", "19", "0362", "228", "08", "56"], 200, 270, 48, 0.96),
  ...line(["DPF", "/", "EGR", "Gulsan", "Sn.", "Sit.", "No:", "76", "Canik", "/", "SAMSUN"], 320, 345, 42, 0.98),
  ...line(["COZUM", "MERKEZI", "CHIP", "TUNING"], 300, 405, 70, 0.99),
];
const svc = runCard(serviceOnly, 1180, 920).card;
ok("servis kartinda sahte isim basilmaz", svc.full_name === "");
ok("logo + sektor satiri sirket olur", /Ustaoglu Egzoz/i.test(svc.company));
ok("bitisik coklu telefonda sabit alinir", svc.phone === "+903622280856");
ok("bitisik coklu telefonda cep ayrilir", svc.mobile_phone === "+905453605549");

// --- 9) Sektor kelimesi olan buyuk logo isim degil, sirket olmali ---
console.log("\n[SECTOR LOGO VS NAME]");
const furniture: OcrBox[] = [
  ...line(["AKSU", "MOBILYA"], 60, 220, 90, 0.91),
  ...line(["SEYHAN", "AKSU"], 200, 340, 24, 0.96),
  ...line(["CumhuriyetCd.Ege", "Sk.INo:16", "Osmangazi/BURSA"], 160, 445, 18, 0.95),
  ...line(["02242240000"], 250, 500, 16, 0.99),
];
const furn = runCard(furniture, 582, 640).card;
ok("sektor logolu satir sirket olur", furn.company === "AKSU MOBILYA");
ok("alt satirdaki kisi adi korunur", furn.full_name === "SEYHAN AKSU");

// --- 10) Tek OCR satirina birlesen isim + unvan satir icinden ayrilir ---
console.log("\n[INLINE NAME TITLE]");
const inlineCard: OcrBox[] = [
  ...line(["baskimnet.com"], 240, 430, 86, 0.99),
  ...line(["hayata", "ig", "EYL\u00dcL", "BA\u015eARAN", "Genel", "Koordinat\u014dr"], 360, 485, 54, 0.96),
  ...line(["bilgi@baskimnet.com"], 760, 650, 40, 0.97),
  ...line(["0(312)", "496", "11", "66"], 540, 615, 40, 0.97),
];
const inline = validateAndScore(runCard(inlineCard, 1200, 1200).card);
ok("satir icinden isim ayrilir", inline.full_name === "EYL\u00dcL BA\u015eARAN");
ok("satir icinden unvan ayrilir", inline.title === "Genel Koordinat\u00f6r");
ok("domain sirket alanina tamamlanir", inline.company === "BASKIMNET");

// --- 11) Kurum/rol satirlari kisi adi yapilmamali ---
console.log("\n[INSTITUTION/TITLE NOT NAME]");
const academyLike: OcrBox[] = [
  ...line(["Turkish", "Military", "Academy"], 100, 90, 42, 0.96),
  ...line(["semih.ozden@gmail.com"], 520, 260, 26, 0.95),
  ...line(["gmail.com"], 520, 300, 24, 0.95),
];
const academy = validateAndScore(runCard(academyLike).card);
ok("kurum satiri isim olmaz", academy.full_name === "");
ok("email icindeki gmail website olmaz", academy.website === "");

const titleOnlyLike: OcrBox[] = [
  ...line(["Project", "Development"], 520, 120, 34, 0.95),
  ...line(["Manager"], 520, 165, 30, 0.95),
  ...line(["lkirca@resmakine.com"], 520, 260, 24, 0.95),
];
const titleOnly = validateAndScore(runCard(titleOnlyLike).card);
ok("rol satiri isim olmaz", titleOnly.full_name === "");

// --- 12) Domain parcasi sirketi tamamlar; sosyal handle isimden temizlenir ---
console.log("\n[DOMAIN COMPANY AND NAME CLEANUP]");
const onTrailerLike: OcrBox[] = [
  ...line(["TRAILE"], 380, 210, 42, 0.92),
  ...line(["info@on-trailer.com"], 100, 430, 24, 0.96),
];
const onTrailer = validateAndScore(runCard(onTrailerLike).card);
ok("domain parcasi sirketi tamamlar", onTrailer.company === "ON-TRAILER");

const handleNameLike: OcrBox[] = [
  ...line(["Hasan", "YILDIZ", "/yildizlarhasan"], 520, 210, 34, 0.94),
  ...line(["www.hasanyildiz.info"], 120, 340, 24, 0.96),
];
const handleName = validateAndScore(runCard(handleNameLike).card);
ok("sosyal handle isimden temizlenir", handleName.full_name === "Hasan YILDIZ");

// --- 13) Vergi satirindaki marka sirket adina eklenmeli ---
console.log("\n[TAX LINE BRAND PREFIX]");
const armourDefenceLike: OcrBox[] = [
  { text: "Halil KARAKOYUN", confidence: 0.999, bbox: { x0: 307, y0: 362, x1: 366, y1: 922 } },
  { text: "+90 532 462 92 93", confidence: 0.997, bbox: { x0: 465, y0: 430, x1: 512, y1: 835 } },
  { text: "General Manager", confidence: 0.984, bbox: { x0: 387, y0: 433, x1: 447, y1: 835 } },
  { text: "Armour Defence Başkent V.D. / 0801131027", confidence: 0.990, bbox: { x0: 718, y0: 636, x1: 778, y1: 1373 } },
  { text: "Kizilirmak Mah. 1450. Sk. No:18/8 Pk:06520", confidence: 0.996, bbox: { x0: 818, y0: 640, x1: 880, y1: 1379 } },
  { text: "Savunma Sanayi ve Ticaret LTD. ŞTi.", confidence: 0.951, bbox: { x0: 767, y0: 761, x1: 835, y1: 1380 } },
  { text: "Cukurambar-Ankara/TÜRKiYE", confidence: 0.979, bbox: { x0: 874, y0: 856, x1: 937, y1: 1380 } },
];
const armour = validateAndScore(runCard(armourDefenceLike, 1200, 1600).card);
ok("vergi satirindaki marka sirket adina eklenir", armour.company === "Armour Defence Savunma Sanayi ve Ticaret LTD. ŞTi.");
ok("vergi numarasi tax_info alaninda kalir", armour.fields.some((f) => f.field_name === "tax_info" && f.field_value === "0801131027"));

// --- 14) Deterministik satira yapisan isim/unvan geri kazanilmali ---
console.log("\n[DETERMINISTIC RESIDUE NAME/TITLE]");
const demirZeminLike: OcrBox[] = [
  { text: "12.Kat D:82 Esenyurt-ISTANBUL", confidence: 0.981, bbox: { x0: 785, y0: 240, x1: 840, y1: 810 } },
  { text: "Zafer Mah. Doğan Arasli Bulvari", confidence: 0.975, bbox: { x0: 701, y0: 261, x1: 743, y1: 812 } },
  { text: "No:99-97 N Cadde Business", confidence: 0.998, bbox: { x0: 743, y0: 281, x1: 790, y1: 808 } },
  { text: "demir-nermin@hotmail.com", confidence: 1, bbox: { x0: 928, y0: 303, x1: 986, y1: 808 } },
  { text: "0212 979 63 53 (Tel & Fax)", confidence: 0.998, bbox: { x0: 836, y0: 317, x1: 885, y1: 810 } },
  { text: "www.demirzemin.com", confidence: 1, bbox: { x0: 981, y0: 399, x1: 1034, y1: 807 } },
  { text: "0532 587 19 19", confidence: 0.992, bbox: { x0: 882, y0: 504, x1: 937, y1: 810 } },
  { text: "demir zemin mühendislik", confidence: 0.999, bbox: { x0: 524, y0: 871, x1: 580, y1: 1371 } },
  { text: "Nermin DEMIR", confidence: 0.975, bbox: { x0: 824, y0: 945, x1: 902, y1: 1418 } },
  { text: "Jeoloji Mühendisi", confidence: 1, bbox: { x0: 902, y0: 974, x1: 974, y1: 1427 } },
];
const demir = validateAndScore(runCard(demirZeminLike, 1200, 1600).card);
ok("telefon satirina yapisan isim kurtarilir", demir.full_name === "Nermin DEMIR");
ok("email satirina yapisan unvan kurtarilir", demir.title === "Jeoloji Mühendisi");
ok("muhendislik sirket satiri unvan yapilmaz", demir.company === "demir zemin mühendislik");

// --- 15) Satin alma unvani isim olmaz; e-posta local-part isim adayini destekler ---
console.log("\n[BMC NAME VS TITLE]");
const bmcDogusLike: OcrBox[] = [
  ...line(["BMC", "OTOMOTIV", "SANAYI", "VE", "TICARET", "A.\u015e."], 120, 300, 26, 0.98),
  ...line(["dogus.kaya@bmc.com.tr"], 120, 360, 24, 0.99),
  ...line(["Domestic", "Purchasing", "Manager"], 120, 420, 28, 0.96),
  ...line(["Do\u011fu\u015f", "KAYA"], 120, 470, 34, 0.93),
];
const bmcDogus = validateAndScore(runCard(bmcDogusLike).card);
ok("Domestic Purchasing isim degil tam unvan olur", bmcDogus.title === "Domestic Purchasing Manager");
ok("dogus.kaya local-part isim secimini destekler", bmcDogus.full_name === "Do\u011fu\u015f KAYA");

const bmcErkanLike: OcrBox[] = [
  ...line(["T.", "M."], 80, 80, 22, 0.95),
  ...line(["BMC", "OTOMOTIV", "SANAYI", "VE", "TICARET", "A.S."], 120, 300, 26, 0.98),
  ...line(["erkan.baskurt@bmc.com.tr"], 120, 360, 24, 0.99),
  ...line(["Purchasing", "Manager"], 120, 420, 28, 0.96),
  ...line(["Erkan", "BA\u015eKURT"], 120, 470, 34, 0.93),
];
const bmcErkan = validateAndScore(runCard(bmcErkanLike).card);
ok("sadece bas harflerden isim secilmez", bmcErkan.full_name === "Erkan BA\u015eKURT");
ok("Purchasing Manager tam unvan korunur", bmcErkan.title === "Purchasing Manager");

// --- 16) Adres icindeki kurum ve yasal sirket kuyrugu kurtarilir ---
console.log("\n[ADDRESS EMBEDDED COMPANY]");
const semihLike: OcrBox[] = [
  ...line(["semihozden@gmail.com"], 520, 230, 24, 0.95),
  ...line(["Devlet", "Mah.", "Kara", "Harp", "Okulu", "Cad.", "National", "Defence", "University"], 80, 300, 22, 0.96),
  ...line(["Semih", "\u00d6ZDEN"], 80, 380, 34, 0.96),
  ...line(["Chair,", "Assoc.", "Prof.", "Dr."], 80, 430, 24, 0.96),
];
const semih = validateAndScore(runCard(semihLike).card);
ok("adres icindeki kurum sirket/kurum alanina alinir", semih.company === "National Defence University");
ok("kurum adi adreste tekrar kalmaz", !/National Defence University/i.test(semih.address));

const kalekalipLike: OcrBox[] = [
  ...line(["Tevfikbey", "Mah.", "Istiklal", "Cad.", "No.", "29", "34295", "K.\u00c7ekmece", "-", "istanbul", "-", "T\u00fcrkiye", "KALEKALIP", "Makina", "ve", "Kalip", "Sanayi", "A.\u015e."], 60, 270, 18, 0.96),
  ...line(["Alparslan", "\u00c7ELEBi"], 80, 360, 30, 0.95),
  ...line(["Is", "Geli\u015ftirme", "Uzmani"], 80, 405, 22, 0.95),
];
const kalekalip = validateAndScore(runCard(kalekalipLike, 1400, 600).card);
ok("adres sonundaki yasal sirket kuyrugu company alanina tasinir", /KALEKALIP Makina ve Kalip Sanayi A\.\u015e\./.test(kalekalip.company));
ok("sirket kuyrugu adresten temizlenir", !/KALEKALIP/i.test(kalekalip.address));
ok("istanbul ascii-fold ile sehir olarak yakalanir", kalekalip.city === "\u0130stanbul");

const ostimLogoNoiseLike: OcrBox[] = [
  ...line(["C\u00d6STIM"], 90, 80, 58, 0.89),
  ...line(["OSTIM", "DEFENSE", "AND", "AVIATION"], 90, 175, 28, 0.98),
  ...line(["sebnem.nacioglu@ostim.org.tr"], 90, 260, 22, 0.99),
  ...line(["www.ostimsavunma.org"], 90, 300, 22, 0.99),
];
const ostimLogoNoise = validateAndScore(runCard(ostimLogoNoiseLike).card);
ok("tek harf domain artigi uzun sirket satirini ezmez", ostimLogoNoise.company === "OSTIM DEFENSE AND AVIATION");

const splitSurnameWithEmailLike: OcrBox[] = [
  ...line(["sebnem.nacioglu@ostim.org.tr"], 80, 180, 22, 0.99),
  ...line(["+90", "312", "354", "58", "98", "NACIOGLU"], 80, 260, 24, 0.98),
  ...line(["+90", "312", "385", "50", "90", "Sebnem", "Cigdem"], 80, 315, 24, 0.98),
  ...line(["Project", "Manager"], 80, 370, 24, 0.98),
  ...line(["OSTIM", "DEFENSE", "AND", "AVIATION"], 80, 430, 26, 0.98),
];
const splitSurnameWithEmail = validateAndScore(runCard(splitSurnameWithEmailLike).card);
ok("email local-part destekliyse ayrik soyad isimle birlestirilir", splitSurnameWithEmail.full_name === "Sebnem Cigdem NACIOGLU");

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
