import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatusPill, UnauthorizedPage } from "@/src/components/states";
import { CreateProjectForm } from "@/src/components/create-project-form";
import { SyncClientsButton } from "@/src/components/sync-clients-button";
import { SyncSourcesButton } from "@/src/components/sync-sources-button";
import { listProjects } from "@/src/lib/server/projects-service";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;

  const canManage = authzHas(authz, "seo.project.manage");
  const projects = canManage ? await listProjects(authz.tenantId) : [];

  return (
    <AppShell
      authz={authz}
      title="Clients / SEO Projects"
      subtitle="SEO engagements layered on canonical MTOS clients"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Clients" }]}
    >
      {!canManage ? (
        <div className="state state--blocked">
          <span className="badge badge--warn">Permission required</span>
          <p className="muted">You need the seo.project.manage permission to view projects.</p>
        </div>
      ) : (
        <>
          <SyncClientsButton />
          <CreateProjectForm />
          <Panel title={`Projects (${projects.length})`}>
            {projects.length === 0 ? (
              <EmptyState title="No projects yet" message="Create the first SEO project for a canonical client." />
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Business</th>
                      <th>Client</th>
                      <th>Stage</th>
                      <th>Health</th>
                      <th>Priority</th>
                      <th>Setup</th>
                      <th>Next deadline</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr key={p.id}>
                        <td>{p.businessName}</td>
                        <td className="muted">{p.clientId}</td>
                        <td><StatusPill status={p.stage} /></td>
                        <td><StatusPill status={p.health} /></td>
                        <td>{p.priority}</td>
                        <td>{p.setupReadiness}%</td>
                        <td className="muted">{p.nextDeadlineAt ? p.nextDeadlineAt.slice(0, 10) : "—"}</td>
                        <td><SyncSourcesButton projectId={p.id} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <p className="muted" style={{ fontSize: 12 }}>
            Full project workspace (Setup wizard, Keywords, Rankings, GBP, Audit, Recommendations,
            Work Orders, Lead &amp; Call, Monthly Audit, Evidence, Activity) is being built out per the
            <Link href="/"> build ledger</Link>.
          </p>
        </>
      )}
    </AppShell>
  );
}
