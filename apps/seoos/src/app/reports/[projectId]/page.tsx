import Link from "next/link";
import { canAccessClient } from "@cie/core";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatCard, UnauthorizedPage } from "@/src/components/states";
import { PrintButton } from "@/src/components/print-button";
import { getProject } from "@/src/lib/server/projects-service";
import { composeMonthlyReport } from "@/src/lib/server/report-service";

export const dynamic = "force-dynamic";

function fmt(n: number | null, suffix = ""): string {
  return n == null ? "—" : `${n}${suffix}`;
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  if (!authzHas(authz, "seo.package.read")) {
    return (
      <AppShell authz={authz} title="Report" breadcrumbs={[{ label: "SEOOS" }, { label: "Reports" }]}>
        <div className="state state--blocked"><span className="badge badge--warn">Permission required</span></div>
      </AppShell>
    );
  }

  const { projectId } = await params;
  const project = await getProject(authz.tenantId, projectId);
  if (!project || !canAccessClient(authz.clientVisibility, project.clientId)) {
    return (
      <AppShell authz={authz} title="Report" breadcrumbs={[{ label: "SEOOS" }, { label: "Reports" }]}>
        <EmptyState title="Not found" message="This report isn't available." action={<Link href="/reports">← Reports</Link>} />
      </AppShell>
    );
  }

  const report = await composeMonthlyReport(authz.tenantId, projectId);

  return (
    <AppShell
      authz={authz}
      title={`Monthly report — ${project.businessName}`}
      subtitle={report ? `Period ${report.period}` : undefined}
      breadcrumbs={[{ label: "SEOOS" }, { label: "Reports", href: "/reports" }, { label: project.businessName }]}
    >
      {!report || !report.hasData ? (
        <EmptyState
          title="No data to report yet"
          message="Run Sync all sources on this client (and a monthly audit) first, then the report fills in."
          action={<Link href="/clients">← Clients</Link>}
        />
      ) : (
        <>
          <div className="toolbar">
            <PrintButton />
            <span className="muted" style={{ fontSize: 12 }}>
              Generated {report.generatedAt.slice(0, 10)}
              {report.website ? ` · ${report.website}` : ""}
              {report.niche ? ` · ${report.niche}` : ""}
            </span>
          </div>

          <Panel title="Local visibility">
            <div className="grid-cards">
              <StatCard label="Avg map rank" value={fmt(report.metrics.avgRank)} />
              <StatCard label="Share of local voice" value={fmt(report.metrics.avgShare, "%")} />
              <StatCard label="Keywords tracked" value={report.metrics.keywordsTracked} />
              <StatCard label="Check-in posts" value={report.metrics.checkinPosts} hint={`${report.metrics.checkinBusinesses} business(es)`} />
            </div>
          </Panel>

          {report.keywords.length ? (
            <Panel title="Keyword grid performance">
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr><th>Keyword</th><th>Avg rank</th><th>Share %</th><th>Top-3 %</th></tr>
                  </thead>
                  <tbody>
                    {report.keywords.map((k) => (
                      <tr key={k.keyword}>
                        <td>{k.keyword}</td>
                        <td>{fmt(k.rank)}</td>
                        <td>{fmt(k.share)}</td>
                        <td>{fmt(k.top3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}

          {report.changes.length ? (
            <Panel title="What changed and why">
              <ul>
                {report.changes.map((c, i) => (
                  <li key={i} style={{ marginBottom: 8 }}>
                    <strong>{c.title}</strong>
                    <div className="muted" style={{ fontSize: 13 }}>{c.explanation}</div>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {report.audit ? (
            <Panel title={`Monthly audit (${report.audit.period})`}>
              <div className="grid-cards">
                <StatCard label="Passed" value={report.audit.pass} />
                <StatCard label="Warnings" value={report.audit.warn} />
                <StatCard label="Failing" value={report.audit.fail} />
                <StatCard label="Pending" value={report.audit.pending} />
              </div>
              {report.audit.reviewResponses ? (
                <p className="muted" style={{ fontSize: 13 }}>Reviews responded: {report.audit.reviewResponses}</p>
              ) : null}
            </Panel>
          ) : null}

          {report.notes.length ? (
            <Panel title="Notes">
              <ul>{report.notes.map((n, i) => <li key={i} className="muted">{n}</li>)}</ul>
            </Panel>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
