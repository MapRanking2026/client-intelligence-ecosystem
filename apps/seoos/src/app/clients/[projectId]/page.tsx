import Link from "next/link";
import { canAccessClient } from "@cie/core";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatCard, UnauthorizedPage } from "@/src/components/states";
import { FullScanButton } from "@/src/components/full-scan-button";
import { GenerateAiRecsButton } from "@/src/components/generate-ai-recs-button";
import { StartServiceButton } from "@/src/components/start-service-button";
import { getProject } from "@/src/lib/server/projects-service";
import { getClientHealth } from "@/src/lib/server/client-health-service";
import { getRankingsIntel } from "@/src/lib/server/rankings-intelligence-service";
import { getMonthlyScoreReadout } from "@/src/lib/server/scoring-service";
import { getLowPerformanceDiagnosis } from "@/src/lib/server/low-performance-service";
import { getOffboardingChecklist } from "@/src/lib/server/offboarding-service";
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
  const [health, intel, score] = await Promise.all([
    getClientHealth(authz, project),
    getRankingsIntel(authz, project),
    getMonthlyScoreReadout(authz, project),
  ]);
  const lpDiagnosis = await getLowPerformanceDiagnosis(authz, project, intel);
  const offboarding = canManage ? getOffboardingChecklist(project) : null;
  const healthLabel =
    health.status === "at_risk" ? "At risk" : health.status === "needs_attention" ? "Needs attention" : "On track";
  const intelBadge =
    intel.verdict === "dominating"
      ? { label: "Dominating", cls: "status-active", style: undefined as React.CSSProperties | undefined }
      : intel.verdict === "low_performance"
        ? { label: "Low performance", cls: "", style: { borderColor: "var(--danger)", color: "var(--danger)" } }
        : intel.verdict === "progressing"
          ? { label: "Progressing", cls: "badge--warn", style: undefined }
          : { label: "No data", cls: "", style: undefined };

  return (
    <AppShell
      authz={authz}
      title={project.businessName}
      subtitle={`Setup ${project.setupReadiness}% · ${project.stage}`}
      breadcrumbs={[{ label: "SEOOS" }, { label: "Clients", href: "/clients" }, { label: project.businessName }]}
    >
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <a className="badge status-active" href="#projects" style={{ padding: "8px 14px" }}>
          Projects ({project.services?.length ?? 0})
        </a>
      </div>

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

      <Panel title="Health & what's needed">
        <div className="toolbar" style={{ marginBottom: 10, alignItems: "center", gap: 12 }}>
          <span
            className={`badge ${health.status === "needs_attention" ? "badge--warn" : health.status === "on_track" ? "status-active" : ""}`}
            style={health.status === "at_risk" ? { borderColor: "var(--danger)", color: "var(--danger)" } : undefined}
          >
            {healthLabel}
          </span>
          {health.inPlace.length ? (
            <span className="muted" style={{ fontSize: 12 }}>In place: {health.inPlace.join(" · ")}</span>
          ) : null}
        </div>
        {health.needs.length === 0 ? (
          <p className="muted" style={{ marginTop: 0 }}>Nothing blocking this client right now. ✅</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {health.needs.map((n, idx) => (
              <li key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    flex: "none",
                    background:
                      n.severity === "high" ? "var(--danger)" : n.severity === "medium" ? "#e0a500" : "var(--muted)",
                  }}
                />
                <span>{n.label}</span>
                {n.href ? (
                  <Link href={n.href} style={{ marginLeft: "auto", fontSize: 13 }}>Open →</Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Rankings intelligence">
        <div className="toolbar" style={{ marginBottom: 10, alignItems: "center", gap: 12 }}>
          <span className={`badge ${intelBadge.cls}`} style={intelBadge.style}>{intelBadge.label}</span>
          {intel.verdict !== "no_data" ? (
            <span className="muted" style={{ fontSize: 12 }}>
              {intel.top3Keywords}/{intel.trackedKeywords} keywords in top {intel.applied.top3RankCutoff} · avg rank {intel.avgRank ?? "—"}
            </span>
          ) : null}
        </div>
        <p style={{ marginTop: 0, fontSize: 13 }}>{intel.headline}</p>
        {intel.verdict === "dominating" ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Rule applied: {intel.trackedKeywords <= intel.applied.portfolioSize
              ? `${intel.applied.top3CountRule}+ of the tracked keywords in the top ${intel.applied.top3RankCutoff}`
              : `${intel.applied.top3PctRule}%+ of keywords in the top ${intel.applied.top3RankCutoff}`}
            {" · "}<Link href="/rules">tune in Rule Library →</Link>
          </p>
        ) : intel.verdict === "low_performance" ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Low-Performance band {intel.applied.lowPerfBand[0]}-{intel.applied.lowPerfBand[1]} ·{" "}
            <Link href={`/recommendations?projectId=${project.id}`}>build an improvement plan →</Link>
            {" · "}<Link href="/rules">tune band →</Link>
          </p>
        ) : null}
      </Panel>

      {lpDiagnosis.applicable ? (
        <Panel title="Low-Performance diagnosis">
          <div className="toolbar" style={{ marginBottom: 8, alignItems: "center", gap: 12 }}>
            <span className="badge" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
              {lpDiagnosis.subclassLabel}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              avg rank {lpDiagnosis.avgRank ?? "—"} · band {lpDiagnosis.band[0]}-{lpDiagnosis.band[1]}
            </span>
          </div>
          <p style={{ marginTop: 0, fontSize: 13 }}>{lpDiagnosis.summary}</p>
          <h4 style={{ margin: "10px 0 6px", fontSize: 13 }}>Improvement plan (by impact)</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {lpDiagnosis.plan.map((a, i) => (
              <li key={i} style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 13 }}>
                <span
                  className="badge"
                  style={{
                    flex: "none",
                    fontSize: 10,
                    textTransform: "uppercase",
                    borderColor: a.tier === "high" ? "var(--danger)" : a.tier === "medium" ? "#e0a500" : "var(--border)",
                    color: a.tier === "high" ? "var(--danger)" : a.tier === "medium" ? "#e0a500" : "var(--muted)",
                  }}
                >
                  {a.tier}
                </span>
                <span>{a.action}</span>
              </li>
            ))}
          </ul>
          <h4 style={{ margin: "12px 0 6px", fontSize: 13 }}>Confirm before committing the plan</h4>
          <ul className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 8, paddingLeft: 18 }}>
            {lpDiagnosis.confirmNext.map((c, i) => (<li key={i}>{c}</li>))}
          </ul>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            <Link href={`/recommendations?projectId=${project.id}`}>Turn into recommendations →</Link>
            {" · "}<Link href="/rules">tune the band →</Link>
          </p>
        </Panel>
      ) : null}

      <Panel title="Monthly performance — Results pillar">
        {score.hasData ? (
          <>
            <div className="grid-cards" style={{ marginBottom: 10 }}>
              <StatCard label="Top 5" value={`${score.distribution.top5Pct}%`} hint={`${score.distribution.rankedKeywords} keywords`} />
              <StatCard label="Pos 5–12" value={`${score.distribution.pos5to12Pct}%`} />
              <StatCard label="Pos 12–20" value={`${score.distribution.pos12to20Pct}%`} />
              <StatCard
                label="Results distribution"
                value={`${score.resultsDistributionPoints} / ${score.resultsDistributionMax}`}
                hint="documented bands (M10.40)"
              />
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              Grid weight applied: <strong>{score.gridWeight ?? "—"}</strong>
              {score.gridSize ? ` (grid ${score.gridSize}, ~${score.gridRadiusAssumedMiles}mi assumed)` : ""} ·
              Results pillar cap {score.resultsPillarMax} pts · from{" "}
              <Link href="/rules">Rule Library</Link> (scoring.results_grid_weights).
            </p>
            <p className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              Tier scale: {score.tierScale}
            </p>
          </>
        ) : (
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            No grid data yet — run a full scan to compute the Results pillar.
          </p>
        )}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Not computed here (need org-internal inputs SEOOS doesn't hold yet): {score.uncomputedPillars.join(" · ")}.
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
              <strong>1. Intake context</strong> — niche / value proposition{" "}
              {project.niche ? `(${project.niche})` : ""}
            </Check>
            <Check done={hasData}>
              <strong>2. Full scan</strong> — pull Rank Tracker grids + Map Check-Ins ·{" "}
              <Link href={`/rankings?projectId=${project.id}`}>view rankings →</Link>
            </Check>
            <Check done={keywords.length > 0}>
              <strong>3. Keywords</strong> — {keywords.length} tracked ·{" "}
              <Link href={`/keywords?projectId=${project.id}`}>manage keywords →</Link>
            </Check>
            <Check done={recs.length > 0}>
              <strong>4. Phase-1 recommendations</strong> — {recs.length} generated ·{" "}
              <Link href={`/recommendations?projectId=${project.id}`}>review &amp; approve →</Link>
            </Check>
            <Check done={hasData}>
              <strong>5. Monthly report</strong> —{" "}
              <Link href={`/reports/${project.id}`}>generate the full report →</Link>
            </Check>
          </ol>
          <GenerateAiRecsButton projectId={project.id} />
        </Panel>
      ) : null}

      <div id="projects">
        <Panel title={`Projects for ${project.businessName} (${project.services?.length ?? 0})`}>
          {project.services && project.services.length ? (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr><th>Project / service</th><th>Client</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {project.services.map((s) => (
                    <tr key={s}>
                      <td>{s}</td>
                      <td className="muted">{project.businessName}</td>
                      <td>
                        <Link className="badge" href={`/work-orders?projectId=${project.id}`}>Work orders</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              No projects/services listed for this client yet. They come from the ClickUp
              <strong> ⭐ Services</strong> field — run a full scan to pull them.
            </p>
          )}
        </Panel>
      </div>

      {offboarding ? (
        <details className="panel" open={offboarding.windingDown} style={{ marginBottom: 12 }}>
          <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong>Offboarding checklist</strong>
            {offboarding.windingDown ? <span className="badge badge--warn" style={{ fontSize: 11 }}>winding down</span> : null}
            <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
              {offboarding.counts.total} steps · {offboarding.counts.internal} SEOOS can do ·{" "}
              {offboarding.outboundLocked ? `${offboarding.counts.externalBlocked} blocked by outbound lock` : "external steps unlocked"}
            </span>
          </summary>
          {offboarding.outboundLocked ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              🔒 The outbound lock is ON — SEOOS will not change any external system. Do the external steps by hand,
              or lift the lock (<code>SEOOS_OUTBOUND_UNLOCKED=true</code>) when ready. SEOOS can still do the internal
              closure steps.
            </p>
          ) : null}
          {[...new Set(offboarding.items.map((i) => i.group))].map((group) => (
            <div key={group} style={{ marginTop: 10 }}>
              <h4 style={{ margin: "0 0 4px", fontSize: 13 }}>{group}</h4>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {offboarding.items.filter((i) => i.group === group).map((it, i) => (
                  <li key={i} style={{ display: "flex", gap: 8, marginBottom: 4, fontSize: 13 }}>
                    <span aria-hidden="true" style={{ flex: "none" }}>
                      {it.external ? (offboarding.outboundLocked ? "🔒" : "↗") : "☑"}
                    </span>
                    <span>
                      {it.label}
                      {it.note ? <span className="muted" style={{ fontSize: 12 }}> — {it.note}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
            ☑ = SEOOS can do it internally · {offboarding.outboundLocked ? "🔒 = external, blocked by the lock" : "↗ = external"}
          </p>
        </details>
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
              <strong>{o.name}</strong>
              <div className="muted" style={{ fontSize: 13 }}>{o.description}</div>
              <StartServiceButton projectId={project.id} offeringId={o.id} label={o.ctaLabel} />
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
