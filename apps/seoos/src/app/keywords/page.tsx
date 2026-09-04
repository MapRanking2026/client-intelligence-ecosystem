import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, UnauthorizedPage } from "@/src/components/states";
import { KeywordsManager } from "@/src/components/keywords-manager";
import { listProjects } from "@/src/lib/server/projects-service";
import { listKeywords } from "@/src/lib/server/keywords-service";

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

  const projects = await listProjects(authz.tenantId);
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
          <div className="toolbar">
            <span className="muted" style={{ fontSize: 12 }}>Project:</span>
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/keywords?projectId=${p.id}`}
                className={`badge${p.id === selected?.id ? " status-active" : ""}`}
              >
                {p.businessName}
              </Link>
            ))}
          </div>
          {selected ? (
            <KeywordsManager
              projectId={selected.id}
              clientId={selected.clientId}
              keywords={await listKeywords(authz.tenantId, selected.id)}
            />
          ) : null}
        </>
      )}
    </AppShell>
  );
}
