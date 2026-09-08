import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { getServerEnv } from "@/src/lib/server/env";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";

/**
 * Firestore for the shared Client Intelligence Engine store. When ENGINE_FIREBASE_*
 * is set, the engine lives in a DEDICATED Firebase project that every app connects
 * to (a second, named Admin app) — so MTOS and SEOOS read/write the same canonical
 * store even though each keeps its own project for its own data. When it isn't set,
 * this falls back to the app's own Firestore, so nothing breaks before the env is
 * configured.
 */
const ENGINE_APP = "engine";
const normalizeKey = (k?: string) => k?.replace(/\\n/g, "\n");

/** The Firebase project id the engine store lives in (dedicated, else app's own). */
export function getEngineProjectId(): string {
  return process.env.ENGINE_FIREBASE_PROJECT_ID || getServerEnv().firebaseProjectId || "";
}

let engineDb: Firestore | null = null;

export function getEngineFirebaseDb(): Firestore | null {
  const projectId = process.env.ENGINE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.ENGINE_FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizeKey(process.env.ENGINE_FIREBASE_PRIVATE_KEY);
  // No dedicated engine project configured → use this app's own Firestore.
  if (!projectId || !clientEmail || !privateKey) return getFirebaseAdminDb();

  if (engineDb) return engineDb;
  const existing = getApps().find((a) => a.name === ENGINE_APP);
  const app =
    existing ??
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, ENGINE_APP);
  engineDb = getFirestore(app);
  try {
    engineDb.settings({ ignoreUndefinedProperties: true });
  } catch {
    // Already initialized on this singleton (dev hot reload) — fine.
  }
  return engineDb;
}
