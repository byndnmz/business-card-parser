/**
 * schema.ts — OCR/parser katmanının TEK KAYNAK tip şeması.
 *
 * `ParsedCard` ve `ParsedField` sistemin geri kalanıyla (server.ts, frontend,
 * Firestore kayıtları) sözleşmedir; DEĞİŞTİRİLMEZ. Yeni RapidOCR + parser
 * boru hattının ürettiği iç tipler (OcrBox, Layout*, FieldHit) de buradadır,
 * böylece tüm modüller aynı tanımı paylaşır.
 *
 * parser.ts bu tipleri yeniden ihraç eder (geri uyumluluk: `import { ParsedCard }
 * from "./parser"` çalışmaya devam eder).
 */

// --- KORUNAN DIŞ SÖZLEŞME (mevcut şemayla birebir aynı) ---------------------

/** Bounding box — YÜZDE cinsinden (0–100), görsel sol-üst köşeye göre. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ParsedField {
  field_name: string;
  field_value: string;
  confidence_score: number;
  valid: boolean; // regex/biçim doğrulamasından geçti mi
  bounding_box: BoundingBox;
}

export interface ParsedCard {
  full_name: string;
  title: string;
  company: string;
  department?: string;
  email: string;
  phone: string;
  mobile_phone?: string;
  website: string;
  address: string;
  city?: string;
  country?: string;
  linkedin?: string;
  notes?: string;
  confidence_score: number;
  fields: ParsedField[];
  provider: string; // hangi OCR sağlayıcısı üretti
  warnings: string[]; // doğrulama uyarıları (düşük güven / geçersiz biçim)
}

/** Kalıcı şemadaki `field_name` enum'u (types.ts ile aynı). */
export type FieldName =
  | "full_name"
  | "title"
  | "company"
  | "department"
  | "email"
  | "phone"
  | "mobile_phone"
  | "website"
  | "address"
  | "city"
  | "country"
  | "linkedin"
  | "tax_info"
  | "notes";

// --- OCR KATMANI İÇ TİPLERİ (yeni boru hattı) ------------------------------

/** Tek bir OCR kutusu: piksel köşeleri (İŞLENMİŞ görsele göre) + metin + güven. */
export interface OcrBox {
  text: string;
  confidence: number; // 0..1
  bbox: { x0: number; y0: number; x1: number; y1: number }; // piksel
}

/** QR / vCard kısa yolundan gelen yapısal veri (varsa). */
export interface QrPayload {
  raw: string;
  format: "vcard" | "mecard" | "json" | "url" | "kv" | "text";
  fields: Partial<Record<FieldName, string>>;
}

/** Python sidecar'ın döndürdüğü ham OCR sonucu. */
export interface OcrResult {
  engine: string; // "rapidocr", vb.
  boxes: OcrBox[];
  imageWidth: number; // İŞLENMİŞ görsel boyutu (bbox'lar buna göre)
  imageHeight: number;
  qr?: QrPayload | null;
  /** İşlenmiş (deskew/warp uygulanmış) görsel — overlay'in oturması için. */
  processedImageBase64?: string | null;
  timings?: Record<string, number>; // aşama süreleri (ms)
  warnings?: string[];
}

// --- LAYOUT (kutu → satır → blok) ------------------------------------------

export interface LayoutLine {
  text: string;
  words: OcrBox[];
  /** Piksel kutusu (satırın birleşimi). */
  bbox: { x0: number; y0: number; x1: number; y1: number };
  sourceBbox?: { x0: number; y0: number; x1: number; y1: number };
  yCenter: number;
  height: number; // "font boyutu" vekili (piksel)
  confidence: number; // 0..1 ortalama
}

export interface LayoutBlock {
  lines: LayoutLine[];
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface LayoutModel {
  lines: LayoutLine[];
  blocks: LayoutBlock[];
  imageWidth: number;
  imageHeight: number;
  sourceImageWidth?: number;
  sourceImageHeight?: number;
  orientation?: "normal" | "rotate90ccw";
  /** Satır yüksekliklerinin medyanı / maksimumu — punto karşılaştırması için. */
  medianHeight: number;
  maxHeight: number;
  /** Düz birleştirilmiş metin (geriye dönük yardımcılar için). */
  flatText: string;
}

// --- ALAN ÇIKARIM SONUCU ---------------------------------------------------

/**
 * Bir çıkarıcının bulduğu aday: değer + güven + KAYNAK bbox (yüzde) + sinyaller.
 * `needsReview` true ise değer düşük güvenli — "incelenmeli" işaretlenir.
 */
export interface FieldHit {
  field_name: FieldName;
  value: string;
  confidence: number; // 0..1
  bbox: BoundingBox; // YÜZDE
  source: string; // hangi çıkarıcı/sinyal üretti
  valid: boolean;
  needsReview?: boolean;
  /** Skorlama/çapraz doğrulama için ham sinyaller (tanılama). */
  signals?: Record<string, number>;
}
