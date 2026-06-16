/**
 * image-preprocess.ts — OCR doğruluğunu artıran görüntü ön-işleme + kalite analizi.
 *
 * OCR motorunun (Tesseract) doğruluğu büyük ölçüde GİRDİ KALİTESİNE bağlıdır.
 * Bu modül:
 *   1) Kaliteyi ölçer (bulanıklık = Laplacian varyansı, parlaklık, çözünürlük),
 *   2) Görseli OCR için iyileştirir (gri tonlama, üst-örnekleme, kontrast
 *      normalizasyonu, düşük ışıkta parlatma, gürültü azaltma, keskinleştirme).
 *
 * Kötü görselde (bulanık/loş/küçük) iyileştirme DAHA AGRESİF uygulanır.
 * `sharp` dinamik yüklenir (yalnızca gerçekten gerektiğinde — diğer OCR
 * sağlayıcılarını kullananlara maliyet bindirmez).
 */

export interface Quality {
  width: number;
  height: number;
  brightness: number; // 0..255 ortalama
  sharpness: number; // Laplacian varyansı (yüksek = keskin)
  isBlurry: boolean;
  isLowLight: boolean;
  isBright: boolean;
  isLowRes: boolean;
  score: number; // 0..1 kaba kalite skoru
  issues: string[];
}

// Eşikler (deneysel; ortamına göre ayarlanabilir)
const BLUR_STDEV_THRESHOLD = 8; // normalize Laplacian stdev; altı = bulanık
const LOW_LIGHT = 70; // altı = loş
const BRIGHT = 215; // üstü = aşırı parlak/yanık
const LOW_RES_W = 900; // altı = düşük çözünürlük

async function loadSharp() {
  const mod = await import("sharp");
  return (mod as any).default || mod;
}

/** Görsel kalitesini ölçer (hızlı: küçük örnek üzerinde). */
export async function assessQuality(buf: Buffer): Promise<Quality> {
  const sharp = await loadSharp();
  const meta = await sharp(buf, { failOn: "none" }).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;

  // Hız için küçült + gri tonla. Parlaklık ham gri tonlamadan; netlik ise
  // KONTRAST-NORMALİZE edilmiş görüntü üzerinden ölçülür (beyaz arka plan
  // yanlılığını azaltır — aksi halde temiz bir kart "bulanık" görünebilir).
  const small = sharp(buf, { failOn: "none" }).rotate().grayscale().resize({ width: 600, withoutEnlargement: true });

  const brightStats = await small.clone().stats();
  const brightness = brightStats.channels[0].mean;

  // Netlik: normalize edilmiş görüntünün Laplacian'ının standart sapması
  // (sharp/C ile hesaplanır; arka plan oranından daha az etkilenir).
  const lapStats = await small
    .clone()
    .normalize()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .stats();
  const sharpness = lapStats.channels[0].stdev;

  const isBlurry = sharpness < BLUR_STDEV_THRESHOLD;
  const isLowLight = brightness < LOW_LIGHT;
  const isBright = brightness > BRIGHT;
  const isLowRes = width < LOW_RES_W;

  const issues: string[] = [];
  if (isBlurry) issues.push("Bulanık/düşük netlik");
  if (isLowLight) issues.push("Düşük ışık (loş)");
  if (isBright) issues.push("Aşırı parlak/yansıma");
  if (isLowRes) issues.push("Düşük çözünürlük");

  // Kaba kalite skoru
  let score = 1;
  if (isBlurry) score -= 0.4;
  if (isLowLight || isBright) score -= 0.25;
  if (isLowRes) score -= 0.2;
  score = Math.max(0, Math.min(1, score));

  return { width, height, brightness: Math.round(brightness), sharpness: Math.round(sharpness), isBlurry, isLowLight, isBright, isLowRes, score: Number(score.toFixed(2)), issues };
}

/**
 * Görseli OCR için iyileştirir. Kötü kalitede daha agresif:
 *  - gri tonlama (renk gürültüsünü eler)
 *  - üst-örnekleme (Tesseract yüksek çözünürlüğü sever; ~1600px hedef)
 *  - kontrast normalizasyonu (histogram germe)
 *  - düşük ışıkta parlatma (linear kazanç)
 *  - bulanıkta gürültü azaltma (median) + keskinleştirme (unsharp)
 * İşlenmiş PNG buffer'ı ve YENİ boyutları döner (bbox %'leri buna göre hesaplanır).
 */
export async function enhanceForOcr(buf: Buffer, q: Quality): Promise<{ data: Buffer; width: number; height: number }> {
  const sharp = await loadSharp();
  let pipe = sharp(buf, { failOn: "none" }).rotate().grayscale();

  const targetW = 1600;
  if (q.width > 0 && q.width < targetW) {
    pipe = pipe.resize({ width: targetW, kernel: "lanczos3" });
  } else if (q.width > 3000) {
    // Çok büyük görseli hafifçe küçült (hız + gürültü azaltma)
    pipe = pipe.resize({ width: 2400, kernel: "lanczos3" });
  }

  pipe = pipe.normalize(); // kontrast germe (en büyük OCR kazançlarından)

  if (q.isLowLight) pipe = pipe.linear(1.3, 12); // parlat
  if (q.isBright) pipe = pipe.linear(0.85, -5); // yansımayı bastır

  if (q.isBlurry) {
    pipe = pipe.median(1).sharpen({ sigma: 1.5 }); // gürültü azalt + agresif keskinleştir
  } else {
    pipe = pipe.sharpen({ sigma: 0.8 }); // hafif keskinleştir
  }

  const { data, info } = await pipe.png().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
