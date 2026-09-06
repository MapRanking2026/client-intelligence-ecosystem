import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, UnauthorizedPage } from "@/src/components/states";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";

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

  const projects = await listProjectsForViewer(authz);
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

      <Panel title="Niche case studies (Drive)">
        <p className="muted" style={{ fontSize: 13 }}>
          Importing your Drive niche studies into the AI context is the next step here — it will let the
          AI cite proven playbooks per niche. Not connected yet.
        </p>
      </Panel>
    </AppShell>
  );
}
