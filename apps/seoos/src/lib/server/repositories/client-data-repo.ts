import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";

const COLLECTION = "seoClientData";

export interface SourceSyncResult {
  ok: boolean;
  syncedAt: string;
  summary?: string;
  error?: string;
  data?: unknown;
}

export interface ClientDataRecord {
  tenantId: string;
  projectId: string;
  syncedAt: string;
  sources: Record<string, SourceSyncResult>;
}

export interface ClientDataRepo {
  get(tenantId: string, projectId: string): Promise<ClientDataRecord | null>;
  save(record: ClientDataRecord): Promise<void>;
}

const memory = new Map<string, ClientDataRecord>();
const key = (t: string, p: string) => `${t}::${p}`;

class InMemoryClientDataRepo implements ClientDataRepo {
  async get(tenantId: string, projectId: string) {
    return memory.get(key(tenantId, projectId)) ?? null;
  }
  async save(record: ClientDataRecord) {
    memory.set(key(record.tenantId, record.projectId), record);
  }
}

class FirestoreClientDataRepo implements ClientDataRepo {
  async get(tenantId: string, projectId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(projectId).get();
    return snap.exists ? (snap.data() as ClientDataRecord) : null;
  }
  async save(record: ClientDataRecord) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, record.tenantId, COLLECTION).doc(record.projectId).set(record);
  }
}

export function getClientDataRepo(): ClientDataRepo {
  return getFirebaseAdminDb() ? new FirestoreClientDataRepo() : new InMemoryClientDataRepo();
}
