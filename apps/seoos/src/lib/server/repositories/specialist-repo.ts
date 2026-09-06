import { SpecialistV1 } from "@/src/lib/domain/specialist";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoSpecialists";

export interface SpecialistRepo {
  list(tenantId: string): Promise<SpecialistV1[]>;
  get(tenantId: string, id: string): Promise<SpecialistV1 | null>;
  save(specialist: SpecialistV1): Promise<SpecialistV1>;
  remove(tenantId: string, id: string): Promise<void>;
}

class InMemorySpecialistRepo implements SpecialistRepo {
  async list(tenantId: string) {
    return seedStore.specialists.filter((s) => s.tenantId === tenantId);
  }
  async get(tenantId: string, id: string) {
    return seedStore.specialists.find((s) => s.tenantId === tenantId && s.id === id) ?? null;
  }
  async save(specialist: SpecialistV1) {
    const idx = seedStore.specialists.findIndex(
      (s) => s.tenantId === specialist.tenantId && s.id === specialist.id,
    );
    if (idx >= 0) seedStore.specialists[idx] = specialist;
    else seedStore.specialists.push(specialist);
    return specialist;
  }
  async remove(tenantId: string, id: string) {
    seedStore.specialists = seedStore.specialists.filter(
      (s) => !(s.tenantId === tenantId && s.id === id),
    );
  }
}

class FirestoreSpecialistRepo implements SpecialistRepo {
  async list(tenantId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION).get();
    return snap.docs
      .map((d) => SpecialistV1.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data);
  }
  async get(tenantId: string, id: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(id).get();
    if (!snap.exists) return null;
    const parsed = SpecialistV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async save(specialist: SpecialistV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, specialist.tenantId, COLLECTION).doc(specialist.id).set(specialist);
    return specialist;
  }
  async remove(tenantId: string, id: string) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, tenantId, COLLECTION).doc(id).delete();
  }
}

export function getSpecialistRepo(): SpecialistRepo {
  return getFirebaseAdminDb() ? new FirestoreSpecialistRepo() : new InMemorySpecialistRepo();
}
