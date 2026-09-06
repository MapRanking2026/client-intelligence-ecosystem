import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, UnauthorizedPage } from "@/src/components/states";
import { NicheStudyManager, type StudyRow } from "@/src/components/niche-study-manager";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";
import { listNicheStudies } from "@/src/lib/server/niche-studies-service";
import { listIntegrations } from "@/src/lib/server/integrations-service";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  if (!authzHas(authz, "seo.package.read")) {
    return (
      <AppShell authz={authz} title="Knowledge / Niche Studies" breadcrumbs={[{ label: "SEOOS" }, { label: "Knowledge" }]}>
        <div className="state state--blocked"><span className="badge badge--warn">Permission required</span></div>
      </AppShell>
    );
  }

  const isAdmin = authz.clientVisibility === "all";
  const projects = await listProjectsForViewer(authz);
  const studies = await listNicheStudies(authz.tenantId);
  const driveConnected = isAdmin
    ? (await listIntegrations(authz.tenantId)).some((i) => i.id === "google-drive" && i.status === "connected")
    : false;
  const studyRows: StudyRow[] = studies.map((s) => ({ id: s.id, title: s.title, niche: s.niche, source: s.source }));
  const byNiche = new Map<string, number>();
  for (const p of projects) {
    const n = (p.niche ?? "").trim();
    if (n) byNiche.set(n, (byNiche.get(n) ?? 0) + 1);
  }
  const niches = [...byNiche.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <AppShell
      authz={authz}
      title="Knowledge / Niche Studies"
      subtitle="The niche context that grounds AI recommendations"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Knowledge" }]}
    >
      <Panel title={`Niches in your book (${niches.length})`}>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Each client&apos;s niche (from ClickUp / intake) is fed to the AI so recommendations learn from
          similar businesses. Generate AI recommendations on a client to use it.
        </p>
        {niches.length === 0 ? (
          <EmptyState
            title="No niches yet"
            message="Sync clients from ClickUp (the SEO Dashboard's Niche / Main Category field) or set a niche on a client."
            action={<Link href="/clients">Clients →</Link>}
          />
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Niche</th><th>Clients</th></tr></thead>
              <tbody>
                {niches.map(([niche, count]) => (
                  <tr key={niche}><td>{niche}</td><td>{count}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={`Niche case studies (${studies.length})`}>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          These playbooks are fed to the AI when it generates recommendations for a matching-niche client.
          Add them by hand or import Google Docs from a Drive folder.
        </p>
        {isAdmin ? (
          <NicheStudyManager studies={studyRows} driveConnected={driveConnected} />
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>{studies.length} study/studies available. Admins manage them.</p>
        )}
      </Panel>
    </AppShell>
  );
}
