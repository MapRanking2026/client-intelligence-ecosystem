import Link from "next/link";

import { AivShell, Denied, Disclaimer, pageContext } from "@/src/components/ai-visibility/aiv-shell";
import { ScanPlanner } from "@/src/components/ai-visibility/scan-planner";
import { EmptyState } from "@/src/components/states";
import { usd } from "@/src/lib/ai-visibility/util";
import { monthSpend } from "@/src/lib/server/ai-visibility/budget";
import { getProfile } from "@/src/lib/server/ai-visibility/profile-service";
import { listScans } from "@/src/lib/server/ai-visibility/scan-service";

export const dynamic = "force-dynamic";

export default async function AivScansPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await pageContext(projectId);
  if ("denied" in ctx) return <Denied />;
  const { authz, project } = ctx;
  const profile = await getProfile(authz.tenantId, project.id);
  if (!profile) {
    return (
      <AivShell authz={authz} project={project} tab="scans">
        <EmptyState title="Not set up yet" message="Set up the client profile first." action={<Link href={`/ai-visibility/${project.id}/setup`}>Setup →</Link>} />
      </AivShell>
    );
  }
  const [scans, spent] = await Promise.all([listScans(authz.tenantId, project.id), monthSpend(authz.tenantId, { projectId: project.id })]);
  const canManage = authz.permissions.includes("seo.project.manage");
  return (
    <AivShell authz={authz} project={project} tab="scans" subtitle={`Spend this month (calculated from reported usage): ${usd(spent.calculatedUsd)} of ${usd(profile.monthlyBudgetUsd)} cap`}>
      <Disclaimer />
      {canManage ? <ScanPlanner projectId={project.id} providerIds={profile.providerIds} defaultReps={profile.repetitions} /> : null}
      <section className="panel">
        <h2 className="panel-title">Scan history</h2>
        {scans.length ? (
          <div className="aiv-table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th className="num">Planned</th>
                  <th className="num">Succeeded</th>
                  <th className="num">Failed</th>
                  <th className="num">Cancelled</th>
                  <th className="num">Estimated</th>
                  <th className="num">Calculated cost</th>
                  <th>Providers</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/ai-visibility/${project.id}/scans/${s.id}`}>{s.createdAt.slice(0, 16).replace("T", " ")}</Link></td>
                    <td>{s.trigger}{s.scheduleKey ? ` (${s.scheduleKey})` : ""}</td>
                    <td>
                      <span className={`aiv-pill ${s.status === "completed" ? "aiv-pill--ok" : s.status === "failed" || s.status === "budget_stopped" ? "aiv-pill--bad" : "aiv-pill--warn"}`}>{s.status.replace(/_/g, " ")}</span>
                      {s.stopReason ? <div className="aiv-ev">{s.stopReason}</div> : null}
                    </td>
                    <td className="num">{s.plannedCount}</td>
                    <td className="num">{s.counts.succeeded}</td>
                    <td className="num">{s.counts.failed}</td>
                    <td className="num">{s.counts.cancelled}</td>
                    <td className="num">{usd(s.estimatedCostUsd)}</td>
                    <td className="num">{usd(s.actualCostUsd)}</td>
                    <td>{s.providerModels.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="aiv-ev">“Calculated cost” = provider-reported token and search usage × listed rates. Check the provider’s billing console for invoiced charges.</p>
          </div>
        ) : (
          <p className="muted">No scans yet.</p>
        )}
      </section>
    </AivShell>
  );
}
