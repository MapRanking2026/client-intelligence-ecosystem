import { MonthlyAuditV1 } from "@/src/lib/domain/monthly-audit";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoMonthlyAudits";

export interface MonthlyAuditRepo {
  listByProject(tenantId: string, projectId: string): Promise<MonthlyAuditV1[]>;
  get(tenantId: string, id: string): Promise<MonthlyAuditV1 | null>;
  findByPeriod(tenantId: string, projectId: string, period: string): Promise<MonthlyAuditV1 | null>;
  save(audit: MonthlyAuditV1): Promise<MonthlyAuditV1>;
}

class InMemoryMonthlyAuditRepo implements MonthlyAuditRepo {
  async listByProject(tenantId: string, projectId: string) {
    return seedStore.monthlyAudits
      .filter((a) => a.tenantId === tenantId && a.projectId === projectId)
      .sort((a, b) => (a.period < b.period ? 1 : -1));
  }
  async get(tenantId: string, id: string) {
    return seedStore.monthlyAudits.find((a) => a.tenantId === tenantId && a.id === id) ?? null;
  }
  async findByPeriod(tenantId: string, projectId: string, period: string) {
    return (
      seedStore.monthlyAudits.find(
        (a) => a.tenantId === tenantId && a.projectId === projectId && a.period === period,
      ) ?? null
    );
  }
  async save(audit: MonthlyAuditV1) {
    const idx = seedStore.monthlyAudits.findIndex(
      (a) => a.tenantId === audit.tenantId && a.id === audit.id,
    );
    if (idx >= 0) seedStore.monthlyAudits[idx] = audit;
    else seedStore.monthlyAudits.push(audit);
    return audit;
  }
}

class FirestoreMonthlyAuditRepo implements MonthlyAuditRepo {
  async listByProject(tenantId: string, projectId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION)
      .where("projectId", "==", projectId)
      .get();
    return snap.docs
      .map((d) => MonthlyAuditV1.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data)
      .sort((a, b) => (a.period < b.period ? 1 : -1));
  }
  async get(tenantId: string, id: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(id).get();
    if (!snap.exists) return null;
    const parsed = MonthlyAuditV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async findByPeriod(tenantId: string, projectId: string, period: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION)
      .where("projectId", "==", projectId)
      .where("period", "==", period)
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (!doc) return null;
    const parsed = MonthlyAuditV1.safeParse(doc.data());
    return parsed.success ? parsed.data : null;
  }
  async save(audit: MonthlyAuditV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, audit.tenantId, COLLECTION).doc(audit.id).set(audit);
    return audit;
  }
}

export function getMonthlyAuditRepo(): MonthlyAuditRepo {
  return getFirebaseAdminDb()
    ? new FirestoreMonthlyAuditRepo()
    : new InMemoryMonthlyAuditRepo();
}
