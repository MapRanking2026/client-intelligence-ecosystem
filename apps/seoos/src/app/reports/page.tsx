import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, UnauthorizedPage } from "@/src/components/states";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  if (!authzHas(authz, "seo.package.read")) {
    return (
      <AppShell authz={authz} title="Reports" breadcrumbs={[{ label: "SEOOS" }, { label: "Reports" }]}>
        <div className="state state--blocked"><span className="badge badge--warn">Permission required</span></div>
      </AppShell>
    );
  }

  const projects = await listProjectsForViewer(authz);

  return (
    <AppShell
      authz={authz}
      title="Reports & Packages"
      subtitle="Monthly client reports composed from synced data"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Reports" }]}
    >
      <Panel title={`Monthly reports (${projects.length})`}>
        {projects.length === 0 ? (
          <EmptyState
            title="No clients yet"
            message="Sync clients from ClickUp, then each client gets a monthly report."
            action={<Link href="/clients">← Clients</Link>}
          />
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr><th>Business</th><th>Stage</th><th>Setup</th><th>Report</th></tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td>{p.businessName}</td>
                    <td className="muted">{p.stage}</td>
                    <td>{p.setupReadiness}%</td>
                    <td><Link href={`/reports/${p.id}`} className="badge status-active">Open monthly report →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="muted" style={{ fontSize: 12 }}>
        The working request → package flow is in the <Link href="/requests">Request Inbox</Link>.
        Email delivery of these reports stays human-approved and needs an email provider configured.
      </p>
    </AppShell>
  );
}
