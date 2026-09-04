import Link from "next/link";

import { isSeoosEnabled } from "@/src/lib/flags";
import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import {
  EmptyState,
  Panel,
  StatCard,
  StatusPill,
  UnauthorizedPage,
} from "@/src/components/states";
import { getProjectRepo } from "@/src/lib/server/repositories/project-repo";
import { listRequests } from "@/src/lib/server/seo-engine";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!isSeoosEnabled()) {
    return (
      <main className="wrap">
        <div className="panel">
          <span className="badge badge--warn">SEOOS disabled</span>
          <p className="muted">Set SEOOS_ENABLED=true to enable.</p>
        </div>
      </main>
    );
  }
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;

  const projects = await getProjectRepo().list(authz.tenantId);
  const requests = await listRequests(authz.tenantId);

  const active = projects.filter((p) => p.stage === "active").length;
  const onboarding = projects.filter((p) =>
    ["draft", "intake", "connecting_data", "baseline_scan", "strategy"].includes(p.stage),
  ).length;
  const atRisk = projects.filter((p) => p.health === "at_risk" || p.health === "blocked").length;
  const needsInput = requests.filter((r) => r.status === "needs_input" || r.status === "submitted").length;
  const ready = requests.filter((r) => r.status === "ready").length;

  return (
    <AppShell
      authz={authz}
      title="SEO Operations Dashboard"
      subtitle="Rolling 30-day view · workload, requests, and data health"
    >
      <div className="grid-cards" style={{ marginBottom: 18 }}>
        <StatCard label="Active projects" value={active} />
        <StatCard label="Onboarding / setup" value={onboarding} />
        <StatCard label="At-risk / blocked" value={atRisk} hint="Health flag" />
        <StatCard label="Requests needing action" value={needsInput} hint="submitted · needs input" />
        <StatCard label="Packages ready" value={ready} />
      </div>

      <Panel
        title="Request activity"
        actions={<Link href="/requests">Open inbox →</Link>}
      >
        {requests.length === 0 ? (
          <EmptyState title="No requests yet" message="MTOS requests will appear here as they arrive." />
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Capability</th>
                  <th>Source</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {requests.slice(0, 8).map((r) => (
                  <tr key={r.id}>
                    <td>{r.clientId}</td>
                    <td>{r.capability}</td>
                    <td className="muted">{r.requestedByApp}</td>
                    <td>{r.priority}</td>
                    <td><StatusPill status={r.status} /></td>
                    <td><Link href={`/requests/${r.id}`}>view</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Data health">
        <p className="muted" style={{ marginTop: 0 }}>
          Live provider sync is consumed from the shared MTOS integration gateway.
          Until that gateway is wired, SEOOS runs on the shared canonical stores it
          can already read; unavailable providers are shown honestly rather than
          with fabricated numbers.
        </p>
        <div className="grid-cards">
          {["rank-tracker", "geogrid", "google-business-profile", "map-checkins", "clickup", "gohighlevel", "google-search-console"].map(
            (p) => (
              <div key={p} className="stat-card">
                <div className="stat-label">{p}</div>
                <div style={{ marginTop: 6 }}>
                  <span className="badge badge--warn">via gateway</span>
                </div>
              </div>
            ),
          )}
        </div>
      </Panel>
    </AppShell>
  );
}
