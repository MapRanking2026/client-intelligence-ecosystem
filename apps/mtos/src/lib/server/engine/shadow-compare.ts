import { clientKey } from "@cie/engine";
import type { ClientV1 } from "@cie/contracts";

import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { engineTenantId, getEngineStore, getEngineStoreLabel } from "@/src/lib/server/engine/engine-store";
import { clientsCollectionPath, tenantPath } from "@/src/lib/server/firebase/collections";
import { getServerEnv } from "@/src/lib/server/env";

/**
 * Phase 3b shadow: compare MTOS's own client records against the Client
 * Intelligence Engine's canonical clients WITHOUT changing any read path or what
 * users see. Purely observational — it reads both sides, records how well they
 * line up, and stores a report. Nothing here feeds the live UI. Rollback is
 * simply not running it. MTOS clients come from MTOS's own Firestore; the engine
 * canonical clients come from the (possibly dedicated) engine store.
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
  /** MTOS's own Firebase project. */
  mtosProjectId: string;
  /** The engine store MTOS read (e.g. "supabase:xxx" or "firebase:project") — compare with SEOOS's. */
  engineStore: string;
  /** Whether MTOS could read any canonical clients from the shared engine store. */
  canSeeEngine: boolean;
  /** Diagnostic: which tenant_id partitions actually hold canonical clients in the store. */
  engineTenantsPresent: string[];
  /** The shared engine tenant key MTOS is reading under. */
  engineTenantKey: string;
  mtosClients: number;
  engineClients: number;
  engineClientsFromHealthTracker: number;
  matched: number;
  onlyInMtos: Array<{ id: string; name: string }>;
  onlyInEngine: Array<{ id: string; businessName: string }>;
  fieldDiffs: Array<{ clientId: string; name: string; field: string; mtos: string; engine: string }>;
}

const norm = (v?: string) => (v ?? "").toString().trim();
const eqi = (a?: string, b?: string) => norm(a).toLowerCase() === norm(b).toLowerCase();
const CAP = 100;

export async function runMtosEngineShadow(tenantId: string): Promise<MtosShadowReport> {
  const db = getFirebaseAdminDb();
  const generatedAt = new Date().toISOString();
  const mtosProjectId = getServerEnv().firebaseProjectId;
  const engineStore = getEngineStoreLabel();
  const engineTenantKey = engineTenantId();
  if (!db) {
    return {
      generatedAt,
      tenantId,
      mtosProjectId,
      engineStore,
      canSeeEngine: false,
      engineTenantsPresent: [],
      engineTenantKey,
      mtosClients: 0,
      engineClients: 0,
      engineClientsFromHealthTracker: 0,
      matched: 0,
      onlyInMtos: [],
      onlyInEngine: [],
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

  // Engine canonical clients (shared store — Supabase or a dedicated Firebase
  // project — under the shared engine tenant key, which both apps agree on).
  const engineStoreRef = getEngineStore();
  let engineTenantsPresent: string[] = [];
  try {
    engineTenantsPresent = (await engineStoreRef.listTenantIds?.()) ?? [];
  } catch {
    engineTenantsPresent = [];
  }
  let canonical: ClientV1[] = [];
  try {
    canonical = await engineStoreRef.listClients(engineTenantKey);
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
        fieldDiffs.push({ clientId: m.id, name: norm(m.name), field: "businessName", mtos: norm(m.name), engine: norm(hit.businessName) });
    }
    if (norm(m.accountManager) && norm(hit.accountManager) && !eqi(m.accountManager, hit.accountManager)) {
      if (fieldDiffs.length < CAP)
        fieldDiffs.push({ clientId: m.id, name: norm(m.name), field: "accountManager", mtos: norm(m.accountManager), engine: norm(hit.accountManager) });
    }
    const engineLocs = (hit.locations ?? []).map((l) => l.toLowerCase());
    if (norm(m.location) && engineLocs.length && !engineLocs.includes(norm(m.location).toLowerCase())) {
      if (fieldDiffs.length < CAP)
        fieldDiffs.push({ clientId: m.id, name: norm(m.name), field: "location", mtos: norm(m.location), engine: (hit.locations ?? []).join(", ") });
    }
  }

  // Canonical clients that MTOS's list should contain (they came from the Health
  // Tracker) but didn't match any MTOS client.
  const onlyInEngine: MtosShadowReport["onlyInEngine"] = [];
  let engineClientsFromHealthTracker = 0;
  for (const c of canonical) {
    const fromHealth = c.sources?.includes("clickup:health-tracker");
    if (fromHealth) engineClientsFromHealthTracker += 1;
    if (fromHealth && !matchedCanonical.has(c.id) && onlyInEngine.length < CAP) {
      onlyInEngine.push({ id: c.id, businessName: c.businessName });
    }
  }

  const report: MtosShadowReport = {
    generatedAt,
    tenantId,
    mtosProjectId,
    engineStore,
    canSeeEngine: canonical.length > 0,
    engineTenantsPresent,
    engineTenantKey,
    mtosClients: mtosClients.length,
    engineClients: canonical.length,
    engineClientsFromHealthTracker,
    matched,
    onlyInMtos,
    onlyInEngine,
    fieldDiffs,
  };

  // Store the latest report in MTOS's own meta namespace (not client data).
  await db.doc(`${tenantPath(tenantId)}/engineMeta/mtosShadow`).set(report);
  return report;
}

export async function getLatestMtosEngineShadow(tenantId: string): Promise<MtosShadowReport | null> {
  const db = getFirebaseAdminDb();
  if (!db) return null;
  const snap = await db.doc(`${tenantPath(tenantId)}/engineMeta/mtosShadow`).get();
  return snap.exists ? (snap.data() as MtosShadowReport) : null;
}
