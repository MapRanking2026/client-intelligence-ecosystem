import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatCard, UnauthorizedPage } from "@/src/components/states";
import { ClientSelect } from "@/src/components/client-select";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";
import { getPerformanceSnapshotRepo } from "@/src/lib/server/repositories/performance-snapshot-repo";
import { listIntegrations } from "@/src/lib/server/integrations-service";

export const dynamic = "force-dynamic";

// SEO Dashboard metric labels that belong to GBP performance / reviews.
const GBP_METRICS = ["Aug GBP views", "Aug check-ins", "Jul check-ins", "Satisfaction", "Health score", "Main category"];

export default async function GbpPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  if (!authzHas(authz, "seo.package.read")) {
    return (
      <AppShell authz={authz} title="GBP & Local Presence" breadcrumbs={[{ label: "SEOOS" }, { label: "GBP & Local Presence" }]}>
        <div className="state state--blocked"><span className="badge badge--warn">Permission required</span></div>
      </AppShell>
    );
  }

  const projects = await listProjectsForViewer(authz);
  const { projectId } = await searchParams;
  const selected = projects.find((p) => p.id === projectId) ?? projects[0];
  const snapshot = selected ? await getPerformanceSnapshotRepo().get(authz.tenantId, selected.id) : null;

  const integrations = await listIntegrations(authz.tenantId);
  const gbpConnected = integrations.some((i) => i.id === "google-business-profile" && i.status === "connected");

  const metrics = selected?.dashboardMetrics ?? {};
  const gbpEntries = GBP_METRICS.filter((k) => metrics[k]).map((k) => [k, metrics[k]] as const);

  return (
    <AppShell
      authz={authz}
      title="GBP & Local Presence"
      subtitle="GBP performance, reviews, and Map Check-In activity"
      breadcrumbs={[{ label: "SEOOS" }, { label: "GBP & Local Presence" }]}
    >
      {projects.length === 0 ? (
        <EmptyState
          title="No clients yet"
          message="Sync clients from ClickUp, then pick one to see its local presence."
          action={<Link href="/clients">Clients →</Link>}
        />
      ) : (
        <>
          <ClientSelect
            projects={projects.map((p) => ({ id: p.id, businessName: p.businessName }))}
            selectedId={selected?.id}
            basePath="/gbp"
          />

          <Panel title="Map Check-In activity">
            {snapshot ? (
              <div className="grid-cards">
                <StatCard label="Businesses" value={snapshot.checkinBusinessCount} hint="Map Check-Ins" />
                <StatCard label="Total posts" value={snapshot.checkinTotalPosts} hint="from Rank Tracker sync" />
              </div>
            ) : (
              <EmptyState
                title="No check-in data yet"
                message="Run a full scan on this client (Rank Tracker connection) to pull Map Check-In activity."
                action={selected ? <Link href={`/clients/${selected.id}`}>Open client →</Link> : undefined}
              />
            )}
          </Panel>

          <Panel title="GBP performance & reviews">
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
              {gbpConnected
                ? "Google Business Profile is connected. Live GBP insights/reviews pull is being wired; the figures below are from the ClickUp SEO Dashboard."
                : "Connect Google Business Profile under Integrations for live insights & reviews. The figures below are from the ClickUp SEO Dashboard."}
            </p>
            {gbpEntries.length ? (
              <div className="grid-cards">
                {gbpEntries.map(([label, value]) => (
                  <StatCard key={label} label={label} value={value} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No GBP figures yet"
                message="These come from the SEO Dashboard fields (GBP views, check-ins, satisfaction) — run a client sync."
                action={<Link href="/integrations">Integrations →</Link>}
              />
            )}
          </Panel>
        </>
      )}
    </AppShell>
  );
}
