import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { BlockedExternal, EmptyState, Panel, StatCard, StatusPill, UnauthorizedPage } from "@/src/components/states";
import { listProjects } from "@/src/lib/server/projects-service";
import { listKeywords } from "@/src/lib/server/keywords-service";
import { TRACKED_KEYWORD_STATUSES } from "@/src/lib/domain/keyword";

export const dynamic = "force-dynamic";

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  if (!authzHas(authz, "seo.package.read")) {
    return (
      <AppShell authz={authz} title="Rankings & Grids" breadcrumbs={[{ label: "SEOOS" }, { label: "Rankings & Grids" }]}>
        <div className="state state--blocked">
          <span className="badge badge--warn">Permission required</span>
        </div>
      </AppShell>
    );
  }

  const projects = authzHas(authz, "seo.project.manage")
    ? await listProjects(authz.tenantId)
    : [];
  const { projectId } = await searchParams;
  const selected = projects.find((p) => p.id === projectId) ?? projects[0];
  const tracked = selected
    ? (await listKeywords(authz.tenantId, selected.id)).filter((k) =>
        TRACKED_KEYWORD_STATUSES.includes(k.status),
      )
    : [];

  return (
    <AppShell
      authz={authz}
      title="Rankings & Grids"
      subtitle="Tracked keywords, positions, and local grid coverage"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Rankings & Grids" }]}
    >
      {projects.length === 0 ? (
        <EmptyState title="No projects" message="Create a project and approve keywords to track rankings." action={<Link href="/clients">Clients →</Link>} />
      ) : (
        <>
          <div className="toolbar">
            <span className="muted" style={{ fontSize: 12 }}>Project:</span>
            {projects.map((p) => (
              <Link key={p.id} href={`/rankings?projectId=${p.id}`} className={`badge${p.id === selected?.id ? " status-active" : ""}`}>
                {p.businessName}
              </Link>
            ))}
          </div>

          <div className="grid-cards" style={{ marginBottom: 14 }}>
            <StatCard label="Tracked keywords" value={tracked.length} />
            <StatCard label="Avg position" value="—" hint="via Rank Tracker gateway" />
            <StatCard label="Top-3 coverage" value="—" hint="via Rank Tracker gateway" />
            <StatCard label="Grid market share" value="—" hint="via GeoGrid gateway" />
          </div>

          <Panel title="Tracked keywords">
            {tracked.length === 0 ? (
              <EmptyState
                title="No tracked keywords"
                message="Approve or start tracking keywords to populate rankings."
                action={selected ? <Link href={`/keywords?projectId=${selected.id}`}>Manage keywords →</Link> : undefined}
              />
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Keyword</th>
                      <th>Status</th>
                      <th>Position</th>
                      <th>Change</th>
                      <th>Last scan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tracked.map((k) => (
                      <tr key={k.id}>
                        <td>{k.phrase}</td>
                        <td><StatusPill status={k.status} /></td>
                        <td className="muted">—</td>
                        <td className="muted">—</td>
                        <td className="muted">awaiting scan</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Positions and grid data populate from Rank Tracker / GeoGrid through the
              integration gateway. Historical gaps are labeled, never fabricated.
            </p>
          </Panel>

          <Panel title="Grid / heatmap coverage">
            <BlockedExternal
              provider="geogrid (via gateway)"
              requirement="a completed GeoGrid sync branch + the normalized grid adapter exposed through the gateway"
            />
          </Panel>
        </>
      )}
    </AppShell>
  );
}
