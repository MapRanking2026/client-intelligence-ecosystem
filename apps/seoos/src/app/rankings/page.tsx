import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatCard, StatusPill, UnauthorizedPage } from "@/src/components/states";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";
import { listKeywords } from "@/src/lib/server/keywords-service";
import { TRACKED_KEYWORD_STATUSES } from "@/src/lib/domain/keyword";
import { ClientSelect } from "@/src/components/client-select";
import { FullScanButton } from "@/src/components/full-scan-button";
import { getPerformanceSnapshotRepo } from "@/src/lib/server/repositories/performance-snapshot-repo";

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
    ? await listProjectsForViewer(authz)
    : [];
  const { projectId } = await searchParams;
  const selected = projects.find((p) => p.id === projectId) ?? projects[0];
  const tracked = selected
    ? (await listKeywords(authz.tenantId, selected.id)).filter((k) =>
        TRACKED_KEYWORD_STATUSES.includes(k.status),
      )
    : [];
  const snapshot = selected
    ? await getPerformanceSnapshotRepo().get(authz.tenantId, selected.id)
    : null;
  const canManage = authzHas(authz, "seo.project.manage");
  const rankValues = snapshot ? snapshot.grids.filter((g) => g.averageRankPosition != null) : [];
  const avgRank = rankValues.length
    ? Math.round((rankValues.reduce((s, g) => s + (g.averageRankPosition ?? 0), 0) / rankValues.length) * 10) / 10
    : null;
  const avgShare = snapshot && snapshot.grids.length
    ? Math.round(
        snapshot.grids.reduce((s, g) => s + (g.shareOfLocalVoicePercent ?? 0), 0) /
          (snapshot.grids.filter((g) => g.shareOfLocalVoicePercent != null).length || 1),
      )
    : null;

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
          <ClientSelect
            projects={projects.map((p) => ({ id: p.id, businessName: p.businessName }))}
            selectedId={selected?.id}
            basePath="/rankings"
          />
          {selected && canManage ? (
            <div className="toolbar">
              <FullScanButton projectId={selected.id} />
              {snapshot ? <span className="muted" style={{ fontSize: 12 }}>Last pulled {snapshot.generatedAt.slice(0, 16).replace("T", " ")}</span> : null}
            </div>
          ) : null}

          <div className="grid-cards" style={{ marginBottom: 14 }}>
            <StatCard label="Tracked keywords" value={tracked.length} />
            <StatCard label="Avg position" value={avgRank ?? "—"} hint={snapshot ? "from grid scans" : "run a full scan"} />
            <StatCard label="Grid market share" value={avgShare != null ? `${avgShare}%` : "—"} hint={snapshot ? "share of local voice" : "run a full scan"} />
            <StatCard label="Businesses" value={snapshot ? snapshot.businesses.length : "—"} hint="matched in Rank Tracker" />
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
              Positions and grid data come from the Rank Tracker (MapRanking) connection.
              Run a full scan to pull the latest. Historical gaps are labeled, never fabricated.
            </p>
          </Panel>

          <Panel title="Grid / heatmap coverage">
            {snapshot && snapshot.grids.length ? (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Keyword</th>
                      <th>Avg grid rank</th>
                      <th>Share of local voice</th>
                      <th>Top-3</th>
                      <th>Scan date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.grids.map((g, i) => (
                      <tr key={`${g.keyword}-${i}`}>
                        <td>{g.keyword}</td>
                        <td>{g.averageRankPosition ?? "—"}</td>
                        <td>{g.shareOfLocalVoicePercent != null ? `${g.shareOfLocalVoicePercent}%` : "—"}</td>
                        <td>{g.top3Percent != null ? `${g.top3Percent}%` : "—"}</td>
                        <td className="muted">{g.scanDate ? g.scanDate.slice(0, 10) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="No grid scan yet"
                message="Connect Rank Tracker (MapRanking) under Integrations, then Generate full scan above to pull this client's grids and heatmaps."
                action={selected ? <Link href={`/clients/${selected.id}`}>Open client →</Link> : undefined}
              />
            )}
          </Panel>
        </>
      )}
    </AppShell>
  );
}
