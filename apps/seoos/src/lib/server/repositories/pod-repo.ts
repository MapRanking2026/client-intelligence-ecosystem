import { SeoPodV1 } from "@/src/lib/domain/pod";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoPods";

export interface PodRepo {
  list(tenantId: string): Promise<SeoPodV1[]>;
  get(tenantId: string, podKey: string): Promise<SeoPodV1 | null>;
  save(pod: SeoPodV1): Promise<SeoPodV1>;
}

class InMemoryPodRepo implements PodRepo {
  async list(tenantId: string) {
    return seedStore.pods.filter((p) => p.tenantId === tenantId);
  }
  async get(tenantId: string, podKey: string) {
    return seedStore.pods.find((p) => p.tenantId === tenantId && p.podKey === podKey) ?? null;
  }
  async save(pod: SeoPodV1) {
    const idx = seedStore.pods.findIndex((p) => p.tenantId === pod.tenantId && p.podKey === pod.podKey);
    if (idx >= 0) seedStore.pods[idx] = pod;
    else seedStore.pods.push(pod);
    return pod;
  }
}

class FirestorePodRepo implements PodRepo {
  async list(tenantId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION).get();
    return snap.docs
      .map((d) => SeoPodV1.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data);
  }
  async get(tenantId: string, podKey: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(podKey).get();
    if (!snap.exists) return null;
    const parsed = SeoPodV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async save(pod: SeoPodV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, pod.tenantId, COLLECTION).doc(pod.podKey).set(pod);
    return pod;
  }
}

export function getPodRepo(): PodRepo {
  return getFirebaseAdminDb() ? new FirestorePodRepo() : new InMemoryPodRepo();
}
