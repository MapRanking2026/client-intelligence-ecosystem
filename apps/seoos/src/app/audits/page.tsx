import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatCard, UnauthorizedPage } from "@/src/components/states";
import { ClientSelect } from "@/src/components/client-select";
import { AuditPanel } from "@/src/components/audit-panel";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";
import { getContentPlan } from "@/src/lib/server/content-plan-service";

export const dynamic = "force-dynamic";

export default async function AuditsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  if (!authzHas(authz, "seo.package.read")) {
    return (
      <AppShell authz={authz} title="Website Audits" breadcrumbs={[{ label: "SEOOS" }, { label: "Website Audits" }]}>
        <div className="state state--blocked"><span className="badge badge--warn">Permission required</span></div>
      </AppShell>
    );
  }

  const projects = await listProjectsForViewer(authz);
  const { projectId } = await searchParams;
  const selected = projects.find((p) => p.id === projectId) ?? projects[0];

  return (
    <AppShell
      authz={authz}
      title="Website Audits"
      subtitle="On-page technical audit + Search Console performance"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Website Audits" }]}
    >
      {projects.length === 0 ? (
        <EmptyState
          title="No clients yet"
          message="Sync clients from ClickUp, then audit each one's website."
          action={<Link href="/clients">Clients →</Link>}
        />
      ) : (
        <>
          <ClientSelect
            projects={projects.map((p) => ({ id: p.id, businessName: p.businessName }))}
            selectedId={selected?.id}
            basePath="/audits"
          />
          {selected ? (
            <>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                Auditing <strong>{selected.businessName}</strong>
                {selected.website ? ` · ${selected.website}` : " · no website on file"}.
              </p>
              {await (async () => {
                const plan = await getContentPlan(authz, selected);
                return (
                  <Panel title="Content & page plan">
                    <div className="grid-cards" style={{ marginBottom: 10 }}>
                      <StatCard label="Homepage" value={plan.counts.tier1} hint="Tier 1" />
                      <StatCard label="Service pages" value={plan.counts.tier2} hint="Tier 2" />
                      <StatCard label="Location pages" value={plan.counts.tier3a} hint="Tier 3A" />
                      <StatCard label="Service+City" value={plan.counts.tier3b} hint="Tier 3B candidates" />
                    </div>
                    <div className="table-scroll">
                      <table className="data">
                        <thead>
                          <tr><th>Tier</th><th>Type</th><th>Page</th><th>Keywords / note</th></tr>
                        </thead>
                        <tbody>
                          {plan.pages.map((p, i) => (
                            <tr key={i}>
                              <td><span className="badge" style={{ fontSize: 10 }}>{p.tier}</span></td>
                              <td>{p.type}</td>
                              <td>{p.title}</td>
                              <td className="muted" style={{ fontSize: 12 }}>
                                {p.keywordCount != null ? `${p.keywordCount} keyword${p.keywordCount === 1 ? "" : "s"}` : ""}
                                {p.note ? (p.keywordCount != null ? ` · ${p.note}` : p.note) : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {plan.gaps.length ? (
                      <>
                        <h4 style={{ margin: "12px 0 6px", fontSize: 13 }}>Coverage gaps</h4>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                          {plan.gaps.map((g, i) => (<li key={i} style={{ marginBottom: 3 }}>{g}</li>))}
                        </ul>
                      </>
                    ) : null}
                    <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
                      Keep every page within {plan.maxDepthClicks} clicks of home (architecture.max_depth_clicks ·{" "}
                      <Link href="/rules">Rule Library</Link>).
                      {plan.notes.length ? " " + plan.notes.join(" ") : ""}
                    </p>
                  </Panel>
                );
              })()}
              <AuditPanel projectId={selected.id} />
            </>
          ) : (
            <Panel title="Website Audits">
              <EmptyState title="Pick a client" message="Choose a client above to run its audit." />
            </Panel>
          )}
        </>
      )}
    </AppShell>
  );
}
