import Link from "next/link";
import { BriefcaseBusiness, ArrowRight } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { DataError } from "@/src/components/mtos/data-error";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import type { ClientRecord, OpportunityRecord } from "@/src/lib/mtos-data";

const STAGES: { key: OpportunityRecord["stage"]; tone: "info" | "watch" | "good" }[] = [
  { key: "Signal", tone: "info" },
  { key: "Qualified", tone: "watch" },
  { key: "Proposal", tone: "good" },
  { key: "Active", tone: "good" },
];

export default async function OpportunitiesPage() {
  const context = await resolveTenantContext();
  let clients: ClientRecord[];
  let opportunities: OpportunityRecord[];
  try {
    const ds = getMtosDataSource(context);
    [clients, opportunities] = await Promise.all([ds.getClients(), ds.getOpportunities()]);
  } catch {
    return (
      <AppShell>
        <DataError title="Couldn't load your opportunities" />
      </AppShell>
    );
  }

  const clientMap = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <AppShell>
      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <div className="eyebrow muted">
            <BriefcaseBusiness />
            <span>Opportunity engine · {opportunities.length} in pipeline</span>
          </div>
          <h2 className="h2 mt-2">Opportunities</h2>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-4">
        {STAGES.map((stage) => {
          const items = opportunities.filter((o) => o.stage === stage.key);
          return (
            <div key={stage.key}>
              <div className="mb-3.5 flex items-center gap-2">
                <span
                  className={`sig-dot ${stage.tone === "info" ? "" : stage.tone}`}
                  style={stage.tone === "info" ? { background: "var(--info)" } : undefined}
                />
                <span className="card-title" style={{ color: "var(--text)" }}>
                  {stage.key}
                </span>
                <span className="chip" style={{ padding: "1px 8px" }}>
                  {items.length}
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {items.map((o) => (
                  <Link key={o.id} href={`/clients/${o.clientId}`} className="card is-hover" style={{ padding: 18 }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="muted text-[0.78rem]">{clientMap.get(o.clientId) ?? "—"}</span>
                      {o.value ? (
                        <span className="font-bold" style={{ color: "var(--accent)" }}>
                          {o.value}
                        </span>
                      ) : null}
                    </div>
                    <div className="h4 mt-2.5" style={{ fontSize: "0.98rem" }}>
                      {o.title}
                    </div>
                    {o.readiness ? <div className="muted mt-1.5 text-[0.78rem]">Readiness · {o.readiness}</div> : null}
                    {o.nextStep ? (
                      <div className="mt-3 flex items-start gap-2 text-[0.82rem]" style={{ color: "var(--text-2)" }}>
                        <ArrowRight style={{ width: 15, height: 15, marginTop: 2, color: "var(--accent)", flexShrink: 0 }} />
                        <span>{o.nextStep}</span>
                      </div>
                    ) : null}
                  </Link>
                ))}
                {items.length === 0 ? <p className="muted text-[0.8rem]">Nothing here yet.</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
