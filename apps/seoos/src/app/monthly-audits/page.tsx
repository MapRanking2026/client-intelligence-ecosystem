import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, UnauthorizedPage } from "@/src/components/states";
import { MonthlyAuditManager } from "@/src/components/monthly-audit-manager";
import { ClientSelect } from "@/src/components/client-select";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";
import { listMonthlyAudits } from "@/src/lib/server/monthly-audits-service";

export const dynamic = "force-dynamic";

export default async function MonthlyAuditsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; auditId?: string }>;
}) {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  if (!authzHas(authz, "seo.package.read")) {
    return (
      <AppShell authz={authz} title="Monthly Audits" breadcrumbs={[{ label: "SEOOS" }, { label: "Monthly Audits" }]}>
        <div className="state state--blocked"><span className="badge badge--warn">Permission required</span></div>
      </AppShell>
    );
  }

  const projects = await listProjectsForViewer(authz);
  const { projectId, auditId } = await searchParams;
  const selectedProject = projects.find((p) => p.id === projectId) ?? projects[0];
  const audits = selectedProject ? await listMonthlyAudits(authz.tenantId, selectedProject.id) : [];
  const selectedAudit = audits.find((a) => a.id === auditId) ?? audits[0] ?? null;

  return (
    <AppShell
      authz={authz}
      title="Monthly Audits"
      subtitle="Structured monthly SEO audit book · unresolved items carry forward"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Monthly Audits" }]}
    >
      {projects.length === 0 ? (
        <EmptyState title="No projects" message="Create a project to run monthly audits." action={<Link href="/clients">Clients →</Link>} />
      ) : (
        <>
          <ClientSelect
            projects={projects.map((p) => ({ id: p.id, businessName: p.businessName }))}
            selectedId={selectedProject?.id}
            basePath="/monthly-audits"
          />
          {audits.length > 0 && selectedProject ? (
            <div className="toolbar">
              <span className="muted" style={{ fontSize: 12 }}>Period:</span>
              {audits.map((a) => (
                <Link key={a.id} href={`/monthly-audits?projectId=${selectedProject.id}&auditId=${a.id}`}
                  className={`badge${a.id === selectedAudit?.id ? " status-active" : ""}`}>
                  {a.period}
                </Link>
              ))}
            </div>
          ) : null}
          {selectedProject ? (
            <MonthlyAuditManager
              projectId={selectedProject.id}
              audit={selectedAudit}
              canManage={authzHas(authz, "seo.project.manage")}
              canQa={authzHas(authz, "seo.package.qa")}
            />
          ) : null}
        </>
      )}
    </AppShell>
  );
}
