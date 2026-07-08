import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadEnvConfig } from "@next/env";

import {
  getClients,
  getCommitments,
  getMonthlyTouches,
  getOpportunities,
} from "../src/lib/mtos-data";
import {
  clientsCollectionPath,
  commitmentsCollectionPath,
  monthlyTouchesCollectionPath,
  opportunitiesCollectionPath,
  tenantPath,
} from "../src/lib/server/firebase/collections";

function normalizePrivateKey(privateKey?: string) {
  return privateKey?.replace(/\\n/g, "\n");
}

async function main() {
  loadEnvConfig(process.cwd());

  const tenantId = process.env.MTOS_PILOT_TENANT_ID || "tenant-map-ranking-demo";
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY");
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

  const db = getFirestore();

  await db.doc(tenantPath(tenantId)).set(
    {
      id: tenantId,
      createdAt: new Date().toISOString(),
      name: "MTOS Pilot",
    },
    { merge: true },
  );

  const clients = getClients();
  const touches = getMonthlyTouches();
  const commitments = getCommitments();
  const opportunities = getOpportunities();

  const batch = db.batch();

  for (const client of clients) {
    const ref = db.collection(clientsCollectionPath(tenantId)).doc(client.id);
    batch.set(ref, client, { merge: true });
  }

  for (const touch of touches) {
    const ref = db.collection(monthlyTouchesCollectionPath(tenantId)).doc(touch.id);
    batch.set(ref, touch, { merge: true });
  }

  for (const commitment of commitments) {
    const ref = db.collection(commitmentsCollectionPath(tenantId)).doc(commitment.id);
    batch.set(ref, commitment, { merge: true });
  }

  for (const opportunity of opportunities) {
    const ref = db.collection(opportunitiesCollectionPath(tenantId)).doc(opportunity.id);
    batch.set(ref, opportunity, { merge: true });
  }

  await batch.commit();
  console.log(`Seeded tenant ${tenantId} (clients=${clients.length}, touches=${touches.length})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
