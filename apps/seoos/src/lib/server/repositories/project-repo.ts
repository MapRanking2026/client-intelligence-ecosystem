import { SeoProjectV1 } from "@/src/lib/domain/project";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { COLLECTIONS, tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

export interface ProjectRepo {
  list(tenantId: string): Promise<SeoProjectV1[]>;
  get(tenantId: string, projectId: string): Promise<SeoProjectV1 | null>;
  findByClient(
    tenantId: string,
    clientId: string,
  ): Promise<SeoProjectV1 | null>;
  save(project: SeoProjectV1): Promise<SeoProjectV1>;
}

class InMemoryProjectRepo implements ProjectRepo {
  async list(tenantId: string) {
    return seedStore.projects
      .filter((p) => p.tenantId === tenantId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
  async get(tenantId: string, projectId: string) {
    return (
      seedStore.projects.find(
        (p) => p.tenantId === tenantId && p.id === projectId,
      ) ?? null
    );
  }
  async findByClient(tenantId: string, clientId: string) {
    return (
      seedStore.projects.find(
        (p) => p.tenantId === tenantId && p.clientId === clientId,
      ) ?? null
    );
  }
  async save(project: SeoProjectV1) {
    const idx = seedStore.projects.findIndex(
      (p) => p.tenantId === project.tenantId && p.id === project.id,
    );
    if (idx >= 0) seedStore.projects[idx] = project;
    else seedStore.projects.push(project);
    return project;
  }
}

class FirestoreProjectRepo implements ProjectRepo {
  async list(tenantId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTIONS.projects)
      .orderBy("updatedAt", "desc")
      .get();
    return snap.docs
      .map((d) => SeoProjectV1.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data);
  }
  async get(tenantId: string, projectId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTIONS.projects)
      .doc(projectId)
      .get();
    if (!snap.exists) return null;
    const parsed = SeoProjectV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async findByClient(tenantId: string, clientId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTIONS.projects)
      .where("clientId", "==", clientId)
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (!doc) return null;
    const parsed = SeoProjectV1.safeParse(doc.data());
    return parsed.success ? parsed.data : null;
  }
  async save(project: SeoProjectV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, project.tenantId, COLLECTIONS.projects)
      .doc(project.id)
      .set(project);
    return project;
  }
}

export function getProjectRepo(): ProjectRepo {
  return getFirebaseAdminDb()
    ? new FirestoreProjectRepo()
    : new InMemoryProjectRepo();
}
