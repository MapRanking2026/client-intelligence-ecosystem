import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatCard, UnauthorizedPage } from "@/src/components/states";
import { KeywordsManager } from "@/src/components/keywords-manager";
import { ClientSelect } from "@/src/components/client-select";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";
import { listKeywords } from "@/src/lib/server/keywords-service";
import { getKeywordRefinement } from "@/src/lib/server/keyword-refinement-service";

export const dynamic = "force-dynamic";

export default async function KeywordsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;

  if (!authzHas(authz, "seo.project.manage")) {
    return (
      <AppShell authz={authz} title="Keywords" breadcrumbs={[{ label: "SEOOS" }, { label: "Keywords" }]}>
        <div className="state state--blocked">
          <span className="badge badge--warn">Permission required</span>
          <p className="muted">You need seo.project.manage to manage keywords.</p>
        </div>
      </AppShell>
    );
  }

  const projects = await listProjectsForViewer(authz);
  const { projectId } = await searchParams;
  const selected = projects.find((p) => p.id === projectId) ?? projects[0];

  return (
    <AppShell
      authz={authz}
      title="Keywords"
      subtitle="Discovery, grouping, approval, and tracking — synced to Rank Tracker when live"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Keywords" }]}
    >
      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          message="Create an SEO project first, then manage its keywords."
          action={<Link href="/clients">Go to Clients →</Link>}
        />
      ) : (
        <>
          <ClientSelect
            projects={projects.map((p) => ({ id: p.id, businessName: p.businessName }))}
            selectedId={selected?.id}
            basePath="/keywords"
          />
          {selected ? (
            <>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                Keywords for <strong>{selected.businessName}</strong>
                {selected.niche ? ` · ${selected.niche}` : ""}.
              </p>
              {await (async () => {
                const ref = await getKeywordRefinement(authz, selected);
                return (
                  <Panel title="Portfolio refinement (quarterly)">
                    <div className="grid-cards" style={{ marginBottom: 10 }}>
                      <StatCard label="Portfolio avg rank" value={ref.portfolioAvgRank ?? "—"} hint={`${ref.rankedCount} ranked`} />
                      <StatCard label="Refinement candidates" value={ref.candidates.length} hint="weaker than the set" />
                      <StatCard label="Portfolio size rule" value={ref.portfolioSize} hint="keywords.portfolio.size" />
                    </div>
                    {ref.candidates.length ? (
                      <div className="table-scroll">
                        <table className="data">
                          <thead>
                            <tr><th>Keyword</th><th>Avg rank</th><th>Top 3 %</th><th>Why flagged</th></tr>
                          </thead>
                          <tbody>
                            {ref.candidates.map((c) => (
                              <tr key={c.phrase}>
                                <td>{c.phrase}</td>
                                <td className="tabnum">{c.avgRank ?? "—"}</td>
                                <td className="tabnum">{c.top3Pct != null ? `${c.top3Pct}%` : "—"}</td>
                                <td className="muted" style={{ fontSize: 12 }}>{c.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                        No refinement candidates — every tracked keyword holds its own against the portfolio. ✅
                      </p>
                    )}
                    <ul className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0, paddingLeft: 18 }}>
                      {ref.notes.map((n, i) => (<li key={i}>{n}</li>))}
                    </ul>
                    <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                      Thresholds from the <Link href="/rules">Rule Library</Link> (portfolio size, low-performance band).
                    </p>
                  </Panel>
                );
              })()}
              <KeywordsManager
                projectId={selected.id}
                clientId={selected.clientId}
                keywords={await listKeywords(authz.tenantId, selected.id)}
              />
            </>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
