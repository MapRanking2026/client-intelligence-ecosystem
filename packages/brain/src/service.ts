import {
  ClientReconciliationReportV1,
  ClientV1,
  NormalizedClientInput,
} from "@cie/contracts";

import { reconcileClients } from "./reconcile";
import type { ClientBrainStore } from "./repo";

/**
 * The Client Brain service — the ONE way apps read/refresh client truth.
 * Construct it with a store (Firestore-backed in prod, in-memory in dev/tests).
 * Phase 1 is read + ingest-reconcile; write-back to external systems arrives in
 * a later phase and always stays approval-gated.
 */
export class ClientBrain {
  constructor(private readonly store: ClientBrainStore) {}

  /** One canonical client (null if unknown to the brain). */
  getClient(tenantId: string, id: string): Promise<ClientV1 | null> {
    return this.store.getClient(tenantId, id);
  }

  /** Every canonical client for a tenant. */
  listClients(tenantId: string): Promise<ClientV1[]> {
    return this.store.listClients(tenantId);
  }

  /** The most recent ingest+reconcile report (null if never run). */
  getLatestReport(tenantId: string): Promise<ClientReconciliationReportV1 | null> {
    return this.store.getLatestReport(tenantId);
  }

  /**
   * Ingest normalized source records, reconcile them into canonical clients,
   * persist the clients + the report, and return the report. Deterministic given
   * the same inputs and `now`. No external side effects — read-only upstream.
   */
  async ingestAndReconcile(
    tenantId: string,
    inputs: NormalizedClientInput[],
    opts: { now: string },
  ): Promise<ClientReconciliationReportV1> {
    const { clients, report } = reconcileClients(inputs, { tenantId, now: opts.now });
    await this.store.saveClients(clients);
    await this.store.saveReport(report);
    return report;
  }
}
