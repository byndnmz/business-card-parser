import jsQR from "jsqr";

export interface PreparedUpload {
  base64: string;
  mimeType: string;
  filename: string;
  imageHash: string;
  originalBytes: number;
  processedBytes: number;
  resized: boolean;
  qrFields?: Record<string, string>;
}

function guessMimeType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split(".").pop() || "";
  if (ext === "jpg" || ext === "jpeg" || ext === "jfif") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

export function isSupportedUploadFile(file: File): boolean {
  const mime = guessMimeType(file);
  return mime.startsWith("image/") || mime === "application/pdf";
}

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(",")[1] || "";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Dosya okunamadi."));
    reader.readAsDataURL(blob);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Gorsel yuklenemedi."));
    };
    img.src = url;
  });
}

function weakHashBase64(base64: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < base64.length; i++) {
    const code = base64.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

async function sha256Base64(base64: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return weakHashBase64(base64);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function drawScaled(img: HTMLImageElement, maxDim: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas hazirlanamadi.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!canvas.toBlob) {
      try {
        const dataUrl = canvas.toDataURL(type, quality);
        const bin = atob(dataUrlToBase64(dataUrl));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        resolve(new Blob([bytes], { type }));
      } catch (err) {
        reject(err);
      }
      return;
    }
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Gorsel sikistirilamadi.")), type, quality);
  });
}

function parseQrPayload(raw: string): Record<string, string> | undefined {
  const cleaned = raw.trim();
  const fields: Record<string, string> = {};
  if (!cleaned) return undefined;

  if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
    try {
      const obj = JSON.parse(cleaned);
      for (const [from, to] of Object.entries({
        full_name: "full_name", name: "full_name", title: "title", company: "company", org: "company",
        department: "department", dept: "department", email: "email", phone: "phone", tel: "phone",
        mobile: "mobile_phone", mobile_phone: "mobile_phone", website: "website", url: "website",
        address: "address", city: "city", country: "country", linkedin: "linkedin",
      })) {
        if (typeof obj[from] === "string" && obj[from].trim()) fields[to] = obj[from].trim();
      }
      return Object.keys(fields).length ? fields : undefined;
    } catch {
      return undefined;
    }
  }

  if (cleaned.toUpperCase().includes("BEGIN:VCARD")) {
    for (const line of cleaned.split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const key = line.slice(0, idx).toUpperCase();
      const value = line.slice(idx + 1).trim();
      if (!value) continue;
      if (key.startsWith("FN")) fields.full_name = value;
      else if (key.startsWith("N") && !key.startsWith("NOTE") && !fields.full_name) {
        const [last, first] = value.split(";");
        fields.full_name = [first, last].filter(Boolean).join(" ").trim();
      } else if (key.startsWith("ORG")) {
        const [company, department] = value.split(";");
        if (company) fields.company = company.trim();
        if (department) fields.department = department.trim();
      } else if (key.startsWith("TITLE")) fields.title = value;
      else if (key.startsWith("EMAIL")) fields.email = value.toLowerCase();
      else if (key.startsWith("TEL")) {
        if (key.includes("CELL") || key.includes("MOB")) fields.mobile_phone = value;
        else fields.phone = value;
      } else if (key.startsWith("URL")) fields.website = value;
      else if (key.startsWith("ADR")) fields.address = value.split(";").filter(Boolean).join(", ");
    }
    return Object.keys(fields).length ? fields : undefined;
  }

  if (/^https?:\/\//i.test(cleaned)) return { website: cleaned };
  return undefined;
}

function scanQr(canvas: HTMLCanvasElement): Record<string, string> | undefined {
  const qrCanvas = document.createElement("canvas");
  const maxDim = 1200;
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  qrCanvas.width = Math.max(1, Math.round(canvas.width * scale));
  qrCanvas.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = qrCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.drawImage(canvas, 0, 0, qrCanvas.width, qrCanvas.height);
  const imageData = ctx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
  const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
  return code?.data ? parseQrPayload(code.data) : undefined;
}

async function prepareRawFile(file: File, mimeType = guessMimeType(file)): Promise<PreparedUpload> {
  const dataUrl = await blobToDataUrl(file);
  const base64 = dataUrlToBase64(dataUrl);
  return {
    base64,
    mimeType,
    filename: file.name,
    imageHash: await sha256Base64(base64),
    originalBytes: file.size,
    processedBytes: file.size,
    resized: false,
  };
}

export async function prepareImageForUpload(file: File, maxDim = 1800, quality = 0.86): Promise<PreparedUpload> {
  const mimeType = guessMimeType(file);
  if (!mimeType.startsWith("image/")) return prepareRawFile(file, mimeType);

  try {
    const img = await loadImage(file);
    const canvas = drawScaled(img, maxDim);
    let qrFields: Record<string, string> | undefined;
    try {
      qrFields = scanQr(canvas);
    } catch (err) {
      console.warn("[upload-prep] QR tarama atlandi:", err);
    }
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    const dataUrl = await blobToDataUrl(blob);
    const base64 = dataUrlToBase64(dataUrl);
    return {
      base64,
      mimeType: "image/jpeg",
      filename: file.name.replace(/\.[^.]+$/, ".jpg"),
      imageHash: await sha256Base64(base64),
      originalBytes: file.size,
      processedBytes: blob.size,
      resized: blob.size < file.size || Math.max(canvas.width, canvas.height) < Math.max(img.naturalWidth, img.naturalHeight),
      qrFields,
    };
  } catch (err) {
    console.warn("[upload-prep] Sikistirma basarisiz, ham dosya yuklenecek:", err);
    return prepareRawFile(file, mimeType);
  }
}
