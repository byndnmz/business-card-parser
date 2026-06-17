/**
 * storage.ts — Görselleri Cloud Storage'a (Firebase/GCS) koyar; Firestore'a yalnızca
 * yol/URL yazılır (base64 doküman şişmesini önler — ölçekleme #1).
 *
 * GÜVENLİ FALLBACK: Storage yapılandırılmamışsa ya da herhangi bir hata olursa
 * fonksiyonlar false/no-op döner; çağıran taraf data-URL'e düşer (upload ASLA kırılmaz).
 * Görseller PRIVATE kalır; kimlik doğrulamalı /api/cards/:id/image ucundan stream edilir.
 */

import { getStorage } from "firebase-admin/storage";
import { getAdminApp } from "./firestore-admin";

function bucketName(): string | null {
  return (
    process.env.STORAGE_BUCKET ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.GCLOUD_STORAGE_BUCKET ||
    (process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app` : null)
  );
}

export function storageEnabled(): boolean {
  return !!getAdminApp() && !!bucketName();
}

function bucket() {
  const app = getAdminApp();
  const bn = bucketName();
  if (!app || !bn) return null;
  return getStorage(app).bucket(bn);
}

/** Görseli bucket'a yükler. Başarılıysa true; aksi halde false (çağıran data-URL'e düşer). */
export async function uploadCardImage(objectPath: string, base64: string, contentType: string): Promise<boolean> {
  const b = bucket();
  if (!b) return false;
  try {
    const clean = base64.startsWith("data:") ? base64.split(",")[1] ?? "" : base64;
    const buf = Buffer.from(clean, "base64");
    await b.file(objectPath).save(buf, {
      contentType,
      resumable: false,
      metadata: { cacheControl: "private, max-age=3600" },
    });
    return true;
  } catch (err) {
    console.error("[STORAGE] yükleme hatası (data-URL'e düşülecek):", err);
    return false;
  }
}

/** Storage'daki görseli base64 olarak okur. Yoksa null döner. */
export async function readCardImageBase64(objectPath: string): Promise<string | null> {
  const b = bucket();
  if (!b || !objectPath) return null;
  try {
    const file = b.file(objectPath);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buf] = await file.download();
    return buf.toString("base64");
  } catch (err) {
    console.error("[STORAGE] okuma hatası:", err);
    return null;
  }
}

/** Görseli yanıta stream eder (auth + sahiplik kontrolü çağırandadır). false = yok/erişilemez. */
export async function streamCardImage(objectPath: string, res: any): Promise<boolean> {
  const b = bucket();
  if (!b) return false;
  try {
    const file = b.file(objectPath);
    const [exists] = await file.exists();
    if (!exists) return false;
    const [meta] = await file.getMetadata();
    res.setHeader("Content-Type", (meta as any).contentType || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=3600");
    await new Promise<void>((resolve, reject) => {
      file.createReadStream().on("error", reject).on("end", () => resolve()).pipe(res);
    });
    return true;
  } catch (err) {
    console.error("[STORAGE] stream hatası:", err);
    return false;
  }
}

/** Görseli siler (best-effort; kart silinince çağrılır). */
export async function deleteCardImage(objectPath: string): Promise<void> {
  const b = bucket();
  if (!b || !objectPath) return;
  try {
    await b.file(objectPath).delete({ ignoreNotFound: true } as any);
  } catch (err) {
    console.error("[STORAGE] silme hatası:", err);
  }
}
