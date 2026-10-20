import Link from "next/link";

import { AivShell, Denied, Disclaimer, pageContext } from "@/src/components/ai-visibility/aiv-shell";
import { FilterBar } from "@/src/components/ai-visibility/filter-bar";
import { MetricCard } from "@/src/components/ai-visibility/metric-card";
import { InitProfileButton, ReanalyzeButton } from "@/src/components/ai-visibility/small-actions";
import { TrendChart } from "@/src/components/ai-visibility/trend-chart";
import { EmptyState } from "@/src/components/states";
import { filterToQuery, parseViewFilter, type ViewFilter } from "@/src/lib/ai-visibility/filters";
import { COMPOSITE_WEIGHTS, computeMetrics, computeTrend, METRIC_DEFINITIONS, type CoverageRow } from "@/src/lib/ai-visibility/metrics";
import { CHANNEL_LABEL } from "@/src/lib/ai-visibility/types";
import { pct } from "@/src/lib/ai-visibility/util";
import { loadProjectData } from "@/src/lib/server/ai-visibility/data-service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const def = (k: string) => METRIC_DEFINITIONS.find((d) => d.key === k)!.formula;

function CoverageTable({ title, rows, label }: { title: string; rows: CoverageRow[]; label: (k: string) => string }) {
  if (!rows.length) return null;
  return (
    <div className="aiv-table-wrap" style={{ flex: "1 1 320px" }}>
      <h3 style={{ fontSize: 14 }}>{title}</h3>
      <table className="data">
        <thead>
          <tr>
            <th>{title.replace("By ", "")}</th>
            <th className="num">Attempted</th>
            <th className="num">Valid</th>
            <th className="num">Mentioned</th>
            <th className="num">Recommended</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{label(r.key)}</td>
              <td className="num">{r.attempted}</td>
              <td className="num">{r.valid}</td>
              <td className="num">{r.valid ? `${r.mentioned} (${pct(r.mentioned / r.valid)})` : "—"}</td>
              <td className="num">{r.valid ? `${r.recommended} (${pct(r.recommended / r.valid)})` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AivOverview({ params, searchParams }: Props) {
  const { projectId } = await params;
  const ctx = await pageContext(projectId);
  if ("denied" in ctx) return <Denied />;
  const { authz, project } = ctx;
  const canManage = authz.permissions.includes("seo.project.manage");
  const data = await loadProjectData(authz.tenantId, project.id);

  if (!data.profile) {
    return (
      <AivShell authz={authz} project={project} tab="overview">
        <Disclaimer />
        <EmptyState
          title="AI visibility is not set up for this client"
          message="Setup creates a measurement profile from this client record (name, website). You then review services, locations, aliases and competitors before anything is measured."
          action={canManage ? <InitProfileButton projectId={project.id} /> : <span className="muted">Ask a specialist with project permissions to set it up.</span>}
        />
      </AivShell>
    );
  }
  const profile = data.profile;
  const f: ViewFilter = parseViewFilter(await searchParams);
  const { flag: _f, ...mf } = f;
  void _f;
  const m = computeMetrics(data.observations, mf);
  const trend = computeTrend(data.observations, { ...mf }, data.scans.filter((s) => s.plannedCount > 0));
  const base = `/ai-visibility/${project.id}`;
  const link = (flag: string) => `${base}/results${filterToQuery({ ...f, flag })}`;
  const locName = (id: string) => {
    const l = profile.locations.find((x) => x.id === id);
    return l ? `${l.city}${l.region ? `, ${l.region}` : ""}` : id;
  };
  const svcName = (id: string) => profile.services.find((s) => s.id === id)?.value ?? id;
  const running = data.scans.filter((s) => s.status === "queued" || s.status === "running");

  return (
    <AivShell authz={authz} project={project} tab="overview" subtitle={`${CHANNEL_LABEL[f.channel]} · ${f.branded ? "Branded" : "Unbranded"} prompts`} actions={canManage ? <ReanalyzeButton projectId={project.id} /> : undefined}>
      <Disclaimer />
      {profile.status !== "active" ? (
        <p className="aiv-msg aiv-msg--error">Profile is {profile.status}. <Link href={`${base}/setup`}>Review and activate it in Setup</Link> before scanning.</p>
      ) : null}
      {running.length ? (
        <p className="aiv-msg">A scan is in progress — <Link href={`${base}/scans/${running[0].id}`}>view progress</Link>. Numbers below include only completed observations.</p>
      ) : null}
      <FilterBar action={base} filter={f} profile={profile} observations={data.observations} scans={data.scans} />

      {m.sample.total === 0 ? (
        <EmptyState
          title="No observations for these filters"
          message={data.observations.length ? "Try clearing filters or switching channel / prompt type." : "Run a scan to collect the first observations."}
          action={<Link href={`${base}/scans`}>Scans →</Link>}
        />
      ) : (
        <>
          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Sample</h2>
              <a className="aiv-btn aiv-noprint" href={`/api/seo/ai-visibility/projects/${project.id}/export${filterToQuery(mf)}`}>Export CSV (these filters)</a>
            </div>
            <p style={{ margin: 0, fontSize: 14 }}>
              <strong>{m.sample.valid}</strong> valid answers out of <strong>{m.sample.total}</strong> observations.{" "}
              Excluded: <Link href={link("not_collected")}>{m.sample.not_collected} not collected</Link> ·{" "}
              <Link href={link("refusal")}>{m.sample.refusal} refusals</Link> · <Link href={link("no_answer")}>{m.sample.no_answer} empty</Link> ·{" "}
              <Link href={link("not_analyzed")}>{m.sample.not_analyzed} collected but not analyzed</Link>.
            </p>
            {m.smallSample ? <p className="aiv-ev" style={{ color: "var(--aiv-warn)" }}>Small sample (under 30 valid answers): intervals are wide and differences are not statistically meaningful.</p> : null}
          </div>

          <div className="aiv-grid">
            <MetricCard label="Mention rate" rate={m.mentionRate} href={link("mentioned")} swatch="var(--aiv-s1)" formula={def("mention")} />
            <MetricCard label="Recommendation rate" rate={m.recommendationRate} href={link("recommended")} swatch="var(--aiv-s2)" formula={def("recommendation")} />
            <MetricCard label="Owned-domain citation rate" rate={m.ownedCitationRate} href={link("owned_cited")} swatch="var(--aiv-s3)" formula={def("owned_citation")} />
            <MetricCard label="Top-three inclusion" rate={m.top3} href={link("top3")} denominatorLabel="answers with an explicitly ordered list" formula={def("top3")} />
            <MetricCard label="Collection success" rate={m.collectionSuccessRate} href={link("excluded")} denominatorLabel="attempted observations" formula={def("collection")} />
            <MetricCard label="Analysis coverage" rate={m.analysisCoverage} href={link("not_analyzed")} denominatorLabel="successfully collected" formula={def("analysis")} />
            <div className="aiv-metric">
              <div className="aiv-metric-label">Composite score (optional)</div>
              <div className="aiv-metric-value">{m.composite.value === null ? "—" : m.composite.value.toFixed(0)}</div>
              <div className="aiv-metric-sub">
                = 100 × ({COMPOSITE_WEIGHTS.recommendation} × {pct(m.composite.components.recommendation)} rec + {COMPOSITE_WEIGHTS.mention} × {pct(m.composite.components.mention)} mention + {COMPOSITE_WEIGHTS.ownedCitation} × {pct(m.composite.components.ownedCitation)} owned citation)
              </div>
              <div className="aiv-metric-sub">Only comparable within the same prompt set, provider and model.</div>
            </div>
          </div>

          <section className="panel">
            <h2 className="panel-title">Trend by scan</h2>
            <TrendChart points={trend} />
          </section>

          <section className="panel">
            <h2 className="panel-title">Ordered position distribution</h2>
            {m.positionDistribution.length ? (
              <div>
                {m.positionDistribution.map((p) => (
                  <div key={p.position} className="aiv-inline" style={{ margin: "4px 0" }}>
                    <Link href={link(`position:${p.position}`)} style={{ width: 90 }}>Position {p.position}</Link>
                    <div className="aiv-bar" style={{ width: `${Math.max(2, (p.count / Math.max(1, m.top3.den)) * 100)}%`, maxWidth: 400 }} aria-hidden />
                    <span className="muted" style={{ fontSize: 12.5 }}>{p.count} of {m.top3.den} ordered-list answers</span>
                  </div>
                ))}
                <p className="aiv-ev">Only answers that present an explicitly ordered list have positions. Prose answers show “Mentioned; no ordered position”.</p>
              </div>
            ) : (
              <p className="muted">No ordered-list answers mention the client{m.top3.den ? ` (${m.top3.den} ordered-list answers in sample)` : ""}.</p>
            )}
          </section>

          <section className="panel">
            <h2 className="panel-title">Coverage</h2>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <CoverageTable title="By provider · model" rows={m.coverage.provider} label={(k) => k} />
              <CoverageTable title="By service" rows={m.coverage.service} label={svcName} />
              <CoverageTable title="By location" rows={m.coverage.location} label={locName} />
            </div>
            <details style={{ marginTop: 8 }}>
              <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>By prompt ({m.coverage.prompt.length})</summary>
              <CoverageTable title="By prompt" rows={m.coverage.prompt} label={(k) => {
                const [pid, ver] = k.split("@v");
                return data.prompts.find((p) => p.id === pid)?.versions.find((v) => String(v.version) === ver)?.text ?? k;
              }} />
            </details>
          </section>
        </>
      )}

      <section className="panel">
        <details>
          <summary style={{ cursor: "pointer" }}>Metric definitions and limitations</summary>
          <dl className="aiv-kv" style={{ marginTop: 8 }}>
            {METRIC_DEFINITIONS.map((d) => (
              <div key={d.key} style={{ display: "contents" }}>
                <dt>{d.name}</dt>
                <dd>
                  <code>{d.formula}</code>
                  <div className="aiv-ev">{d.notes}</div>
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </section>
    </AivShell>
  );
}
