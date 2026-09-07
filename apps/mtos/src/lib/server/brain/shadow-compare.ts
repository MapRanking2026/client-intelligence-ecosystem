import { FirestoreClientStore, clientKey } from "@cie/brain";
import type { ClientV1 } from "@cie/contracts";

import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { clientsCollectionPath, tenantPath } from "@/src/lib/server/firebase/collections";

/**
 * Phase 3b shadow: compare MTOS's own client records against the Client Brain's
 * canonical clients WITHOUT changing any read path or what users see. Purely
 * observational — it reads both sides, records how well they line up, and stores
 * a report. Nothing here feeds the live UI. Rollback is simply not running it.
 */

interface MtosClientLite {
  id: string;
  name?: string;
  accountManager?: string;
  location?: string;
  clickupTaskId?: string;
}

export interface MtosShadowReport {
  generatedAt: string;
  tenantId: string;
  /** Whether MTOS could read any canonical clients from the shared brain store. */
  canSeeBrain: boolean;
  mtosClients: number;
  brainClients: number;
  brainClientsFromHealthTracker: number;
  matched: number;
  onlyInMtos: Array<{ id: string; name: string }>;
  onlyInBrain: Array<{ id: string; businessName: string }>;
  fieldDiffs: Array<{ clientId: string; name: string; field: string; mtos: string; brain: string }>;
}

const norm = (v?: string) => (v ?? "").toString().trim();
const eqi = (a?: string, b?: string) => norm(a).toLowerCase() === norm(b).toLowerCase();
const CAP = 100;

export async function runMtosBrainShadow(tenantId: string): Promise<MtosShadowReport> {
  const db = getFirebaseAdminDb();
  const generatedAt = new Date().toISOString();
  if (!db) {
    return {
      generatedAt,
      tenantId,
      canSeeBrain: false,
      mtosClients: 0,
      brainClients: 0,
      brainClientsFromHealthTracker: 0,
      matched: 0,
      onlyInMtos: [],
      onlyInBrain: [],
      fieldDiffs: [],
    };
  }

  // MTOS clients — read tenant-wide (unfiltered by per-user visibility) so this
  // reflects the whole roster, not one manager's slice.
  const mtosSnap = await db.collection(clientsCollectionPath(tenantId)).get();
  const mtosClients: MtosClientLite[] = mtosSnap.docs.map((d) => {
    const x = d.data() as Record<string, unknown>;
    return {
      id: String(x.id ?? d.id),
      name: x.name as string | undefined,
      accountManager: x.accountManager as string | undefined,
      location: x.location as string | undefined,
      clickupTaskId: x.clickupTaskId as string | undefined,
    };
  });

  // Brain canonical clients (shared store, injected Firestore).
  let canonical: ClientV1[] = [];
  try {
    canonical = await new FirestoreClientStore(db).listClients(tenantId);
  } catch {
    canonical = [];
  }

  // Index canonical by its Health Tracker source id and by name-slug.
  const byHealthId = new Map<string, ClientV1>();
  const bySlug = new Map<string, ClientV1>();
  for (const c of canonical) {
    const hid = c.externalIds?.["clickup:health-tracker:id"];
    if (hid) byHealthId.set(hid, c);
    bySlug.set(c.id, c); // c.id is already clientKey(businessName)
  }

  const matchedCanonical = new Set<string>();
  const onlyInMtos: MtosShadowReport["onlyInMtos"] = [];
  const fieldDiffs: MtosShadowReport["fieldDiffs"] = [];
  let matched = 0;

  for (const m of mtosClients) {
    const key = m.clickupTaskId || m.id;
    const hit = (key && byHealthId.get(key)) || bySlug.get(clientKey(m.name ?? "")) || null;
    if (!hit) {
      if (onlyInMtos.length < CAP) onlyInMtos.push({ id: m.id, name: norm(m.name) });
      continue;
    }
    matched += 1;
    matchedCanonical.add(hit.id);

    // Compare the identity subset both sides carry. Only flag when BOTH have a
    // non-empty value that differs — a gap on one side isn't a conflict.
    if (norm(m.name) && norm(hit.businessName) && !eqi(m.name, hit.businessName)) {
      if (fieldDiffs.length < CAP)
        fieldDiffs.push({ clientId: m.id, name: norm(m.name), field: "businessName", mtos: norm(m.name), brain: norm(hit.businessName) });
    }
    if (norm(m.accountManager) && norm(hit.accountManager) && !eqi(m.accountManager, hit.accountManager)) {
      if (fieldDiffs.length < CAP)
        fieldDiffs.push({ clientId: m.id, name: norm(m.name), field: "accountManager", mtos: norm(m.accountManager), brain: norm(hit.accountManager) });
    }
    const brainLocs = (hit.locations ?? []).map((l) => l.toLowerCase());
    if (norm(m.location) && brainLocs.length && !brainLocs.includes(norm(m.location).toLowerCase())) {
      if (fieldDiffs.length < CAP)
        fieldDiffs.push({ clientId: m.id, name: norm(m.name), field: "location", mtos: norm(m.location), brain: (hit.locations ?? []).join(", ") });
    }
  }

  // Canonical clients that MTOS's list should contain (they came from the Health
  // Tracker) but didn't match any MTOS client.
  const onlyInBrain: MtosShadowReport["onlyInBrain"] = [];
  let brainClientsFromHealthTracker = 0;
  for (const c of canonical) {
    const fromHealth = c.sources?.includes("clickup:health-tracker");
    if (fromHealth) brainClientsFromHealthTracker += 1;
    if (fromHealth && !matchedCanonical.has(c.id) && onlyInBrain.length < CAP) {
      onlyInBrain.push({ id: c.id, businessName: c.businessName });
    }
  }

  const report: MtosShadowReport = {
    generatedAt,
    tenantId,
    canSeeBrain: canonical.length > 0,
    mtosClients: mtosClients.length,
    brainClients: canonical.length,
    brainClientsFromHealthTracker,
    matched,
    onlyInMtos,
    onlyInBrain,
    fieldDiffs,
  };

  // Store the latest report (brain's meta namespace — not MTOS's client data).
  await db.doc(`${tenantPath(tenantId)}/brainMeta/mtosShadow`).set(report);
  return report;
}

export async function getLatestMtosBrainShadow(tenantId: string): Promise<MtosShadowReport | null> {
  const db = getFirebaseAdminDb();
  if (!db) return null;
  const snap = await db.doc(`${tenantPath(tenantId)}/brainMeta/mtosShadow`).get();
  return snap.exists ? (snap.data() as MtosShadowReport) : null;
}
