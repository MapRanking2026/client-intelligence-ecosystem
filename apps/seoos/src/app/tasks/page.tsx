import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, UnauthorizedPage } from "@/src/components/states";
import { ClientSelect } from "@/src/components/client-select";
import { TaskActions } from "@/src/components/task-actions";
import { TaskBoard } from "@/src/components/task-board";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";
import { listSpecialists } from "@/src/lib/server/specialists-service";
import { getPreparedTaskRepo } from "@/src/lib/server/repositories/prepared-task-repo";

export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  if (!authzHas(authz, "seo.package.read")) {
    return (
      <AppShell authz={authz} title="Tasks" breadcrumbs={[{ label: "SEOOS" }, { label: "Tasks" }]}>
        <div className="state state--blocked"><span className="badge badge--warn">Permission required</span></div>
      </AppShell>
    );
  }

  const isAdmin = authz.clientVisibility === "all";
  const canDecide = authzHas(authz, "seo.project.manage");
  const projects = await listProjectsForViewer(authz);
  const { projectId } = await searchParams;
  const selected = projects.find((p) => p.id === projectId) ?? projects[0];

  const [tasks, specialists] = selected
    ? await Promise.all([
        getPreparedTaskRepo().listByProject(authz.tenantId, selected.id),
        listSpecialists(authz.tenantId),
      ])
    : [[], []];
  const specName = (id?: string) => specialists.find((s) => s.id === id)?.name;

  const view = [...tasks]
    .sort((a, b) => a.order - b.order || a.taskKey.localeCompare(b.taskKey))
    .map((t) => ({
      id: t.id,
      title: t.title,
      phase: t.phase,
      cadence: t.cadence,
      period: t.period || undefined,
      specialistName: specName(t.specialistId),
      status: t.status,
      draftable: Boolean(t.promptKey),
      draft: t.draft,
      detail: t.detail,
      needsInfo: t.needsInfo,
      decisionNote: t.decisionNote,
    }));

  return (
    <AppShell
      authz={authz}
      title="Tasks"
      subtitle="The AI task plan per client — drafted in SEOOS, approved before anything goes live"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Tasks" }]}
    >
      {projects.length === 0 ? (
        <EmptyState title="No clients yet" message="Sync clients from ClickUp first." action={<Link href="/clients">Clients →</Link>} />
      ) : (
        <>
          <ClientSelect
            projects={projects.map((p) => ({ id: p.id, businessName: p.businessName }))}
            selectedId={selected?.id}
            basePath="/tasks"
          />
          {selected ? (
            <>
              <TaskActions projectId={selected.id} isAdmin={isAdmin} />
              {view.length === 0 ? (
                <EmptyState
                  title="No task plan yet"
                  message="Run a full scan on this client, or click Refresh this plan — the engine builds the plan from the client's current workflow position."
                  action={<Link href={`/clients/${selected.id}`}>Open client →</Link>}
                />
              ) : (
                <TaskBoard tasks={view} canDecide={canDecide} />
              )}
            </>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
