import { GbpAuditV1 } from "@/src/lib/domain/gbp-audit";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";

const COLLECTION = "seoGbpAudits";

export interface GbpAuditRepo {
  get(tenantId: string, projectId: string): Promise<GbpAuditV1 | null>;
  save(audit: GbpAuditV1): Promise<GbpAuditV1>;
}

/** In-memory fallback (dev only) — one latest audit per tenant+project. */
const mem = new Map<string, GbpAuditV1>();
const memKey = (t: string, p: string) => `${t}::${p}`;

class InMemoryGbpAuditRepo implements GbpAuditRepo {
  async get(tenantId: string, projectId: string) {
    return mem.get(memKey(tenantId, projectId)) ?? null;
  }
  async save(audit: GbpAuditV1) {
    mem.set(memKey(audit.tenantId, audit.projectId), audit);
    return audit;
  }
}

class FirestoreGbpAuditRepo implements GbpAuditRepo {
  async get(tenantId: string, projectId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(projectId).get();
    if (!snap.exists) return null;
    const parsed = GbpAuditV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async save(audit: GbpAuditV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, audit.tenantId, COLLECTION).doc(audit.projectId).set(audit);
    return audit;
  }
}

export function getGbpAuditRepo(): GbpAuditRepo {
  return getFirebaseAdminDb() ? new FirestoreGbpAuditRepo() : new InMemoryGbpAuditRepo();
}
