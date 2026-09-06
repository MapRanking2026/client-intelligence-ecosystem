import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, UnauthorizedPage } from "@/src/components/states";
import { ClientSelect } from "@/src/components/client-select";
import { AuditPanel } from "@/src/components/audit-panel";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";

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
