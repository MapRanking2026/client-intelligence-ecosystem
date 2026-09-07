import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { UnauthorizedPage } from "@/src/components/states";
import { TicketBoard } from "@/src/components/ticket-board";
import { listTicketsForViewer } from "@/src/lib/server/tickets-service";
import { listSpecialists } from "@/src/lib/server/specialists-service";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  if (!authzHas(authz, "seo.package.read")) {
    return (
      <AppShell authz={authz} title="Tickets" breadcrumbs={[{ label: "SEOOS" }, { label: "Tickets" }]}>
        <div className="state state--blocked">
          <span className="badge badge--warn">Permission required</span>
        </div>
      </AppShell>
    );
  }

  const isAdmin = authz.clientVisibility === "all";
  const [tickets, specialists] = await Promise.all([
    listTicketsForViewer(authz),
    listSpecialists(authz.tenantId),
  ]);
  const specName = (id?: string) => specialists.find((s) => s.id === id)?.name;

  const view = tickets.map((t) => ({
    id: t.id,
    externalId: t.externalId,
    url: t.url,
    title: t.title,
    body: t.body,
    category: t.category,
    department: t.department,
    clientName: t.clientName,
    specialistName: specName(t.specialistId),
    clickupStatus: t.clickupStatus,
    dueDate: t.dueDate,
    status: t.status,
    draft: t.draft,
    detail: t.detail,
    needsInfo: t.needsInfo,
    decisionNote: t.decisionNote,
  }));

  return (
    <AppShell
      authz={authz}
      title="Tickets"
      subtitle={
        isAdmin
          ? "ClickUp tickets, routed to each account's specialist — drafted here, approved before anything goes live"
          : "Your ClickUp tickets — the AI drafts the work here; you approve before anything goes live"
      }
      breadcrumbs={[{ label: "SEOOS" }, { label: "Tickets" }]}
    >
      <TicketBoard tickets={view} isAdmin={isAdmin} />
    </AppShell>
  );
}
