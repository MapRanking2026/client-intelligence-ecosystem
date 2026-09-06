import { SpecialistStyleV1 } from "@/src/lib/domain/specialist-style";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoSpecialistStyles";

export interface SpecialistStyleRepo {
  get(tenantId: string, specialistId: string): Promise<SpecialistStyleV1 | null>;
  save(style: SpecialistStyleV1): Promise<SpecialistStyleV1>;
}

class InMemoryStyleRepo implements SpecialistStyleRepo {
  async get(tenantId: string, specialistId: string) {
    return seedStore.specialistStyles.find((s) => s.tenantId === tenantId && s.specialistId === specialistId) ?? null;
  }
  async save(style: SpecialistStyleV1) {
    const i = seedStore.specialistStyles.findIndex((s) => s.tenantId === style.tenantId && s.specialistId === style.specialistId);
    if (i >= 0) seedStore.specialistStyles[i] = style; else seedStore.specialistStyles.push(style);
    return style;
  }
}

class FirestoreStyleRepo implements SpecialistStyleRepo {
  async get(tenantId: string, specialistId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(specialistId).get();
    if (!snap.exists) return null;
    const parsed = SpecialistStyleV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async save(style: SpecialistStyleV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, style.tenantId, COLLECTION).doc(style.specialistId).set(style);
    return style;
  }
}

export function getSpecialistStyleRepo(): SpecialistStyleRepo {
  return getFirebaseAdminDb() ? new FirestoreStyleRepo() : new InMemoryStyleRepo();
}
