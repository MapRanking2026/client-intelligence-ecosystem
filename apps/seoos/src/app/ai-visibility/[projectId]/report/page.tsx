import Link from "next/link";

import { AivShell, Denied, pageContext } from "@/src/components/ai-visibility/aiv-shell";
import { PrintButton } from "@/src/components/ai-visibility/small-actions";
import { EmptyState } from "@/src/components/states";
import { parseViewFilter } from "@/src/lib/ai-visibility/filters";
import { computeMetrics, computeTrend, METRIC_DEFINITIONS, type MetricsResult, type Rate } from "@/src/lib/ai-visibility/metrics";
import { buildRecommendations } from "@/src/lib/ai-visibility/recommendations";
import { CHANNEL_LABEL } from "@/src/lib/ai-visibility/types";
import { pct } from "@/src/lib/ai-visibility/util";
import { loadProjectData } from "@/src/lib/server/ai-visibility/data-service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function r(rate: Rate) {
  return rate.value === null ? "— (no valid sample)" : `${pct(rate.value)} (${rate.num}/${rate.den}; 95% CI ${pct(rate.ci![0])}–${pct(rate.ci![1])})`;
}

function MetricsTable({ m }: { m: MetricsResult }) {
  return (
    <table className="data">
      <tbody>
        <tr><td>Valid answers / observations</td><td>{m.sample.valid} / {m.sample.total} (excluded: {m.sample.not_collected} not collected, {m.sample.refusal} refusals, {m.sample.no_answer} empty, {m.sample.not_analyzed} not analyzed)</td></tr>
        <tr><td>Mention rate</td><td>{r(m.mentionRate)}</td></tr>
        <tr><td>Recommendation rate</td><td>{r(m.recommendationRate)}</td></tr>
        <tr><td>Owned-domain citation rate</td><td>{r(m.ownedCitationRate)}</td></tr>
        <tr><td>Top-three inclusion (ordered lists only)</td><td>{r(m.top3)}</td></tr>
      </tbody>
    </table>
  );
}

export default async function AivReportPage({ params, searchParams }: Props) {
  const { projectId } = await params;
  const ctx = await pageContext(projectId);
  if ("denied" in ctx) return <Denied />;
  const { authz, project } = ctx;
  const data = await loadProjectData(authz.tenantId, project.id);
  if (!data.profile) {
    return (
      <AivShell authz={authz} project={project} tab="report">
        <EmptyState title="Not set up yet" message="Set up the client profile first." action={<Link href={`/ai-visibility/${project.id}/setup`}>Setup →</Link>} />
      </AivShell>
    );
  }
  const profile = data.profile;
  const f = parseViewFilter(await searchParams);
  const { flag: _f, ...mf } = f;
  void _f;
  const unbranded = computeMetrics(data.observations, { ...mf, branded: false });
  const branded = computeMetrics(data.observations, { ...mf, branded: true });
  const trend = computeTrend(data.observations, { ...mf, branded: false }, data.scans.filter((s) => s.plannedCount > 0));
  const recs = buildRecommendations(data.observations, profile).slice(0, 6);
  const providers = [...new Set(data.observations.filter((o) => o.channel === f.channel && o.model).map((o) => `${o.providerId} · ${o.model}`))];
  const dates = data.observations.filter((o) => o.channel === f.channel).map((o) => o.collectedAt).sort();
  const locs = profile.locations.filter((l) => l.status === "approved").map((l) => `${l.city}${l.region ? `, ${l.region}` : ""}`);

  return (
    <AivShell authz={authz} project={project} tab="report" subtitle="Printable client report" actions={<PrintButton />}>
      <article>
        <section className="panel">
          <h2 style={{ marginTop: 0 }}>AI Visibility Report — {project.businessName}</h2>
          <p className="muted" style={{ fontSize: 13 }}>
            Prepared {new Date().toISOString().slice(0, 10)} by Map Ranking · Channel: {CHANNEL_LABEL[f.channel]} · Providers/models: {providers.join(", ") || "—"} · Observations collected {dates[0]?.slice(0, 10) ?? "—"} to {dates[dates.length - 1]?.slice(0, 10) ?? "—"} · Locations: {locs.join("; ")}
          </p>
          <p style={{ fontSize: 13 }}>
            <strong>How to read this report.</strong> We asked AI systems local buying questions through their official APIs (with web search enabled) and recorded whether {project.businessName} appeared. Each answer is a sample: results change with time, model, search behavior, location support and personalization, and API results are not identical to what people see in consumer apps such as ChatGPT or Google AI Overviews. This report does not guarantee rankings or cover all AI answers.
          </p>
        </section>
        <section className="panel">
          <h3>Unbranded questions (people not searching for the business by name)</h3>
          {unbranded.sample.total ? <MetricsTable m={unbranded} /> : <p className="muted">No observations.</p>}
          {unbranded.smallSample && unbranded.sample.total ? <p className="aiv-ev">Small sample: treat as directional.</p> : null}
        </section>
        <section className="panel">
          <h3>Branded questions (measured separately)</h3>
          {branded.sample.total ? <MetricsTable m={branded} /> : <p className="muted">No branded observations in this period.</p>}
        </section>
        {trend.length ? (
          <section className="panel">
            <h3>Trend by scan (unbranded)</h3>
            <table className="data">
              <thead><tr><th>Scan</th><th className="num">Valid n</th><th className="num">Mention</th><th className="num">Recommendation</th><th>Comparable to previous</th></tr></thead>
              <tbody>
                {trend.map((t) => (
                  <tr key={t.scanId}><td>{t.at.slice(0, 10)}</td><td className="num">{t.valid}</td><td className="num">{pct(t.mentionRate)}</td><td className="num">{pct(t.recommendationRate)}</td><td>{t.comparableToPrevious === null ? "—" : t.comparableToPrevious ? "Yes" : `No — ${t.changeNote}`}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
        <section className="panel">
          <h3>Who else appears (share of mentions — not market share)</h3>
          <table className="data">
            <thead><tr><th>Business</th><th className="num">Answers mentioning</th><th className="num">Share of mentions</th></tr></thead>
            <tbody>
              {unbranded.shareOfMentions.slice(0, 10).map((s) => (
                <tr key={s.entityKey}><td>{s.name}{s.kind === "discovered" ? " (unverified name)" : ""}</td><td className="num">{s.answers}</td><td className="num">{pct(s.share, 1)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel">
          <h3>Priorities</h3>
          {recs.length ? (
            <ol>
              {recs.map((x) => (
                <li key={x.id} style={{ marginBottom: 8 }}>
                  <strong>{x.title}</strong> <span className="muted">({x.priority} priority, {x.confidence} confidence)</span>
                  <div style={{ fontSize: 13 }}>Observed: {x.observedGap}</div>
                  <div style={{ fontSize: 13 }}>{x.actionIsHypothesis ? "We suggest testing" : "Action"}: {x.proposedAction}</div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No evidence-based priorities yet.</p>
          )}
        </section>
        <section className="panel">
          <h3>Definitions</h3>
          <ul style={{ fontSize: 12.5 }}>
            {METRIC_DEFINITIONS.map((d) => (
              <li key={d.key}><strong>{d.name}:</strong> {d.formula}. {d.notes}</li>
            ))}
          </ul>
        </section>
      </article>
    </AivShell>
  );
}
