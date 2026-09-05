import { IntegrationConnectionV1 } from "@/src/lib/domain/integration";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoIntegrations";

export interface IntegrationRepo {
  list(tenantId: string): Promise<IntegrationConnectionV1[]>;
  get(tenantId: string, providerId: string): Promise<IntegrationConnectionV1 | null>;
  save(conn: IntegrationConnectionV1): Promise<IntegrationConnectionV1>;
  remove(tenantId: string, providerId: string): Promise<void>;
}

class InMemoryIntegrationRepo implements IntegrationRepo {
  async list(tenantId: string) {
    return seedStore.integrations.filter((c) => c.tenantId === tenantId);
  }
  async get(tenantId: string, providerId: string) {
    return (
      seedStore.integrations.find((c) => c.tenantId === tenantId && c.providerId === providerId) ?? null
    );
  }
  async save(conn: IntegrationConnectionV1) {
    const idx = seedStore.integrations.findIndex(
      (c) => c.tenantId === conn.tenantId && c.providerId === conn.providerId,
    );
    if (idx >= 0) seedStore.integrations[idx] = conn;
    else seedStore.integrations.push(conn);
    return conn;
  }
  async remove(tenantId: string, providerId: string) {
    seedStore.integrations = seedStore.integrations.filter(
      (c) => !(c.tenantId === tenantId && c.providerId === providerId),
    );
  }
}

class FirestoreIntegrationRepo implements IntegrationRepo {
  async list(tenantId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION).get();
    return snap.docs
      .map((d) => IntegrationConnectionV1.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data);
  }
  async get(tenantId: string, providerId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(providerId).get();
    if (!snap.exists) return null;
    const parsed = IntegrationConnectionV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async save(conn: IntegrationConnectionV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, conn.tenantId, COLLECTION).doc(conn.providerId).set(conn);
    return conn;
  }
  async remove(tenantId: string, providerId: string) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, tenantId, COLLECTION).doc(providerId).delete();
  }
}

export function getIntegrationRepo(): IntegrationRepo {
  return getFirebaseAdminDb() ? new FirestoreIntegrationRepo() : new InMemoryIntegrationRepo();
}
