import { loadEnvConfig } from "@next/env";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import {
  clientsCollectionPath,
  commitmentsCollectionPath,
  externalRecordMappingsCollectionPath,
  integrationSnapshotsCollectionPath,
  integrationsCollectionPath,
  integrationSyncJobsCollectionPath,
  monthlyTouchesCollectionPath,
  opportunitiesCollectionPath,
  tenantPath,
  tenantUsersCollectionPath,
} from "../src/lib/server/firebase/collections";

function normalizePrivateKey(privateKey?: string) {
  return privateKey?.replace(/\\n/g, "\n");
}

async function deleteCollection(db: FirebaseFirestore.Firestore, collectionPath: string) {
  const snapshot = await db.collection(collectionPath).get();
  if (snapshot.empty) {
    return;
  }

  const batch = db.batch();
  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();
}

async function deleteTenant(db: FirebaseFirestore.Firestore, tenantId: string) {
  await Promise.all([
    deleteCollection(db, clientsCollectionPath(tenantId)),
    deleteCollection(db, monthlyTouchesCollectionPath(tenantId)),
    deleteCollection(db, commitmentsCollectionPath(tenantId)),
    deleteCollection(db, opportunitiesCollectionPath(tenantId)),
    deleteCollection(db, integrationsCollectionPath(tenantId)),
    deleteCollection(db, externalRecordMappingsCollectionPath(tenantId)),
    deleteCollection(db, integrationSyncJobsCollectionPath(tenantId)),
    deleteCollection(db, integrationSnapshotsCollectionPath(tenantId)),
    deleteCollection(db, tenantUsersCollectionPath(tenantId)),
  ]);

  await db.doc(tenantPath(tenantId)).delete().catch(() => null);
}

async function upsertUser(
  auth: ReturnType<typeof getAuth>,
  db: FirebaseFirestore.Firestore,
  tenantId: string,
  email: string,
  password: string,
  role: "tenant_admin" | "account_manager",
) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({ email, password });
  }

  await auth.updateUser(user.uid, { password });
  await auth.setCustomUserClaims(user.uid, { tenantId, role });

  await db.doc(`${tenantUsersCollectionPath(tenantId)}/${user.uid}`).set(
    {
      id: user.uid,
      email,
      role,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return user.uid;
}

async function main() {
  loadEnvConfig(process.cwd());

  const tenantId = process.env.MTOS_TENANT_ID || "map-ranking";
  const demoTenantId = process.env.MTOS_DEMO_TENANT_ID || "tenant-map-ranking-demo";

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY");
  }

  const adminEmail = process.env.MTOS_ADMIN_EMAIL || "";
  const adminPassword = process.env.MTOS_ADMIN_PASSWORD || "";
  const amEmail = process.env.MTOS_AM_EMAIL || "";
  const amPassword = process.env.MTOS_AM_PASSWORD || "";

  if (!adminEmail || !adminPassword || !amEmail || !amPassword) {
    throw new Error("Missing MTOS_ADMIN_EMAIL/MTOS_ADMIN_PASSWORD/MTOS_AM_EMAIL/MTOS_AM_PASSWORD");
  }

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  const auth = getAuth();
  const db = getFirestore();

  if (demoTenantId && demoTenantId !== tenantId) {
    await deleteTenant(db, demoTenantId);
  }

  await db.doc(tenantPath(tenantId)).set(
    {
      id: tenantId,
      name: "Map Ranking",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  const adminUid = await upsertUser(auth, db, tenantId, adminEmail, adminPassword, "tenant_admin");
  const amUid = await upsertUser(auth, db, tenantId, amEmail, amPassword, "account_manager");

  console.log(`Bootstrapped tenant ${tenantId}`);
  console.log(`Created/updated users: adminUid=${adminUid}, amUid=${amUid}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
