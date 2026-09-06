import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatusPill, UnauthorizedPage } from "@/src/components/states";
import { ClientSelect } from "@/src/components/client-select";
import { TaskActions } from "@/src/components/task-actions";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";
import { listSpecialists } from "@/src/lib/server/specialists-service";
import { getPreparedTaskRepo } from "@/src/lib/server/repositories/prepared-task-repo";
import type { TaskPhase } from "@/src/lib/domain/prepared-task";

export const dynamic = "force-dynamic";

const PHASE_LABEL: Record<TaskPhase, string> = {
  phase1: "Phase 1 · Setup & Quick Wins",
  phase2: "Phase 2 · Website SEO",
  recurring: "Recurring · Steady State",
};

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
  const projects = await listProjectsForViewer(authz);
  const { projectId } = await searchParams;
  const selected = projects.find((p) => p.id === projectId) ?? projects[0];

  const [tasks, specialists] = selected
    ? await Promise.all([
        getPreparedTaskRepo().listByProject(authz.tenantId, selected.id),
        listSpecialists(authz.tenantId),
      ])
    : [[], []];
  const specName = (id?: string) => specialists.find((s) => s.id === id)?.name ?? "—";
  const phases: TaskPhase[] = ["phase1", "phase2", "recurring"];

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
              {tasks.length === 0 ? (
                <EmptyState
                  title="No task plan yet"
                  message="Run a full scan on this client, or click Refresh this plan — the engine builds the plan from the client's current workflow position."
                  action={<Link href={`/clients/${selected.id}`}>Open client →</Link>}
                />
              ) : (
                phases.map((phase) => {
                  const rows = tasks
                    .filter((t) => t.phase === phase)
                    .sort((a, b) => a.order - b.order || a.taskKey.localeCompare(b.taskKey));
                  if (!rows.length) return null;
                  return (
                    <Panel key={phase} title={`${PHASE_LABEL[phase]} (${rows.length})`}>
                      <div className="table-scroll">
                        <table className="data">
                          <thead>
                            <tr><th>Task</th><th>Cadence</th><th>Period</th><th>Specialist</th><th>Status</th></tr>
                          </thead>
                          <tbody>
                            {rows.map((t) => (
                              <tr key={t.id}>
                                <td>{t.title}</td>
                                <td className="muted">{t.cadence}</td>
                                <td className="muted">{t.period || "—"}</td>
                                <td className="muted">{specName(t.specialistId)}</td>
                                <td><StatusPill status={t.status.replace(/_/g, " ")} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Panel>
                  );
                })
              )}
            </>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
