/**
 * firestore-admin.ts — Sunucu tarafı GERÇEK Firestore kalıcılığı (Admin SDK).
 *
 * Neden Admin SDK?
 *  Önceki kod, Firestore'a KİMLİKSİZ web client SDK ile yazıyordu; firestore.rules
 *  `isSignedIn()` istediği için tüm yazımlar permission-denied ile reddediliyor ve
 *  veri yalnızca bellekte kalıyordu. Admin SDK, güvenlik kurallarını baypas eder;
 *  yetkilendirme zaten server.ts'teki requireAuth/requireRole katmanında uygulanır.
 *
 * Kimlik bilgisi çözümleme (öncelik sırası):
 *  1) FIREBASE_SERVICE_ACCOUNT  — servis hesabı JSON'u (inline string). Vercel vb. için.
 *  2) GOOGLE_APPLICATION_CREDENTIALS — servis hesabı JSON dosya yolu (ADC).
 *  3) GCP ortamı (Cloud Run/Functions/App Engine) — metadata sunucusundan ADC.
 *  4) FIREBASE_ADMIN_ADC=true — ADC'yi açıkça zorla.
 * Hiçbiri yoksa kalıcılık DEVRE DIŞI kalır (temiz in-memory fallback — çökmez).
 */

import {
  initializeApp,
  applicationDefault,
  cert,
  getApps,
  type App,
  type Credential,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";

// Başlatılmış Admin app referansı (Firestore + Auth paylaşır).
let adminApp: App | null = null;

/** Admin Auth örneğini döndürür (Firebase ID token doğrulamak için), yoksa null. */
export function getAdminAuth(): Auth | null {
  return adminApp ? getAuth(adminApp) : null;
}

/** Başlatılmış Admin app'i döndürür (Storage vb. için), yoksa null. */
export function getAdminApp(): App | null {
  return adminApp;
}

export interface Persistence {
  /** Gerçek Firestore yazımı etkin mi? false ise tüm çağrılar no-op'tur. */
  readonly enabled: boolean;
  readonly source: string;
  save(collection: string, id: string, data: any): Promise<void>;
  remove(collection: string, id: string): Promise<void>;
  loadAll(collection: string): Promise<any[]>;
}

interface ResolvedCredential {
  credential: Credential;
  source: string;
}

function resolveCredential(): ResolvedCredential | null {
  // 1) Inline servis hesabı JSON'u
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline && inline.trim().startsWith("{")) {
    try {
      const json = JSON.parse(inline);
      return { credential: cert(json), source: "FIREBASE_SERVICE_ACCOUNT (inline)" };
    } catch (err) {
      console.error("[FIRESTORE-ADMIN] FIREBASE_SERVICE_ACCOUNT JSON ayrıştırılamadı:", err);
    }
  }
  // 2) Servis hesabı dosya yolu (ADC standardı)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { credential: applicationDefault(), source: "GOOGLE_APPLICATION_CREDENTIALS" };
  }
  // 3) GCP yönetimli ortam (Cloud Run / Functions / App Engine) → metadata ADC
  if (process.env.K_SERVICE || process.env.FUNCTION_TARGET || process.env.GAE_ENV) {
    return { credential: applicationDefault(), source: "application default (GCP)" };
  }
  // 4) Açık opt-in
  if (process.env.FIREBASE_ADMIN_ADC === "true") {
    return { credential: applicationDefault(), source: "application default (opt-in)" };
  }
  return null;
}

class NoopPersistence implements Persistence {
  readonly enabled = false;
  readonly source = "in-memory (kalıcılık devre dışı)";
  async save() {}
  async remove() {}
  async loadAll() {
    return [];
  }
}

class AdminPersistence implements Persistence {
  readonly enabled = true;
  constructor(private db: Firestore, readonly source: string) {}

  async save(collection: string, id: string, data: any): Promise<void> {
    try {
      await this.db.collection(collection).doc(id).set(data, { merge: false });
    } catch (err) {
      console.error(`[FIRESTORE-ADMIN] save ${collection}/${id} hata:`, err);
    }
  }

  async remove(collection: string, id: string): Promise<void> {
    try {
      await this.db.collection(collection).doc(id).delete();
    } catch (err) {
      console.error(`[FIRESTORE-ADMIN] remove ${collection}/${id} hata:`, err);
    }
  }

  async loadAll(collection: string): Promise<any[]> {
    const snap = await this.db.collection(collection).get();
    return snap.docs.map((d) => d.data());
  }
}

/**
 * Admin SDK persistence'ı (varsa) kurar; aksi halde no-op döner.
 * @param projectId Firebase proje kimliği (config dosyasından).
 * @param databaseId Named Firestore veritabanı kimliği (ör. ai-studio-...).
 */
export function createPersistence(projectId: string, databaseId?: string): Persistence {
  const resolved = resolveCredential();
  if (!resolved) {
    console.warn(
      "[FIRESTORE-ADMIN] Kimlik bilgisi bulunamadı — kalıcılık DEVRE DIŞI (in-memory). " +
        "Üretim için FIREBASE_SERVICE_ACCOUNT veya GOOGLE_APPLICATION_CREDENTIALS ayarlayın."
    );
    return new NoopPersistence();
  }
  try {
    const app: App =
      getApps().length > 0
        ? getApps()[0]
        : initializeApp({ credential: resolved.credential, projectId });
    adminApp = app; // Auth (verifyIdToken) bu app'i paylaşır.

    // Named database desteği (ör. "ai-studio-..."); yoksa "(default)".
    const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
    // undefined alanlar set()'i patlatmasın.
    db.settings({ ignoreUndefinedProperties: true });

    console.log(
      `[FIRESTORE-ADMIN] Kalıcılık ETKİN — kaynak: ${resolved.source}, db: ${databaseId || "(default)"}`
    );
    return new AdminPersistence(db, resolved.source);
  } catch (err) {
    console.error("[FIRESTORE-ADMIN] Başlatma hatası — in-memory'e düşülüyor:", err);
    return new NoopPersistence();
  }
}
