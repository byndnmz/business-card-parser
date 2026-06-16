/**
 * Firestore Admin SDK smoke test.
 *
 * Usage:
 *   npm run firebase:smoke
 *
 * Requires one of:
 *   FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'
 *   GOOGLE_APPLICATION_CREDENTIALS="C:\\path\\to\\service-account.json"
 *   FIREBASE_ADMIN_ADC=true
 */
import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"] });

import fs from "fs";
import path from "path";
import { createPersistence } from "../src/server/firestore-admin";

type FirebaseConfig = {
  projectId?: string;
  firestoreDatabaseId?: string;
};

function loadFirebaseConfig(): FirebaseConfig {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error("firebase-applet-config.json bulunamadi.");
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

async function main() {
  const config = loadFirebaseConfig();
  const projectId = process.env.FIREBASE_PROJECT_ID || config.projectId || "";
  const databaseId = process.env.FIRESTORE_DATABASE_ID || config.firestoreDatabaseId;

  if (!projectId) {
    throw new Error("firebase-applet-config.json icinde projectId bos.");
  }

  const persistence = createPersistence(projectId, databaseId);
  console.log(`[FIREBASE SMOKE] project=${projectId}`);
  console.log(`[FIREBASE SMOKE] database=${databaseId || "(default)"}`);
  console.log(`[FIREBASE SMOKE] source=${persistence.source}`);

  if (!persistence.enabled) {
    throw new Error(
      "Firestore Admin kaliciligi etkin degil. FIREBASE_SERVICE_ACCOUNT veya GOOGLE_APPLICATION_CREDENTIALS ayarlayin."
    );
  }

  const id = `smoke-${Date.now()}`;
  const collection = "_healthchecks";
  const record = {
    id,
    kind: "firestore-admin-smoke",
    created_at: new Date().toISOString(),
  };

  await persistence.save(collection, id, record);
  const records = await persistence.loadAll(collection);
  const found = records.some((r) => r?.id === id);
  if (!found) {
    throw new Error("Firestore yazma/okuma dogrulamasi basarisiz.");
  }
  await persistence.remove(collection, id);

  console.log("[FIREBASE SMOKE] OK: Firestore yazma, okuma ve silme basarili.");
}

main().catch((err) => {
  console.error("[FIREBASE SMOKE] FAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
