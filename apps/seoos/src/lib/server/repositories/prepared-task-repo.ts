import { PreparedTaskV1 } from "@/src/lib/domain/prepared-task";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoPreparedTasks";

export interface PreparedTaskRepo {
  listByProject(tenantId: string, projectId: string): Promise<PreparedTaskV1[]>;
  listByTenant(tenantId: string): Promise<PreparedTaskV1[]>;
  get(tenantId: string, id: string): Promise<PreparedTaskV1 | null>;
  save(task: PreparedTaskV1): Promise<PreparedTaskV1>;
  saveMany(tasks: PreparedTaskV1[]): Promise<void>;
}

class InMemoryTaskRepo implements PreparedTaskRepo {
  async listByProject(tenantId: string, projectId: string) {
    return seedStore.preparedTasks.filter((t) => t.tenantId === tenantId && t.projectId === projectId);
  }
  async listByTenant(tenantId: string) {
    return seedStore.preparedTasks.filter((t) => t.tenantId === tenantId);
  }
  async get(tenantId: string, id: string) {
    return seedStore.preparedTasks.find((t) => t.tenantId === tenantId && t.id === id) ?? null;
  }
  async save(task: PreparedTaskV1) {
    const i = seedStore.preparedTasks.findIndex((t) => t.tenantId === task.tenantId && t.id === task.id);
    if (i >= 0) seedStore.preparedTasks[i] = task; else seedStore.preparedTasks.push(task);
    return task;
  }
  async saveMany(tasks: PreparedTaskV1[]) {
    for (const t of tasks) await this.save(t);
  }
}

class FirestoreTaskRepo implements PreparedTaskRepo {
  async listByProject(tenantId: string, projectId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION).where("projectId", "==", projectId).get();
    return snap.docs.map((d) => PreparedTaskV1.safeParse(d.data())).filter((r) => r.success).map((r) => r.data);
  }
  async listByTenant(tenantId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION).get();
    return snap.docs.map((d) => PreparedTaskV1.safeParse(d.data())).filter((r) => r.success).map((r) => r.data);
  }
  async get(tenantId: string, id: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(id).get();
    if (!snap.exists) return null;
    const parsed = PreparedTaskV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async save(task: PreparedTaskV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, task.tenantId, COLLECTION).doc(task.id).set(task);
    return task;
  }
  async saveMany(tasks: PreparedTaskV1[]) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    for (let i = 0; i < tasks.length; i += 450) {
      const batch = db.batch();
      for (const t of tasks.slice(i, i + 450)) {
        batch.set(tenantCollection(db, t.tenantId, COLLECTION).doc(t.id), t);
      }
      await batch.commit();
    }
  }
}

export function getPreparedTaskRepo(): PreparedTaskRepo {
  return getFirebaseAdminDb() ? new FirestoreTaskRepo() : new InMemoryTaskRepo();
}
