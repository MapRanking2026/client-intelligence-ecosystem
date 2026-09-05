import Link from "next/link";
import { canAccessClient } from "@cie/core";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, PhaseNote, UnauthorizedPage } from "@/src/components/states";
import { RecommendationsManager } from "@/src/components/recommendations-manager";
import { listProjects } from "@/src/lib/server/projects-service";
import { listRecommendations } from "@/src/lib/server/recommendations-service";

export const dynamic = "force-dynamic";

export default async function RecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  if (!authzHas(authz, "seo.package.read")) {
    return (
      <AppShell authz={authz} title="Recommendations" breadcrumbs={[{ label: "SEOOS" }, { label: "Recommendations" }]}>
        <div className="state state--blocked"><span className="badge badge--warn">Permission required</span></div>
      </AppShell>
    );
  }

  const projects = (await listProjects(authz.tenantId)).filter((p) =>
    canAccessClient(authz.clientVisibility, p.clientId),
  );
  const { projectId } = await searchParams;
  const selected = projects.find((p) => p.id === projectId) ?? projects[0];
  const recs = selected ? await listRecommendations(authz.tenantId, selected.id) : [];

  return (
    <AppShell
      authz={authz}
      title="Recommendations"
      subtitle="Evidence-grounded, human-decided, convertible to work"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Recommendations" }]}
    >
      <PhaseNote phase="Phase 6" purpose="AI generation via the Prompt Engine feeds this queue; the decision + conversion lifecycle below is live." />
      {projects.length === 0 ? (
        <EmptyState title="No projects" message="Create a project to manage recommendations." action={<Link href="/clients">Clients →</Link>} />
      ) : (
        <>
          <div className="toolbar">
            <span className="muted" style={{ fontSize: 12 }}>Project:</span>
            {projects.map((p) => (
              <Link key={p.id} href={`/recommendations?projectId=${p.id}`} className={`badge${p.id === selected?.id ? " status-active" : ""}`}>
                {p.businessName}
              </Link>
            ))}
          </div>
          <RecommendationsManager
            recommendations={recs}
            canManage={authzHas(authz, "seo.project.manage")}
            canApprove={authzHas(authz, "seo.work.approve")}
          />
        </>
      )}
    </AppShell>
  );
}
