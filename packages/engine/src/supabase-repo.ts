import type { SupabaseClient } from "@supabase/supabase-js";

import { ClientReconciliationReportV1, ClientV1 } from "@cie/contracts";
import type { ClientEngineStore } from "./repo";

/**
 * Supabase (Postgres) implementation of the engine store — the neutral, shared
 * home for canonical clients that both MTOS and SEOOS connect to. The Supabase
 * client is INJECTED by the app (created with the service-role key, server-side
 * only); the package never holds secrets.
 *
 * Schema (see the setup SQL): canonical_clients(tenant_id, id, data jsonb,
 * updated_at) PK(tenant_id,id); engine_reports(tenant_id PK, data jsonb, updated_at).
 */
const CLIENTS = "canonical_clients";
const REPORTS = "engine_reports";

export class SupabaseClientStore implements ClientEngineStore {
  constructor(private readonly db: SupabaseClient) {}

  async getClient(tenantId: string, id: string): Promise<ClientV1 | null> {
    const { data, error } = await this.db
      .from(CLIENTS)
      .select("data")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`engine store getClient: ${error.message}`);
    if (!data) return null;
    const parsed = ClientV1.safeParse((data as { data: unknown }).data);
    return parsed.success ? parsed.data : null;
  }

  async listClients(tenantId: string): Promise<ClientV1[]> {
    const out: ClientV1[] = [];
    // Page through so a large roster isn't capped by the default row limit.
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db
        .from(CLIENTS)
        .select("data")
        .eq("tenant_id", tenantId)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`engine store listClients: ${error.message}`);
      const rows = (data ?? []) as Array<{ data: unknown }>;
      for (const r of rows) {
        const parsed = ClientV1.safeParse(r.data);
        if (parsed.success) out.push(parsed.data);
      }
      if (rows.length < PAGE) break;
    }
    return out;
  }

  async saveClients(clients: ClientV1[]): Promise<void> {
    for (let i = 0; i < clients.length; i += 500) {
      const rows = clients.slice(i, i + 500).map((c) => ({
        tenant_id: c.tenantId,
        id: c.id,
        data: c,
        updated_at: c.updatedAt,
      }));
      const { error } = await this.db.from(CLIENTS).upsert(rows, { onConflict: "tenant_id,id" });
      if (error) throw new Error(`engine store saveClients: ${error.message}`);
    }
  }

  async saveReport(report: ClientReconciliationReportV1): Promise<void> {
    const { error } = await this.db
      .from(REPORTS)
      .upsert(
        { tenant_id: report.tenantId, data: report, updated_at: report.generatedAt },
        { onConflict: "tenant_id" },
      );
    if (error) throw new Error(`engine store saveReport: ${error.message}`);
  }

  /** Diagnostic: which tenant_id partitions actually hold canonical clients. */
  async listTenantIds(): Promise<string[]> {
    const { data, error } = await this.db.from(CLIENTS).select("tenant_id").limit(5000);
    if (error) throw new Error(`engine store listTenantIds: ${error.message}`);
    return [...new Set((data ?? []).map((r) => (r as { tenant_id: string }).tenant_id))].sort();
  }

  async getLatestReport(tenantId: string): Promise<ClientReconciliationReportV1 | null> {
    const { data, error } = await this.db
      .from(REPORTS)
      .select("data")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(`engine store getLatestReport: ${error.message}`);
    if (!data) return null;
    const parsed = ClientReconciliationReportV1.safeParse((data as { data: unknown }).data);
    return parsed.success ? parsed.data : null;
  }
}
