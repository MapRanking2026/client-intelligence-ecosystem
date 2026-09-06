import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, UnauthorizedPage } from "@/src/components/states";
import { CreateProjectForm } from "@/src/components/create-project-form";
import { ClientsTable, type ClientRow } from "@/src/components/clients-table";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;

  const canManage = authzHas(authz, "seo.project.manage");
  const isAdmin = authz.clientVisibility === "all";
  const projects = canManage ? await listProjectsForViewer(authz) : [];

  const rows: ClientRow[] = projects.map((p) => ({
    id: p.id,
    businessName: p.businessName,
    clientId: p.clientId,
    pod: p.externalIds?.pod ?? "",
    health: p.dashboardMetrics?.["Health score"] ?? p.health,
    setup: p.setupReadiness,
    status: p.externalIds?.status ?? p.stage,
    services: p.services?.length ?? 0,
    avgRanking: p.dashboardMetrics?.["Avg ranking"] ?? "",
    stage: p.stage,
  }));

  return (
    <AppShell
      authz={authz}
      title="Clients"
      subtitle="Every client, its pod, health, setup, and projects"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Clients" }]}
    >
      {!canManage ? (
        <div className="state state--blocked">
          <span className="badge badge--warn">Permission required</span>
          <p className="muted">You need the seo.project.manage permission to view clients.</p>
        </div>
      ) : (
        <>
          {isAdmin ? (
            <CreateProjectForm />
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              Showing the clients assigned to you. An admin syncs the full roster from ClickUp
              (Integrations page) and it also refreshes daily.
            </p>
          )}
          <Panel title={isAdmin ? `Clients (${projects.length})` : `Your clients (${projects.length})`}>
            {projects.length === 0 ? (
              <EmptyState
                title={isAdmin ? "No clients yet" : "No clients assigned to you yet"}
                message={
                  isAdmin
                    ? "Connect ClickUp under Integrations, then run the ClickUp client sync."
                    : "Ask an admin to assign your pod and re-sync."
                }
                action={isAdmin ? <Link href="/integrations">Integrations →</Link> : undefined}
              />
            ) : (
              <ClientsTable rows={rows} />
            )}
          </Panel>
        </>
      )}
    </AppShell>
  );
}
