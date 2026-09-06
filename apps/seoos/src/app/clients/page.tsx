import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatusPill, UnauthorizedPage } from "@/src/components/states";
import { CreateProjectForm } from "@/src/components/create-project-form";
import { SyncSourcesButton } from "@/src/components/sync-sources-button";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;

  const canManage = authzHas(authz, "seo.project.manage");
  const isAdmin = authz.clientVisibility === "all";
  const projects = canManage ? await listProjectsForViewer(authz) : [];

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
          {isAdmin ? (
            <CreateProjectForm />
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              Showing the clients assigned to you. An admin syncs the full roster from ClickUp.
            </p>
          )}
          <Panel title={isAdmin ? `Projects (${projects.length})` : `Your clients (${projects.length})`}>
            {projects.length === 0 ? (
              <EmptyState
                title={isAdmin ? "No projects yet" : "No clients assigned to you yet"}
                message={
                  isAdmin
                    ? "Connect ClickUp under Integrations, then Sync all clients from ClickUp."
                    : "Ask an admin to assign you (via the ClickUp SEO Specialist field) and re-sync."
                }
              />
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Business</th>
                      <th>Client</th>
                      {isAdmin ? <th>Specialist</th> : null}
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
                        <td><Link href={`/clients/${p.id}`}>{p.businessName}</Link></td>
                        <td className="muted">{p.clientId}</td>
                        {isAdmin ? (
                          <td className="muted">{p.externalIds?.seoSpecialist ?? "—"}</td>
                        ) : null}
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
