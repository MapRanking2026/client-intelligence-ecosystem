import Link from "next/link";

import { AivShell, Denied, Disclaimer, pageContext } from "@/src/components/ai-visibility/aiv-shell";
import { EvidenceView, statusPill } from "@/src/components/ai-visibility/evidence-view";
import { FilterBar } from "@/src/components/ai-visibility/filter-bar";
import { EmptyState } from "@/src/components/states";
import { clientFinding } from "@/src/lib/ai-visibility/effective";
import { filterObservations, filterToQuery, parseViewFilter } from "@/src/lib/ai-visibility/filters";
import { usd } from "@/src/lib/ai-visibility/util";
import { loadProjectData } from "@/src/lib/server/ai-visibility/data-service";
import { getEvidence } from "@/src/lib/server/ai-visibility/evidence-service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const FLAG_LABEL: Record<string, string> = {
  mentioned: "valid answers mentioning the client",
  not_mentioned: "valid answers not mentioning the client",
  recommended: "valid answers recommending the client",
  owned_cited: "valid answers citing an owned domain",
  top3: "ordered-list answers with the client in positions 1–3",
  ordered: "valid answers with an explicitly ordered list",
  valid: "valid answers",
  excluded: "excluded observations",
  not_collected: "observations not collected (errors, timeouts, rate limits)",
  refusal: "refusals",
  no_answer: "empty answers",
  not_analyzed: "collected but not analyzed",
};

export default async function AivResultsPage({ params, searchParams }: Props) {
  const { projectId } = await params;
  const ctx = await pageContext(projectId);
  if ("denied" in ctx) return <Denied />;
  const { authz, project } = ctx;
  const sp = await searchParams;
  const data = await loadProjectData(authz.tenantId, project.id);
  const base = `/ai-visibility/${project.id}`;
  if (!data.profile) {
    return (
      <AivShell authz={authz} project={project} tab="results">
        <EmptyState title="Not set up yet" message="Set up the client profile first." action={<Link href={`${base}/setup`}>Setup →</Link>} />
      </AivShell>
    );
  }
  const profile = data.profile;
  const f = parseViewFilter(sp);
  const rows = filterObservations(data.observations, f);
  const obsId = typeof sp.obs === "string" ? sp.obs : undefined;
  const evidence = obsId ? await getEvidence(authz.tenantId, project.id, obsId) : null;
  const q = filterToQuery(f);
  const closeHref = `${base}/results${q}`;
  const loc = (id?: string) => {
    const l = profile.locations.find((x) => x.id === id);
    return l ? `${l.city}${l.region ? `, ${l.region}` : ""}` : "—";
  };
  const flagLabel = f.flag ? FLAG_LABEL[f.flag] ?? f.flag : null;

  return (
    <AivShell authz={authz} project={project} tab="results" subtitle="Every observation with its prompt, provider, location and findings">
      <Disclaimer />
      <FilterBar action={`${base}/results`} filter={f} profile={profile} observations={data.observations} scans={data.scans} showFlag />
      <div className="toolbar aiv-noprint" style={{ marginBottom: 8 }}>
        <strong>{rows.length}</strong>
        <span className="muted">{flagLabel ? `${flagLabel}` : "observations"} match these filters.</span>
        {f.flag ? <Link href={`${base}/results${filterToQuery({ ...f, flag: undefined })}`}>Clear drill-down</Link> : null}
        <a className="aiv-btn" href={`/api/seo/ai-visibility/projects/${project.id}/export${q}`}>Export these rows (CSV)</a>
      </div>
      {!rows.length ? (
        <EmptyState title="No observations" message="Nothing matches these filters yet." action={<Link href={`${base}/scans`}>Scans →</Link>} />
      ) : (
        <div className="panel aiv-table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Collected</th>
                <th>Prompt</th>
                <th>Provider / surface</th>
                <th>Location</th>
                <th>Outcome</th>
                <th>Mentioned</th>
                <th>Recommended</th>
                <th>Owned cited</th>
                <th>Ordered position</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((o) => {
                const c = clientFinding(o);
                const analyzed = o.analysis?.status === "analyzed";
                return (
                  <tr key={o.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Link href={`${base}/results${q}${q ? "&" : "?"}obs=${o.id}`} scroll={false}>{o.collectedAt.slice(0, 16).replace("T", " ")}</Link>
                    </td>
                    <td style={{ fontSize: 13, maxWidth: 360 }}>{o.submittedText}</td>
                    <td style={{ fontSize: 13 }}>{o.providerId ? `${o.providerId} · ${o.model}` : o.surface}</td>
                    <td>{loc(o.locationId)}</td>
                    <td>{statusPill(o)}</td>
                    <td>{analyzed ? (c?.mentioned ? `Yes${c.sentiment !== "positive" && c.sentiment !== "neutral" ? ` (${c.sentiment})` : ""}` : "No") : "—"}</td>
                    <td>{analyzed ? (c?.recommended ? "Yes" : "No") : "—"}</td>
                    <td>{analyzed ? (c?.ownedDomainCited ? "Yes" : "No") : "—"}</td>
                    <td>{analyzed && c?.mentioned ? (c.position ?? "Mentioned; no ordered position") : "—"}</td>
                    <td className="num">{usd(o.costUsd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 500 ? <p className="aiv-ev">Showing the newest 500 rows. The CSV export contains all {rows.length}.</p> : null}
        </div>
      )}
      {evidence ? (
        <>
          <Link href={closeHref} className="aiv-drawer-backdrop" aria-label="Close evidence" scroll={false} />
          <aside className="aiv-drawer" role="dialog" aria-modal="true" aria-labelledby="ev-title">
            <div className="aiv-drawer-head">
              <h2 id="ev-title" className="panel-title">Evidence</h2>
              <div className="toolbar">
                <Link href={`${base}/observations/${evidence.obs.id}`}>Open full page</Link>
                <Link href={closeHref} className="aiv-btn" scroll={false}>Close</Link>
              </div>
            </div>
            <EvidenceView obs={evidence.obs} profile={profile} attempts={evidence.attempts} corrections={evidence.corrections} canManage={authz.permissions.includes("seo.project.manage")} />
          </aside>
        </>
      ) : obsId ? (
        <p className="aiv-msg aiv-msg--error">That observation was not found for this client.</p>
      ) : null}
    </AivShell>
  );
}
