import { RecommendationV1 } from "@/src/lib/domain/recommendation";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoRecommendations";

export interface RecommendationRepo {
  listByProject(tenantId: string, projectId: string): Promise<RecommendationV1[]>;
  get(tenantId: string, id: string): Promise<RecommendationV1 | null>;
  save(rec: RecommendationV1): Promise<RecommendationV1>;
}

class InMemoryRecommendationRepo implements RecommendationRepo {
  async listByProject(tenantId: string, projectId: string) {
    return seedStore.recommendations
      .filter((r) => r.tenantId === tenantId && r.projectId === projectId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async get(tenantId: string, id: string) {
    return seedStore.recommendations.find((r) => r.tenantId === tenantId && r.id === id) ?? null;
  }
  async save(rec: RecommendationV1) {
    const idx = seedStore.recommendations.findIndex(
      (r) => r.tenantId === rec.tenantId && r.id === rec.id,
    );
    if (idx >= 0) seedStore.recommendations[idx] = rec;
    else seedStore.recommendations.push(rec);
    return rec;
  }
}

class FirestoreRecommendationRepo implements RecommendationRepo {
  async listByProject(tenantId: string, projectId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION)
      .where("projectId", "==", projectId)
      .get();
    return snap.docs
      .map((d) => RecommendationV1.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async get(tenantId: string, id: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(id).get();
    if (!snap.exists) return null;
    const parsed = RecommendationV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async save(rec: RecommendationV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, rec.tenantId, COLLECTION).doc(rec.id).set(rec);
    return rec;
  }
}

export function getRecommendationRepo(): RecommendationRepo {
  return getFirebaseAdminDb()
    ? new FirestoreRecommendationRepo()
    : new InMemoryRecommendationRepo();
}
