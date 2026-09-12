import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatCard, UnauthorizedPage } from "@/src/components/states";
import { ClientSelect } from "@/src/components/client-select";
import { GbpLivePanel } from "@/src/components/gbp-live-panel";
import { GenerateGbpAuditButton } from "@/src/components/generate-gbp-audit-button";
import { getGbpAudit } from "@/src/lib/server/gbp-audit-service";
import { getMtReadiness } from "@/src/lib/server/mt-readiness-service";
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
  const canManage = authzHas(authz, "seo.project.manage");
  const gbpAudit = selected ? await getGbpAudit(authz.tenantId, selected.id) : null;
  const readiness = selected ? await getMtReadiness(authz, selected) : null;

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

          {readiness ? (
            <Panel title="Monthly-Touch readiness">
              <div className="toolbar" style={{ marginBottom: 10, alignItems: "center", gap: 12 }}>
                <span
                  className={`badge ${readiness.ready ? "status-active" : "badge--warn"}`}
                >
                  {readiness.ready ? "Ready" : "Not ready"} · {readiness.completenessPct}%
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  Gate: {readiness.completenessGatePct}% complete ·{" "}
                  <Link href="/rules">tune in Rule Library →</Link>
                </span>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {readiness.items.map((it) => (
                  <li key={it.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, fontSize: 13 }}>
                    <span aria-hidden="true" style={{ flex: "none" }}>
                      {it.state === "ready" ? "✅" : it.state === "manual" ? "🔎" : "⬜"}
                    </span>
                    <span>{it.label}</span>
                    {it.detail ? <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>{it.detail}</span> : null}
                  </li>
                ))}
              </ul>
              <h4 style={{ margin: "12px 0 6px", fontSize: 13 }}>Manual checks (no API confirms these)</h4>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {readiness.manualChecks.map((it) => (
                  <li key={it.label} style={{ fontSize: 12, marginBottom: 5 }}>
                    <span aria-hidden="true">🔎</span> <strong>{it.label}</strong>
                    {it.detail ? <span className="muted"> — {it.detail}</span> : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

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
            {gbpConnected && selected ? (
              <GbpLivePanel projectId={selected.id} />
            ) : (
              <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                Connect Google Business Profile under <Link href="/integrations">Integrations</Link> for live
                insights &amp; reviews.
              </p>
            )}

            <h4 style={{ margin: "14px 0 8px" }}>From the ClickUp SEO Dashboard</h4>
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

          <Panel title="GBP Audit — AI draft (nothing published)">
            {selected ? (
              <>
                {canManage ? <GenerateGbpAuditButton projectId={selected.id} hasAudit={Boolean(gbpAudit)} /> : null}
                {gbpAudit ? (
                  <>
                    <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                      Generated {new Date(gbpAudit.generatedAt).toLocaleString()}.
                      {gbpAudit.dataNote ? ` ${gbpAudit.dataNote}` : ""}
                    </p>
                    <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.55, margin: 0 }}>
                      {gbpAudit.content}
                    </pre>
                  </>
                ) : (
                  <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
                    {canManage
                      ? "Generate an AI GBP audit — it drafts a keyword set, category plan, description, and completeness check from what we know, and flags anything it can't verify. Nothing is sent to Google."
                      : "No GBP audit generated yet."}
                  </p>
                )}
              </>
            ) : null}
          </Panel>
        </>
      )}
    </AppShell>
  );
}
