import { NicheStudyV1 } from "@/src/lib/domain/niche-study";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoNicheStudies";

export interface NicheStudyRepo {
  list(tenantId: string): Promise<NicheStudyV1[]>;
  save(study: NicheStudyV1): Promise<NicheStudyV1>;
  remove(tenantId: string, id: string): Promise<void>;
  findByDriveFileId(tenantId: string, driveFileId: string): Promise<NicheStudyV1 | null>;
}

class InMemoryNicheStudyRepo implements NicheStudyRepo {
  async list(tenantId: string) {
    return seedStore.nicheStudies.filter((s) => s.tenantId === tenantId);
  }
  async save(study: NicheStudyV1) {
    const idx = seedStore.nicheStudies.findIndex((s) => s.tenantId === study.tenantId && s.id === study.id);
    if (idx >= 0) seedStore.nicheStudies[idx] = study;
    else seedStore.nicheStudies.push(study);
    return study;
  }
  async remove(tenantId: string, id: string) {
    seedStore.nicheStudies = seedStore.nicheStudies.filter((s) => !(s.tenantId === tenantId && s.id === id));
  }
  async findByDriveFileId(tenantId: string, driveFileId: string) {
    return seedStore.nicheStudies.find((s) => s.tenantId === tenantId && s.driveFileId === driveFileId) ?? null;
  }
}

class FirestoreNicheStudyRepo implements NicheStudyRepo {
  async list(tenantId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION).get();
    return snap.docs.map((d) => NicheStudyV1.safeParse(d.data())).filter((r) => r.success).map((r) => r.data);
  }
  async save(study: NicheStudyV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, study.tenantId, COLLECTION).doc(study.id).set(study);
    return study;
  }
  async remove(tenantId: string, id: string) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, tenantId, COLLECTION).doc(id).delete();
  }
  async findByDriveFileId(tenantId: string, driveFileId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).where("driveFileId", "==", driveFileId).limit(1).get();
    const doc = snap.docs[0];
    if (!doc) return null;
    const parsed = NicheStudyV1.safeParse(doc.data());
    return parsed.success ? parsed.data : null;
  }
}

export function getNicheStudyRepo(): NicheStudyRepo {
  return getFirebaseAdminDb() ? new FirestoreNicheStudyRepo() : new InMemoryNicheStudyRepo();
}
