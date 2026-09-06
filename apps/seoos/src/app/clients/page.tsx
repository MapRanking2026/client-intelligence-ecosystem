import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, UnauthorizedPage } from "@/src/components/states";
import { CreateProjectForm } from "@/src/components/create-project-form";
import { ClientsTable, type ClientRow, type SpecialistOption } from "@/src/components/clients-table";
import { SpecialistManager, type SpecialistRow } from "@/src/components/specialist-manager";
import { listProjectsForViewer, effectiveSpecialistId } from "@/src/lib/server/projects-service";
import { listSpecialists, matchSpecialistId } from "@/src/lib/server/specialists-service";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;

  const canManage = authzHas(authz, "seo.project.manage");
  const isAdmin = authz.clientVisibility === "all";
  const projects = canManage ? await listProjectsForViewer(authz) : [];
  const specialists = isAdmin ? await listSpecialists(authz.tenantId) : [];
  const nameOf = (id?: string) => specialists.find((s) => s.id === id)?.name ?? "";

  const rows: ClientRow[] = projects.map((p) => {
    const effId = isAdmin ? effectiveSpecialistId(p, specialists) : undefined;
    const autoId = isAdmin ? matchSpecialistId(p.externalIds?.seoSpecialist, specialists) : undefined;
    return {
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
      assignedSpecialistId: p.assignedSpecialistId ?? "",
      specialistName: effId ? nameOf(effId) : "Unassigned",
      autoSpecialistName: autoId ? nameOf(autoId) : "",
    };
  });

  // Coverage: clients per specialist (including 0) + unassigned.
  const counts = new Map<string, number>();
  let unassigned = 0;
  if (isAdmin) {
    for (const p of projects) {
      const effId = effectiveSpecialistId(p, specialists);
      if (effId) counts.set(effId, (counts.get(effId) ?? 0) + 1);
      else unassigned += 1;
    }
  }
  const specialistRows: SpecialistRow[] = specialists.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    count: counts.get(s.id) ?? 0,
  }));
  const specialistOptions: SpecialistOption[] = specialists.map((s) => ({ id: s.id, name: s.name }));

  return (
    <AppShell
      authz={authz}
      title="Clients"
      subtitle="Every client, its specialist, health, setup, and projects"
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
            <>
              <Panel title={`SEO specialists (${specialists.length})`}>
                <SpecialistManager specialists={specialistRows} />
                {unassigned > 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>
                    <strong>{unassigned}</strong> client(s) are currently Unassigned — assign them in
                    the table below.
                  </p>
                ) : null}
              </Panel>
              <CreateProjectForm />
            </>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              Showing the clients assigned to you. An admin manages the roster (Integrations) and it
              refreshes daily.
            </p>
          )}

          <Panel title={isAdmin ? `Clients (${projects.length})` : `Your clients (${projects.length})`}>
            {projects.length === 0 ? (
              <EmptyState
                title={isAdmin ? "No clients yet" : "No clients assigned to you yet"}
                message={
                  isAdmin
                    ? "Connect ClickUp under Integrations, then run the ClickUp client sync."
                    : "Ask an admin to assign you and re-sync."
                }
                action={isAdmin ? <Link href="/integrations">Integrations →</Link> : undefined}
              />
            ) : (
              <ClientsTable rows={rows} admin={isAdmin} specialists={specialistOptions} />
            )}
          </Panel>
        </>
      )}
    </AppShell>
  );
}
