import Link from "next/link";

import { AivShell, Denied, pageContext } from "@/src/components/ai-visibility/aiv-shell";
import { FilterBar } from "@/src/components/ai-visibility/filter-bar";
import { EmptyState } from "@/src/components/states";
import { filterToQuery, parseViewFilter } from "@/src/lib/ai-visibility/filters";
import { computeMetrics } from "@/src/lib/ai-visibility/metrics";
import { pct } from "@/src/lib/ai-visibility/util";
import { loadProjectData } from "@/src/lib/server/ai-visibility/data-service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AivCompetitorsPage({ params, searchParams }: Props) {
  const { projectId } = await params;
  const ctx = await pageContext(projectId);
  if ("denied" in ctx) return <Denied />;
  const { authz, project } = ctx;
  const data = await loadProjectData(authz.tenantId, project.id);
  const base = `/ai-visibility/${project.id}`;
  if (!data.profile) {
    return (
      <AivShell authz={authz} project={project} tab="competitors">
        <EmptyState title="Not set up yet" message="Set up the client profile first." action={<Link href={`${base}/setup`}>Setup →</Link>} />
      </AivShell>
    );
  }
  const f = parseViewFilter(await searchParams);
  const { flag: _f, ...mf } = f;
  void _f;
  const m = computeMetrics(data.observations, mf);
  const total = m.shareOfMentions.reduce((s, r) => s + r.answers, 0);
  const maxAnswers = Math.max(1, ...m.shareOfMentions.map((r) => r.answers));
  return (
    <AivShell authz={authz} project={project} tab="competitors" subtitle="Which businesses AI answers mention instead of — or alongside — the client">
      <FilterBar action={`${base}/competitors`} filter={f} profile={data.profile} observations={data.observations} scans={data.scans} />
      {!m.sample.valid ? (
        <EmptyState title="No valid answers" message="Run a scan to see which businesses appear." action={<Link href={`${base}/scans`}>Scans →</Link>} />
      ) : (
        <section className="panel aiv-table-wrap">
          <h2 className="panel-title">Competitor share of mentions</h2>
          <p className="aiv-ev">
            Answers mentioning each business (counted at most once per answer) ÷ {total} total business-answer mentions across {m.sample.valid} valid answers. This is <strong>not market share</strong>.
          </p>
          <table className="data">
            <thead>
              <tr>
                <th>Business</th>
                <th>Type</th>
                <th className="num">Answers mentioning</th>
                <th className="num">Of valid answers</th>
                <th className="num">Answers recommending</th>
                <th className="num">Share of mentions</th>
                <th style={{ width: 160 }} aria-hidden />
              </tr>
            </thead>
            <tbody>
              {m.shareOfMentions.map((r) => (
                <tr key={r.entityKey} style={r.kind === "client" ? { fontWeight: 600 } : undefined}>
                  <td><Link href={`${base}/results${filterToQuery({ ...f, flag: `entity:${r.entityKey}` })}`}>{r.name}</Link></td>
                  <td>{r.kind === "client" ? "This client" : r.kind === "competitor" ? "Known competitor" : "Discovered in answers (unverified)"}</td>
                  <td className="num">{r.answers}</td>
                  <td className="num">{pct(r.answers / m.sample.valid)}</td>
                  <td className="num">{r.recommendedAnswers}</td>
                  <td className="num">{pct(r.share, 1)}</td>
                  <td><div className={`aiv-bar ${r.kind === "client" ? "" : "aiv-bar--s2"}`} style={{ width: `${(r.answers / maxAnswers) * 100}%` }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {m.shareOfMentions.some((r) => r.kind === "discovered") && authz.permissions.includes("seo.project.manage") ? (
            <p className="aiv-ev">Discovered names come from list items in answers and may include non-businesses. Add real competitors (with their domains) in <Link href={`${base}/setup`}>Setup</Link>, then re-run analysis.</p>
          ) : null}
        </section>
      )}
    </AivShell>
  );
}
