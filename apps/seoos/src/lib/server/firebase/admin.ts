import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { getServerEnv, hasFirebaseAdminConfig } from "@/src/lib/server/env";

/**
 * Firebase Admin for SEOOS. Uses the SAME service-account env as MTOS so both
 * apps read/write the same tenant-scoped Firestore. Returns null when creds are
 * absent, so seed/dev mode runs credential-free (and live persistence is a
 * blocked_external activation, not a code gap).
 */
function initializeFirebaseAdmin() {
  if (!hasFirebaseAdminConfig()) return null;
  const env = getServerEnv();
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: env.firebaseProjectId,
        clientEmail: env.firebaseClientEmail,
        privateKey: env.firebasePrivateKey,
      }),
    });
  }
  return getApp();
}

export function getFirebaseAdminApp() {
  return initializeFirebaseAdmin();
}

export function getFirebaseAdminAuth() {
  const app = initializeFirebaseAdmin();
  return app ? getAuth(app) : null;
}

export function getFirebaseAdminDb() {
  const app = initializeFirebaseAdmin();
  return app ? getFirestore(app) : null;
}
