import type { Firestore } from "firebase-admin/firestore";

import { ClientReconciliationReportV1, ClientV1 } from "@cie/contracts";

/**
 * The Client Brain's system-of-record store. The brain owns these collections;
 * apps never touch them directly — they go through ClientBrain (service.ts).
 * Path: tenants/{tenantId}/clients/{id}; last report at tenants/{tenantId}/brainMeta.
 */
export interface ClientBrainStore {
  getClient(tenantId: string, id: string): Promise<ClientV1 | null>;
  listClients(tenantId: string): Promise<ClientV1[]>;
  saveClients(clients: ClientV1[]): Promise<void>;
  saveReport(report: ClientReconciliationReportV1): Promise<void>;
  getLatestReport(tenantId: string): Promise<ClientReconciliationReportV1 | null>;
}

const CLIENTS = "clients";
const META = "brainMeta";
const LAST_REPORT = "lastReconciliation";

/** In-memory store for local dev / tests (no Firestore). */
export class InMemoryClientStore implements ClientBrainStore {
  private clients = new Map<string, ClientV1>();
  private reports = new Map<string, ClientReconciliationReportV1>();
  private ck(t: string, id: string) {
    return `${t}::${id}`;
  }
  async getClient(tenantId: string, id: string) {
    return this.clients.get(this.ck(tenantId, id)) ?? null;
  }
  async listClients(tenantId: string) {
    return [...this.clients.values()].filter((c) => c.tenantId === tenantId);
  }
  async saveClients(clients: ClientV1[]) {
    for (const c of clients) this.clients.set(this.ck(c.tenantId, c.id), c);
  }
  async saveReport(report: ClientReconciliationReportV1) {
    this.reports.set(report.tenantId, report);
  }
  async getLatestReport(tenantId: string) {
    return this.reports.get(tenantId) ?? null;
  }
}

/**
 * Firestore-backed store. The Firestore instance is INJECTED by the app (the
 * brain never initializes Firebase itself), keeping it a shared module with the
 * boundary enforced in code. The injected db should have
 * `ignoreUndefinedProperties` enabled (both apps do).
 */
export class FirestoreClientStore implements ClientBrainStore {
  constructor(private readonly db: Firestore) {}

  private clientsCol(tenantId: string) {
    return this.db.collection("tenants").doc(tenantId).collection(CLIENTS);
  }

  async getClient(tenantId: string, id: string) {
    const snap = await this.clientsCol(tenantId).doc(id).get();
    if (!snap.exists) return null;
    const parsed = ClientV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }

  async listClients(tenantId: string) {
    const snap = await this.clientsCol(tenantId).get();
    return snap.docs
      .map((d) => ClientV1.safeParse(d.data()))
      .filter((r): r is { success: true; data: ClientV1 } => r.success)
      .map((r) => r.data);
  }

  async saveClients(clients: ClientV1[]) {
    // Firestore caps a batch at 500 writes.
    for (let i = 0; i < clients.length; i += 450) {
      const batch = this.db.batch();
      for (const c of clients.slice(i, i + 450)) {
        batch.set(this.clientsCol(c.tenantId).doc(c.id), c);
      }
      await batch.commit();
    }
  }

  async saveReport(report: ClientReconciliationReportV1) {
    await this.db
      .collection("tenants")
      .doc(report.tenantId)
      .collection(META)
      .doc(LAST_REPORT)
      .set(report);
  }

  async getLatestReport(tenantId: string) {
    const snap = await this.db
      .collection("tenants")
      .doc(tenantId)
      .collection(META)
      .doc(LAST_REPORT)
      .get();
    if (!snap.exists) return null;
    const parsed = ClientReconciliationReportV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
}
