import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatCard, UnauthorizedPage } from "@/src/components/states";
import { BrainReconcileButton } from "@/src/components/brain-panel";
import { getClientBrain } from "@/src/lib/server/brain/client-brain";

export const dynamic = "force-dynamic";

export default async function BrainPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  if (!authzHas(authz, "settings.manage")) {
    return (
      <AppShell authz={authz} title="Client Brain" breadcrumbs={[{ label: "SEOOS" }, { label: "Client Brain" }]}>
        <div className="state state--blocked">
          <span className="badge badge--warn">Admin only</span>
        </div>
      </AppShell>
    );
  }

  const brain = getClientBrain();
  const [clients, report] = await Promise.all([
    brain.listClients(authz.tenantId),
    brain.getLatestReport(authz.tenantId),
  ]);

  return (
    <AppShell
      authz={authz}
      title="Client Brain"
      subtitle="The canonical source of truth for every client — reconciled from ClickUp, read by every app"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Client Brain" }]}
    >
      <BrainReconcileButton />

      <Panel title="Canonical store">
        <div className="grid-cards">
          <StatCard label="Canonical clients" value={clients.length} />
          <StatCard
            label="Sources"
            value={report ? report.sourcesIngested.length : 0}
            hint={report ? report.sourcesIngested.map((s) => s.source).join(", ") : "none yet"}
          />
          <StatCard label="Conflicts" value={report ? report.conflicts.length : 0} hint="fields where sources disagree" />
          <StatCard label="Last reconciled" value={report ? new Date(report.generatedAt).toLocaleString() : "—"} />
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Phase 1: SEOOS reads the ClickUp SEO Dashboard into the brain. MTOS&apos;s Health Tracker joins as a
          second source next — the engine already merges multiple sources and flags any disagreements below.
        </p>
      </Panel>

      {report ? (
        <Panel title="Latest reconciliation">
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr><th>Metric</th><th>Value</th></tr>
              </thead>
              <tbody>
                <tr><td>Raw records ingested</td><td>{report.totalInputs}</td></tr>
                <tr><td>Canonical clients</td><td>{report.canonicalClients}</td></tr>
                <tr><td>Duplicates merged</td><td>{report.merged}</td></tr>
                <tr><td>Matched across &gt;1 source</td><td>{report.matchedAcrossSources}</td></tr>
                <tr><td>Single-source</td><td>{report.singleSource}</td></tr>
              </tbody>
            </table>
          </div>
        </Panel>
      ) : (
        <EmptyState
          title="No reconciliation yet"
          message="Click “Run ingest + reconcile” to build the canonical client records from ClickUp."
        />
      )}

      {report && report.conflicts.length > 0 ? (
        <Panel title={`Conflicts (${report.conflicts.length})`}>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Fields where two sources disagree on a non-empty value — surfaced, never silently overwritten.
          </p>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr><th>Client</th><th>Field</th><th>Values</th></tr>
              </thead>
              <tbody>
                {report.conflicts.map((c, i) => (
                  <tr key={`${c.clientId}-${c.field}-${i}`}>
                    <td>{c.businessName}</td>
                    <td className="muted">{c.field}</td>
                    <td>
                      {c.values.map((v, j) => (
                        <div key={j} style={{ fontSize: 12 }}>
                          <span className="muted">{v.source}:</span> {v.value}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </AppShell>
  );
}
