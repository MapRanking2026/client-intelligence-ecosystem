import Link from "next/link";

import { AivShell, Denied, Disclaimer, pageContext } from "@/src/components/ai-visibility/aiv-shell";
import { SafeLink } from "@/src/components/ai-visibility/evidence-view";
import { EmptyState } from "@/src/components/states";
import { buildRecommendations } from "@/src/lib/ai-visibility/recommendations";
import { loadProjectData } from "@/src/lib/server/ai-visibility/data-service";

export const dynamic = "force-dynamic";

export default async function AivRecommendationsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await pageContext(projectId);
  if ("denied" in ctx) return <Denied />;
  const { authz, project } = ctx;
  const data = await loadProjectData(authz.tenantId, project.id);
  const base = `/ai-visibility/${project.id}`;
  if (!data.profile) {
    return (
      <AivShell authz={authz} project={project} tab="recommendations">
        <EmptyState title="Not set up yet" message="Set up the client profile first." action={<Link href={`${base}/setup`}>Setup →</Link>} />
      </AivShell>
    );
  }
  const recs = buildRecommendations(data.observations, data.profile);
  return (
    <AivShell authz={authz} project={project} tab="recommendations" subtitle="Prioritized actions derived from official-API observations">
      <Disclaimer />
      <p className="aiv-ev">
        Each item separates the <strong>observed gap</strong> (from stored answers) from the <strong>proposed action</strong> (a hypothesis). No action guarantees AI inclusion. Website audit findings are kept separately in <Link href="/audits">Website Audits</Link>.
      </p>
      {!recs.length ? (
        <EmptyState title="No evidence-based recommendations yet" message="Recommendations appear when scans show a repeatable gap (e.g. 3+ valid answers for a service and location)." />
      ) : (
        recs.map((r) => (
          <section key={r.id} className="panel">
            <div className="panel-head">
              <h2 className="panel-title">{r.title}</h2>
              <div className="toolbar">
                <span className={`aiv-pill ${r.priority === "high" ? "aiv-pill--bad" : r.priority === "medium" ? "aiv-pill--warn" : ""}`}>{r.priority} priority</span>
                <span className="aiv-pill">confidence: {r.confidence}</span>
              </div>
            </div>
            <dl className="aiv-kv">
              <dt>Observed (fact)</dt>
              <dd>{r.observedGap}</dd>
              <dt>Evidence</dt>
              <dd>
                {r.evidenceObsIds.length} observation(s):{" "}
                {r.evidenceObsIds.slice(0, 8).map((id, i) => (
                  <span key={id}>
                    <Link href={`${base}/observations/${id}`}>#{i + 1}</Link>{" "}
                  </span>
                ))}
                {r.evidenceObsIds.length > 8 ? <span className="muted">+{r.evidenceObsIds.length - 8} more</span> : null}
              </dd>
              {r.sourceLinks.length ? (
                <>
                  <dt>Sources</dt>
                  <dd>
                    {r.sourceLinks.map((u) => (
                      <div key={u} style={{ fontSize: 13 }}><SafeLink href={u}>{u}</SafeLink></div>
                    ))}
                  </dd>
                </>
              ) : null}
              <dt>{r.actionIsHypothesis ? "Proposed action (hypothesis)" : "Proposed action"}</dt>
              <dd>{r.proposedAction}</dd>
              <dt>Why this priority</dt>
              <dd>{r.priorityReason}</dd>
              <dt>Limitations</dt>
              <dd>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
                  {r.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </dd>
            </dl>
          </section>
        ))
      )}
    </AivShell>
  );
}
