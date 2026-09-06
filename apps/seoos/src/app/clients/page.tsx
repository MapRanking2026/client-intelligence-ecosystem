import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, UnauthorizedPage } from "@/src/components/states";
import { CreateProjectForm } from "@/src/components/create-project-form";
import { ClientsTable, type ClientRow, type SpecialistOption } from "@/src/components/clients-table";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";
import { listPods } from "@/src/lib/server/pods-service";
import { getUserRepo } from "@/src/lib/server/repositories/user-repo";
import { normalizePodKey } from "@/src/lib/domain/pod";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;

  const canManage = authzHas(authz, "seo.project.manage");
  const isAdmin = authz.clientVisibility === "all";
  const projects = canManage ? await listProjectsForViewer(authz) : [];

  // Admin-only: resolve each client's effective specialist (direct assignment,
  // else its pod's specialist) and the full specialist roster for reassignment.
  const [pods, users] = isAdmin
    ? await Promise.all([listPods(authz.tenantId), getUserRepo().list(authz.tenantId)])
    : [[], []];
  const userName = (id?: string) => {
    const u = users.find((x) => x.userId === id);
    return u ? u.displayName ?? u.email : "";
  };
  const podSpecialistByKey = new Map(pods.map((p) => [p.podKey, p.specialistUserId]));
  const specialists: SpecialistOption[] = users
    .filter((u) => !u.disabled)
    .map((u) => ({ userId: u.userId, name: u.displayName ?? u.email }));

  function effective(p: (typeof projects)[number]) {
    const directId = p.assignments?.seoSpecialistUserId;
    const podKey = p.externalIds?.pod ? normalizePodKey(p.externalIds.pod) : "";
    const podId = podKey ? podSpecialistByKey.get(podKey) : undefined;
    const effId = directId || podId;
    return {
      directId: directId ?? "",
      effId,
      name: effId ? userName(effId) || "Unknown" : "Unassigned",
      podName: podId ? userName(podId) : "",
    };
  }

  const rows: ClientRow[] = projects.map((p) => {
    const e = effective(p);
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
      specialistUserId: e.directId,
      specialistName: e.name,
      podSpecialistName: e.podName,
    };
  });

  // Coverage: clients per specialist (including specialists with 0) + unassigned.
  const coverage = isAdmin
    ? (() => {
        const counts = new Map<string, number>();
        let unassigned = 0;
        for (const p of projects) {
          const e = effective(p);
          if (e.effId) counts.set(e.effId, (counts.get(e.effId) ?? 0) + 1);
          else unassigned += 1;
        }
        return {
          perSpecialist: specialists.map((s) => ({ ...s, count: counts.get(s.userId) ?? 0 })),
          unassigned,
        };
      })()
    : null;

  return (
    <AppShell
      authz={authz}
      title="Clients"
      subtitle="Every client, its pod, specialist, health, setup, and projects"
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
              Showing the clients assigned to you. An admin manages the roster (Integrations) and it
              refreshes daily.
            </p>
          )}

          {isAdmin && coverage ? (
            <Panel title="Coverage by specialist">
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr><th>SEO specialist</th><th>Clients</th></tr>
                  </thead>
                  <tbody>
                    {coverage.perSpecialist
                      .slice()
                      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
                      .map((s) => (
                        <tr key={s.userId}>
                          <td>{s.name}</td>
                          <td>{s.count === 0 ? <span className="muted">0 — no clients</span> : s.count}</td>
                        </tr>
                      ))}
                    <tr>
                      <td className="muted">Unassigned</td>
                      <td>{coverage.unassigned}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                Assign a client to a specialist in the table below (overrides its pod), or set a pod&apos;s
                specialist on the <Link href="/pods">Pods page</Link>.
              </p>
            </Panel>
          ) : null}

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
              <ClientsTable rows={rows} admin={isAdmin} specialists={specialists} />
            )}
          </Panel>
        </>
      )}
    </AppShell>
  );
}
