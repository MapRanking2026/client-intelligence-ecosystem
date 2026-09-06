import Link from "next/link";
import { canAccessClient } from "@cie/core";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatCard, UnauthorizedPage } from "@/src/components/states";
import { FullScanButton } from "@/src/components/full-scan-button";
import { GenerateAiRecsButton } from "@/src/components/generate-ai-recs-button";
import { StartServiceButton } from "@/src/components/start-service-button";
import { getProject } from "@/src/lib/server/projects-service";
import { getPerformanceSnapshotRepo } from "@/src/lib/server/repositories/performance-snapshot-repo";
import { getKeywordRepo } from "@/src/lib/server/repositories/keyword-repo";
import { getRecommendationRepo } from "@/src/lib/server/repositories/recommendation-repo";
import { SERVICE_OFFERINGS } from "@/src/lib/domain/service-offering";

export const dynamic = "force-dynamic";

function Check({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li style={{ marginBottom: 6 }}>
      <span style={{ color: done ? "var(--ok, #3fb950)" : "var(--muted)" }}>{done ? "✓" : "○"}</span>{" "}
      {children}
    </li>
  );
}

export default async function ProjectSetupPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  const canManage = authzHas(authz, "seo.project.manage");

  const { projectId } = await params;
  const project = await getProject(authz.tenantId, projectId);
  if (!project || !canAccessClient(authz.clientVisibility, project.clientId)) {
    return (
      <AppShell authz={authz} title="Project" breadcrumbs={[{ label: "SEOOS" }, { label: "Clients", href: "/clients" }]}>
        <EmptyState title="Not found" message="This project isn't available." action={<Link href="/clients">← Clients</Link>} />
      </AppShell>
    );
  }

  const [snapshot, keywords, recs] = await Promise.all([
    getPerformanceSnapshotRepo().get(authz.tenantId, projectId),
    getKeywordRepo().listByProject(authz.tenantId, projectId),
    getRecommendationRepo().listByProject(authz.tenantId, projectId),
  ]);
  const hasData = Boolean(snapshot && (snapshot.grids.length || snapshot.keywords.length));

  return (
    <AppShell
      authz={authz}
      title={project.businessName}
      subtitle={`Setup ${project.setupReadiness}% · ${project.stage}`}
      breadcrumbs={[{ label: "SEOOS" }, { label: "Clients", href: "/clients" }, { label: project.businessName }]}
    >
      <Panel title="Client">
        <div className="grid-cards" style={{ marginBottom: 12 }}>
          <StatCard label="Setup readiness" value={`${project.setupReadiness}%`} />
          <StatCard label="Keywords" value={keywords.length} />
          <StatCard label="Recommendations" value={recs.length} />
          <StatCard label="Pod" value={project.externalIds?.pod ?? "—"} />
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          {project.website ? <>🔗 {project.website} · </> : null}
          {project.niche ? <>Niche: {project.niche} · </> : null}
          {project.serviceTier ? <>Services: {project.serviceTier} · </> : null}
          {project.valueProposition ? <>“{project.valueProposition}”</> : null}
        </p>
      </Panel>

      {Object.keys(project.dashboardMetrics ?? {}).length ? (
        <Panel title="SEO Dashboard (from ClickUp)">
          <div className="grid-cards">
            {Object.entries(project.dashboardMetrics).map(([label, value]) => (
              <StatCard key={label} label={label} value={value} />
            ))}
          </div>
        </Panel>
      ) : null}

      {canManage ? (
        <Panel title="Setup wizard">
          <FullScanButton projectId={project.id} />
          <ol style={{ listStyle: "none", padding: 0, marginTop: 10 }}>
            <Check done={Boolean(project.niche || project.valueProposition)}>
              Intake context (niche / value proposition) — <Link href="/clients">edit on create</Link>
            </Check>
            <Check done={hasData}>Full scan — pull Rank Tracker grids + Map Check-Ins</Check>
            <Check done={keywords.length > 0}>
              Keyword selection — <Link href={`/keywords?projectId=${project.id}`}>manage keywords →</Link>
            </Check>
            <Check done={recs.length > 0}>
              Phase-1 recommendations — generate below, then approve
            </Check>
          </ol>
          <GenerateAiRecsButton projectId={project.id} />
        </Panel>
      ) : null}

      <Panel title="Workspace">
        <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
          <Link className="badge" href={`/keywords?projectId=${project.id}`}>Keywords</Link>
          <Link className="badge" href={`/rankings?projectId=${project.id}`}>Rankings &amp; Grids</Link>
          <Link className="badge" href={`/recommendations?projectId=${project.id}`}>Recommendations</Link>
          <Link className="badge" href={`/work-orders?projectId=${project.id}`}>Work Orders</Link>
          <Link className="badge" href={`/reports/${project.id}`}>Monthly report</Link>
        </div>
      </Panel>

      {canManage ? (
        <Panel title="Services">
          {SERVICE_OFFERINGS.map((o) => (
            <div key={o.id} style={{ marginBottom: 12 }}>
              <strong>{o.name}</strong> — ${o.priceUsd} {o.cadence === "one_time" ? "one-time" : "/mo"}
              <div className="muted" style={{ fontSize: 13 }}>{o.description}</div>
              <StartServiceButton projectId={project.id} offeringId={o.id} label={`Start ${o.name}`} />
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12 }}>
            Starting a service creates an internal work order for the team — it never charges or notifies the client.
          </p>
        </Panel>
      ) : null}
    </AppShell>
  );
}
