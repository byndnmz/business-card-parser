/**
 * thresholds.ts — Boru hattının AYARLANABİLİR eşikleri (kod mantığı değil, VERİ).
 *
 * Bu dosyadaki değerleri değiştirerek davranış kod düzenlemeden ayarlanabilir.
 * Tüm eşikler tek yerde toplanmıştır; sihirli sayı dağıtmaktan kaçınılır.
 */

export const THRESHOLDS = {
  // --- LAYOUT: kutu → satır → blok ---
  /**
   * İki kutu aynı satır sayılır mı: y-MERKEZ mesafesi <= bu × min(yükseklik).
   * Örtüşme oranı yerine merkez mesafesi kullanılır; böylece açılı/sıkışık
   * kartlarda dikey komşu satırlar (isim/unvan) yanlışlıkla birleşmez.
   */
  lineCenterDistFactor: 0.5,
  /** Satırlar arası dikey boşluk bu × medyan-satır-yüksekliğini aşarsa yeni blok. */
  blockGapFactor: 1.6,
  /** Aynı satırdaki kutuları birleştirirken araya boşluk koyma x-mesafe eşiği (× yükseklik). */
  wordJoinGapFactor: 1.8,

  // --- PUNTO (font boyutu) sinyali ---
  /** Bir satırın "büyük punto" sayılması için medyan yüksekliğe oran. */
  largeFontRatio: 1.15,
  /** İsim/şirket adayları için üst blok bölgesi (görselin üst %'si). */
  topRegionPct: 55,

  // --- GÜVEN / İNCELEME ---
  /** Bu skorun ALTINDAKİ alan "incelenmeli" (needsReview) işaretlenir. */
  reviewBelow: 0.55,
  /** Semantik alan (isim/şirket/unvan) bu skorun altındaysa BASILMAZ (boş bırakılır). */
  semanticSuppressBelow: 0.4,
  /** Deterministik alanlar (email/phone/url) doğrulanınca taban güven. */
  deterministicConfidence: 0.92,
  /** OCR kutu güveni yoksa kullanılan taban. */
  fallbackWordConfidence: 0.7,

  // --- İSİM ---
  nameMinWords: 2,
  nameMaxWords: 4,

  // --- ÇAPRAZ DOĞRULAMA ---
  /** email domain ↔ şirket/website tutarlıysa güveni bu kadar artır (clamp 0..1). */
  crossValidateBoost: 0.08,
  /** Çelişki varsa güveni bu kadar düşür. */
  crossValidatePenalty: 0.15,

  // --- OCR DÜZELTME (ölçülü) ---
  /** Türkçe karışıklık düzeltmesi yalnızca kutu güveni bunun altındaysa denenir. */
  ocrCorrectionMaxConfidence: 0.75,

  // --- HIZ ---
  /** Sidecar HTTP zaman aşımı (ms). */
  ocrServiceTimeoutMs: 15000,
} as const;

export type Thresholds = typeof THRESHOLDS;
