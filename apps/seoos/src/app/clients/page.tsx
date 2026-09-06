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

  const toRow = (p: (typeof projects)[number], effId?: string): ClientRow => {
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
  };

  // Bucket clients by their effective specialist (admin view).
  const bySpecialist = new Map<string, ClientRow[]>();
  const unassignedRows: ClientRow[] = [];
  const flatRows: ClientRow[] = [];
  for (const p of projects) {
    const effId = isAdmin ? effectiveSpecialistId(p, specialists) : undefined;
    const row = toRow(p, effId);
    flatRows.push(row);
    if (isAdmin) {
      if (effId) bySpecialist.set(effId, [...(bySpecialist.get(effId) ?? []), row]);
      else unassignedRows.push(row);
    }
  }

  const specialistRows: SpecialistRow[] = specialists.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    count: bySpecialist.get(s.id)?.length ?? 0,
  }));
  const specialistOptions: SpecialistOption[] = specialists.map((s) => ({ id: s.id, name: s.name }));

  // Groups to render: each specialist with ≥1 client, then Unassigned.
  const groups: Array<{ key: string; name: string; rows: ClientRow[] }> = [
    ...specialists
      .filter((s) => (bySpecialist.get(s.id)?.length ?? 0) > 0)
      .map((s) => ({ key: s.id, name: s.name, rows: bySpecialist.get(s.id) ?? [] })),
    ...(unassignedRows.length ? [{ key: "unassigned", name: "Unassigned", rows: unassignedRows }] : []),
  ];

  return (
    <AppShell
      authz={authz}
      title="Clients"
      subtitle="Grouped by SEO specialist"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Clients" }]}
    >
      {!canManage ? (
        <div className="state state--blocked">
          <span className="badge badge--warn">Permission required</span>
          <p className="muted">You need the seo.project.manage permission to view clients.</p>
        </div>
      ) : !isAdmin ? (
        <Panel title={`Your clients (${flatRows.length})`}>
          {flatRows.length === 0 ? (
            <EmptyState title="No clients assigned to you yet" message="Ask an admin to assign you and re-sync." />
          ) : (
            <ClientsTable rows={flatRows} />
          )}
        </Panel>
      ) : (
        <>
          <Panel title={`SEO specialists (${specialists.length})`}>
            <SpecialistManager specialists={specialistRows} />
          </Panel>
          <CreateProjectForm />

          {projects.length === 0 ? (
            <Panel title="Clients (0)">
              <EmptyState
                title="No clients yet"
                message="Connect ClickUp under Integrations, then run the ClickUp client sync."
                action={<Link href="/integrations">Integrations →</Link>}
              />
            </Panel>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 13 }}>
                {projects.length} client(s) across {groups.length} group(s). Reassign any client with the
                Specialist dropdown.
              </p>
              {groups.map((g) => (
                <details key={g.key} open className="panel" style={{ marginBottom: 12 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 16, listStyle: "revert" }}>
                    {g.name} <span className="muted" style={{ fontWeight: 400 }}>({g.rows.length})</span>
                  </summary>
                  <div style={{ marginTop: 10 }}>
                    <ClientsTable rows={g.rows} admin specialists={specialistOptions} />
                  </div>
                </details>
              ))}
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
