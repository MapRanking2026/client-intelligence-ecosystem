import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { getServerEnv, hasFirebaseAdminConfig } from "@/src/lib/server/env";

function initializeFirebaseAdmin() {
  if (!hasFirebaseAdminConfig()) {
    return null;
  }

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
