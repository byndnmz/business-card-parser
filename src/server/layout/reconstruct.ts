/**
 * layout/reconstruct.ts — OCR kutularını SATIR ve BLOKlara yeniden yapılandırır.
 *
 * Parser'ın temeli: düz birleştirilmiş metne güvenmek yerine UZAMSAL bilgiyi
 * (kutu konumu + bbox yüksekliğinden punto vekili) kullanır. İsim/şirket genelde
 * en büyük puntodur; unvan ismin hemen altındadır — bunlar ancak layout ile bilinir.
 *
 * Saf fonksiyonlar; hiçbir harici bağımlılık yok (birim test edilebilir).
 */

import type { OcrBox, LayoutLine, LayoutBlock, LayoutModel, BoundingBox } from "../schema";
import { THRESHOLDS } from "../config/thresholds";

type PixelBox = { x0: number; y0: number; x1: number; y1: number };
type LayoutWord = OcrBox & { sourceBbox?: PixelBox };

const h = (b: OcrBox) => Math.max(1, b.bbox.y1 - b.bbox.y0);
const w = (b: OcrBox) => Math.max(1, b.bbox.x1 - b.bbox.x0);
const yC = (b: OcrBox) => (b.bbox.y0 + b.bbox.y1) / 2;
const sourceBox = (b: LayoutWord): PixelBox => b.sourceBbox ?? b.bbox;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Piksel kutusunu YÜZDE bbox'a çevirir (clamp 0..100, 1 ondalık). */
export function toPercentBox(
  px: { x0: number; y0: number; x1: number; y1: number },
  imgW: number,
  imgH: number
): BoundingBox {
  if (imgW <= 0 || imgH <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return {
    x: Number(clamp((px.x0 / imgW) * 100).toFixed(1)),
    y: Number(clamp((px.y0 / imgH) * 100).toFixed(1)),
    width: Number(clamp(((px.x1 - px.x0) / imgW) * 100).toFixed(1)),
    height: Number(clamp(((px.y1 - px.y0) / imgH) * 100).toFixed(1)),
  };
}

/** Bir satırdaki kutuları x'e göre dizip metni birleştirir (büyük boşlukta tek boşluk). */
function buildLine(words: LayoutWord[]): LayoutLine {
  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const x0 = Math.min(...sorted.map((w) => w.bbox.x0));
  const y0 = Math.min(...sorted.map((w) => w.bbox.y0));
  const x1 = Math.max(...sorted.map((w) => w.bbox.x1));
  const y1 = Math.max(...sorted.map((w) => w.bbox.y1));
  const sourceBoxes = sorted.map(sourceBox);
  const sx0 = Math.min(...sourceBoxes.map((b) => b.x0));
  const sy0 = Math.min(...sourceBoxes.map((b) => b.y0));
  const sx1 = Math.max(...sourceBoxes.map((b) => b.x1));
  const sy1 = Math.max(...sourceBoxes.map((b) => b.y1));
  const text = sorted.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim();
  const conf = sorted.reduce((a, w) => a + (w.confidence || 0), 0) / sorted.length;
  return {
    text,
    words: sorted,
    bbox: { x0, y0, x1, y1 },
    sourceBbox: sorted.some((w) => w.sourceBbox)
      ? { x0: sx0, y0: sy0, x1: sx1, y1: sy1 }
      : undefined,
    yCenter: (y0 + y1) / 2,
    height: median(sorted.map(h)),
    confidence: Number(conf.toFixed(3)),
  };
}

/** Kutuları y-MERKEZ mesafesine göre satırlara grupla (okuma sırasına dizilir). */
export function groupIntoLines(boxes: LayoutWord[]): LayoutLine[] {
  const valid = boxes.filter((b) => b.text && b.text.trim().length > 0);
  const sorted = [...valid].sort((a, b) => yC(a) - yC(b));
  const lineBuckets: LayoutWord[][] = [];
  const centers: number[] = []; // her bucket'ın güncel ortalama y-merkezi

  for (const box of sorted) {
    const bc = yC(box);
    const bh = h(box);
    let placed = false;
    for (let i = 0; i < lineBuckets.length; i++) {
      const refH = median(lineBuckets[i].map(h));
      // Aynı satır: merkez mesafesi küçük yüksekliğin yarısını aşmıyorsa.
      if (Math.abs(bc - centers[i]) <= THRESHOLDS.lineCenterDistFactor * Math.min(bh, refH)) {
        lineBuckets[i].push(box);
        centers[i] = lineBuckets[i].reduce((a, w) => a + yC(w), 0) / lineBuckets[i].length;
        placed = true;
        break;
      }
    }
    if (!placed) {
      lineBuckets.push([box]);
      centers.push(bc);
    }
  }

  return lineBuckets
    .map(buildLine)
    .sort((a, b) => a.yCenter - b.yCenter);
}

/** Satırları dikey boşluğa göre bloklara grupla. */
function isLikelyRotated90(boxes: OcrBox[]): boolean {
  const valid = boxes.filter((b) => b.text?.trim() && h(b) > 0 && w(b) > 0);
  if (valid.length < 3) return false;
  const ratios = valid.map((b) => h(b) / w(b));
  const tallShare = valid.filter((b) => h(b) >= w(b) * 2.2).length / valid.length;
  return tallShare >= 0.6 && median(ratios) >= 2.2;
}

function rotateBox90Ccw(box: PixelBox, imageWidth: number): PixelBox {
  return {
    x0: box.y0,
    y0: imageWidth - box.x1,
    x1: box.y1,
    y1: imageWidth - box.x0,
  };
}

function toAnalysisBoxes(boxes: OcrBox[], imageWidth: number): LayoutWord[] {
  return boxes.map((b) => ({
    ...b,
    sourceBbox: b.bbox,
    bbox: rotateBox90Ccw(b.bbox, imageWidth),
  }));
}

export function groupIntoBlocks(lines: LayoutLine[], medianH: number): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  let current: LayoutLine[] = [];
  const gapLimit = medianH * THRESHOLDS.blockGapFactor;

  for (let i = 0; i < lines.length; i++) {
    if (current.length === 0) {
      current.push(lines[i]);
      continue;
    }
    const prev = current[current.length - 1];
    const gap = lines[i].bbox.y0 - prev.bbox.y1;
    if (gap > gapLimit) {
      blocks.push(makeBlock(current));
      current = [lines[i]];
    } else {
      current.push(lines[i]);
    }
  }
  if (current.length) blocks.push(makeBlock(current));
  return blocks;
}

function makeBlock(lines: LayoutLine[]): LayoutBlock {
  const x0 = Math.min(...lines.map((l) => l.bbox.x0));
  const y0 = Math.min(...lines.map((l) => l.bbox.y0));
  const x1 = Math.max(...lines.map((l) => l.bbox.x1));
  const y1 = Math.max(...lines.map((l) => l.bbox.y1));
  return { lines, bbox: { x0, y0, x1, y1 } };
}

/** Tam layout modelini üretir. */
export function buildLayout(boxes: OcrBox[], imageWidth: number, imageHeight: number): LayoutModel {
  const rotated = isLikelyRotated90(boxes);
  const analysisBoxes = rotated ? toAnalysisBoxes(boxes, imageWidth) : boxes;
  const analysisW = rotated ? imageHeight : imageWidth;
  const analysisH = rotated ? imageWidth : imageHeight;
  const lines = groupIntoLines(analysisBoxes);
  const heights = lines.map((l) => l.height).filter((n) => n > 0);
  const medianH = median(heights);
  const maxH = heights.length ? Math.max(...heights) : 0;
  const blocks = groupIntoBlocks(lines, medianH || 1);
  return {
    lines,
    blocks,
    imageWidth: analysisW,
    imageHeight: analysisH,
    sourceImageWidth: rotated ? imageWidth : undefined,
    sourceImageHeight: rotated ? imageHeight : undefined,
    orientation: rotated ? "rotate90ccw" : "normal",
    medianHeight: medianH,
    maxHeight: maxH,
    flatText: lines.map((l) => l.text).join("\n"),
  };
}
