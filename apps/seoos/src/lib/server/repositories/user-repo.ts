import { SeoUserV1 } from "@/src/lib/domain/user";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoUsers";

export interface UserRepo {
  getByEmail(tenantId: string, email: string): Promise<SeoUserV1 | null>;
  getById(tenantId: string, userId: string): Promise<SeoUserV1 | null>;
  anyExists(tenantId: string): Promise<boolean>;
  save(user: SeoUserV1): Promise<SeoUserV1>;
}

const norm = (email: string) => email.trim().toLowerCase();

class InMemoryUserRepo implements UserRepo {
  async getByEmail(tenantId: string, email: string) {
    return (
      seedStore.users.find((u) => u.tenantId === tenantId && norm(u.email) === norm(email)) ?? null
    );
  }
  async getById(tenantId: string, userId: string) {
    return seedStore.users.find((u) => u.tenantId === tenantId && u.userId === userId) ?? null;
  }
  async anyExists(tenantId: string) {
    return seedStore.users.some((u) => u.tenantId === tenantId);
  }
  async save(user: SeoUserV1) {
    const idx = seedStore.users.findIndex((u) => u.tenantId === user.tenantId && u.userId === user.userId);
    if (idx >= 0) seedStore.users[idx] = user;
    else seedStore.users.push(user);
    return user;
  }
}

class FirestoreUserRepo implements UserRepo {
  async getByEmail(tenantId: string, email: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION)
      .where("email", "==", norm(email))
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (!doc) return null;
    const parsed = SeoUserV1.safeParse(doc.data());
    return parsed.success ? parsed.data : null;
  }
  async getById(tenantId: string, userId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(userId).get();
    if (!snap.exists) return null;
    const parsed = SeoUserV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async anyExists(tenantId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return false;
    const snap = await tenantCollection(db, tenantId, COLLECTION).limit(1).get();
    return !snap.empty;
  }
  async save(user: SeoUserV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, user.tenantId, COLLECTION)
      .doc(user.userId)
      .set({ ...user, email: norm(user.email) });
    return user;
  }
}

export function getUserRepo(): UserRepo {
  return getFirebaseAdminDb() ? new FirestoreUserRepo() : new InMemoryUserRepo();
}
