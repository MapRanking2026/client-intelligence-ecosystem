import { WorkOrderV1 } from "@/src/lib/domain/work-order";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoWorkOrders";

export interface WorkOrderRepo {
  listByProject(tenantId: string, projectId: string): Promise<WorkOrderV1[]>;
  listByTenant(tenantId: string): Promise<WorkOrderV1[]>;
  get(tenantId: string, id: string): Promise<WorkOrderV1 | null>;
  save(wo: WorkOrderV1): Promise<WorkOrderV1>;
}

class InMemoryWorkOrderRepo implements WorkOrderRepo {
  async listByProject(tenantId: string, projectId: string) {
    return seedStore.workOrders
      .filter((w) => w.tenantId === tenantId && w.projectId === projectId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
  async listByTenant(tenantId: string) {
    return seedStore.workOrders
      .filter((w) => w.tenantId === tenantId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
  async get(tenantId: string, id: string) {
    return seedStore.workOrders.find((w) => w.tenantId === tenantId && w.id === id) ?? null;
  }
  async save(wo: WorkOrderV1) {
    const idx = seedStore.workOrders.findIndex(
      (w) => w.tenantId === wo.tenantId && w.id === wo.id,
    );
    if (idx >= 0) seedStore.workOrders[idx] = wo;
    else seedStore.workOrders.push(wo);
    return wo;
  }
}

class FirestoreWorkOrderRepo implements WorkOrderRepo {
  private async query(tenantId: string, projectId?: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    let ref = tenantCollection(db, tenantId, COLLECTION) as FirebaseFirestore.Query;
    if (projectId) ref = ref.where("projectId", "==", projectId);
    const snap = await ref.get();
    return snap.docs
      .map((d) => WorkOrderV1.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
  async listByProject(tenantId: string, projectId: string) {
    return this.query(tenantId, projectId);
  }
  async listByTenant(tenantId: string) {
    return this.query(tenantId);
  }
  async get(tenantId: string, id: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(id).get();
    if (!snap.exists) return null;
    const parsed = WorkOrderV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async save(wo: WorkOrderV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, wo.tenantId, COLLECTION).doc(wo.id).set(wo);
    return wo;
  }
}

export function getWorkOrderRepo(): WorkOrderRepo {
  return getFirebaseAdminDb()
    ? new FirestoreWorkOrderRepo()
    : new InMemoryWorkOrderRepo();
}
