import { SeoPerformanceSnapshotV1 } from "@cie/contracts";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";

const COLLECTION = "seoPerformanceSnapshots";

/** Latest pulled SEO snapshot per project (from the MTOS gateway). */
export interface PerformanceSnapshotRepo {
  get(tenantId: string, projectId: string): Promise<SeoPerformanceSnapshotV1 | null>;
  save(tenantId: string, projectId: string, snapshot: SeoPerformanceSnapshotV1): Promise<void>;
}

const memory = new Map<string, SeoPerformanceSnapshotV1>();
const key = (t: string, p: string) => `${t}::${p}`;

class InMemorySnapshotRepo implements PerformanceSnapshotRepo {
  async get(tenantId: string, projectId: string) {
    return memory.get(key(tenantId, projectId)) ?? null;
  }
  async save(tenantId: string, projectId: string, snapshot: SeoPerformanceSnapshotV1) {
    memory.set(key(tenantId, projectId), snapshot);
  }
}

class FirestoreSnapshotRepo implements PerformanceSnapshotRepo {
  async get(tenantId: string, projectId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(projectId).get();
    if (!snap.exists) return null;
    const parsed = SeoPerformanceSnapshotV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async save(tenantId: string, projectId: string, snapshot: SeoPerformanceSnapshotV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, tenantId, COLLECTION).doc(projectId).set(snapshot);
  }
}

export function getPerformanceSnapshotRepo(): PerformanceSnapshotRepo {
  return getFirebaseAdminDb() ? new FirestoreSnapshotRepo() : new InMemorySnapshotRepo();
}
