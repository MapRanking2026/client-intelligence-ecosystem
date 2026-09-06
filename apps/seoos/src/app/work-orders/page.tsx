import Link from "next/link";
import { canAccessClient } from "@cie/core";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, StatCard, UnauthorizedPage } from "@/src/components/states";
import { WorkOrdersBoard } from "@/src/components/work-orders-board";
import { ClientSelect } from "@/src/components/client-select";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";
import { listWorkOrders } from "@/src/lib/server/workorders-service";

export const dynamic = "force-dynamic";

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  if (!authzHas(authz, "seo.package.read")) {
    return (
      <AppShell authz={authz} title="Work Orders" breadcrumbs={[{ label: "SEOOS" }, { label: "Work Orders" }]}>
        <div className="state state--blocked"><span className="badge badge--warn">Permission required</span></div>
      </AppShell>
    );
  }

  const projects = await listProjectsForViewer(authz);
  const { projectId } = await searchParams;
  const selected = projects.find((p) => p.id === projectId) ?? projects[0];
  const workOrders = selected
    ? (await listWorkOrders(authz.tenantId, selected.id)).filter((w) =>
        canAccessClient(authz.clientVisibility, w.clientId),
      )
    : [];

  const open = workOrders.filter((w) => !["completed", "cancelled"].includes(w.status)).length;
  const qaQueue = workOrders.filter((w) => w.status === "ready_for_qa").length;

  return (
    <AppShell
      authz={authz}
      title="Work Orders & Deliverables"
      subtitle="Assignment → delivery → QA → completion evidence"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Work Orders" }]}
    >
      {projects.length === 0 ? (
        <EmptyState title="No projects" message="Create a project to manage work." action={<Link href="/clients">Clients →</Link>} />
      ) : (
        <>
          <ClientSelect
            projects={projects.map((p) => ({ id: p.id, businessName: p.businessName }))}
            selectedId={selected?.id}
            basePath="/work-orders"
          />
          <div className="grid-cards" style={{ marginBottom: 14 }}>
            <StatCard label="Open work" value={open} />
            <StatCard label="Awaiting QA" value={qaQueue} />
            <StatCard label="Total" value={workOrders.length} />
          </div>
          {selected ? (
            <WorkOrdersBoard
              workOrders={workOrders}
              projectId={selected.id}
              clientId={selected.clientId}
              canManage={authzHas(authz, "seo.project.manage")}
              canQa={authzHas(authz, "seo.package.qa")}
            />
          ) : null}
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            ClickUp reconciliation and outbound writes remain behind the existing human-approval gate.
          </p>
        </>
      )}
    </AppShell>
  );
}
