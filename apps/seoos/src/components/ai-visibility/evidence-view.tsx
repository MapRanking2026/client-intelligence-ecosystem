import type { ReactNode } from "react";

import { effectiveEntities, validity } from "@/src/lib/ai-visibility/effective";
import {
  CHANNEL_LABEL,
  COLLECTION_STATUS_LABEL,
  PROMPT_GROUP_LABEL,
  type AivAttemptV1,
  type AivAuditEventV1,
  type AivObservationV1,
  type AivProfileV1,
} from "@/src/lib/ai-visibility/types";
import { isSafeHttpUrl } from "@/src/lib/ai-visibility/url";
import { usd } from "@/src/lib/ai-visibility/util";
import { CorrectionForm } from "./correction-form";

/** Model answers and cited pages are untrusted: rendered as text only, links restricted to http(s). */
export function SafeLink({ href, children }: { href: string; children: ReactNode }) {
  if (!isSafeHttpUrl(href)) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
      {children}
    </a>
  );
}

function highlighted(text: string, spans: Array<{ start: number; end: number; cls: string; title: string }>) {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let pos = 0;
  sorted.forEach((s, i) => {
    if (s.start < pos || s.end > text.length) return;
    if (s.start > pos) out.push(text.slice(pos, s.start));
    out.push(
      <mark key={i} className={s.cls} title={s.title}>
        {text.slice(s.start, s.end)}
      </mark>,
    );
    pos = s.end;
  });
  out.push(text.slice(pos));
  return out;
}

export function statusPill(o: AivObservationV1) {
  const v = validity(o);
  const cls = v === "valid" ? "aiv-pill--ok" : v === "not_collected" ? "aiv-pill--bad" : "aiv-pill--warn";
  const label = v === "valid" ? "Valid answer" : v === "not_analyzed" ? "Collected, not analyzed" : COLLECTION_STATUS_LABEL[o.collectionStatus] ?? o.collectionStatus;
  return <span className={`aiv-pill ${cls}`}>{v === "valid" || v === "not_analyzed" ? label : `${label} — excluded`}</span>;
}

export function EvidenceView({
  obs,
  profile,
  attempts,
  corrections,
  canManage,
}: {
  obs: AivObservationV1;
  profile: AivProfileV1;
  attempts: AivAttemptV1[];
  corrections: AivAuditEventV1[];
  canManage: boolean;
}) {
  const ents = effectiveEntities(obs);
  const loc = profile.locations.find((l) => l.id === obs.locationId);
  const spans = ents
    .filter((e) => e.spans.length)
    .flatMap((e) => e.spans.map((s) => ({ start: s.start, end: s.end, cls: e.entityKey === "client" ? "" : "comp", title: `${e.name}${e.mentioned ? "" : " (not counted)"}` })));
  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        {statusPill(obs)}
        <span className="aiv-pill">{CHANNEL_LABEL[obs.channel]}</span>
        <span className="aiv-pill">{obs.surface}</span>
        {obs.model ? <span className="aiv-pill">model {obs.model}</span> : null}
        <span className="aiv-pill">{obs.branded ? "Branded" : "Unbranded"}</span>
      </div>

      <section className="panel">
        <h3 className="panel-title">Exact prompt</h3>
        <p style={{ fontSize: 15, margin: "6px 0 10px" }}>“{obs.submittedText}”</p>
        <dl className="aiv-kv">
          <dt>Group</dt>
          <dd>{PROMPT_GROUP_LABEL[obs.promptGroup]}{obs.promptId ? ` · prompt ${obs.promptId} v${obs.promptVersion}` : ""}</dd>
          <dt>Location</dt>
          <dd>
            {loc ? `${loc.city}${loc.region ? `, ${loc.region}` : ""}` : "—"} · mode <code>{obs.locationMode}</code>
            {obs.locationMode === "explicit_in_text" ? " (city written in the prompt — not a GPS-based observation)" : ""}
            {obs.locationMode === "near_me_ambiguous" ? " (location-ambiguous)" : ""}
          </dd>
          <dt>Provider location control</dt>
          <dd>{obs.appliedLocation ? `${obs.appliedLocation.control}: ${[obs.appliedLocation.city, obs.appliedLocation.region, obs.appliedLocation.country, obs.appliedLocation.timezone].filter(Boolean).join(", ")}` : "None applied"}</dd>
          <dt>Collected</dt>
          <dd>{obs.collectedAt.replace("T", " ").slice(0, 19)} UTC · language {obs.language}{obs.repetition ? ` · repetition ${obs.repetition}` : ""}</dd>
          <dt>Search / grounding</dt>
          <dd>
            {obs.searchExecuted === null ? "Not reported by provider" : obs.searchExecuted ? `Executed (${obs.searchQueries.length} quer${obs.searchQueries.length === 1 ? "y" : "ies"})` : "Enabled but not executed"}
            {obs.searchQueries.length ? ` — ${obs.searchQueries.map((q) => `“${q}”`).join(", ")}` : ""}
          </dd>
          <dt>Settings</dt>
          <dd><code>{JSON.stringify({ ...obs.searchConfig, ...obs.generationSettings })}</code></dd>
          {obs.apiVersion ? (
            <>
              <dt>API version</dt>
              <dd>{obs.apiVersion}</dd>
            </>
          ) : null}
          {obs.collectionError ? (
            <>
              <dt>Collection note</dt>
              <dd>{obs.collectionError}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="panel">
        <h3 className="panel-title">Answer</h3>
        {obs.answerText ? (
          <div className="aiv-answer">{highlighted(obs.answerText, spans)}</div>
        ) : (
          <p className="muted">No answer text was returned.</p>
        )}
        <p className="aiv-ev">Highlights: client (green), other businesses (blue). Detection is deterministic ({obs.analysis?.extractorVersion ?? "not analyzed"}); hover for names.</p>
        {obs.evidenceFileId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/seo/ai-visibility/projects/${obs.projectId}/evidence/${obs.evidenceFileId}`} alt="Uploaded screenshot of the AI answer" style={{ maxWidth: "100%", border: "1px solid var(--border)", borderRadius: 8, marginTop: 8 }} />
        ) : null}
        {obs.manualNote ? <p className="muted">Note: {obs.manualNote}</p> : null}
      </section>

      <section className="panel">
        <h3 className="panel-title">Extraction findings</h3>
        {obs.analysis?.status === "failed" ? <p className="aiv-msg aiv-msg--error">Analysis failed: {obs.analysis.error}</p> : null}
        <p className="muted" style={{ fontSize: 13 }}>
          Answer class: <strong>{obs.analysis?.answerClass ?? "—"}</strong> ·{" "}
          {obs.analysis?.orderedList ? `Explicitly ordered list of ${obs.analysis.orderedListLength}` : "No ordered list — positions not assigned"}
        </p>
        <div className="aiv-table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Business</th>
                <th>Mentioned</th>
                <th>Recommended</th>
                <th>Sentiment</th>
                <th className="num">Position</th>
                <th>Matched by</th>
                <th className="num">Confidence</th>
                <th>Supporting text / notes</th>
              </tr>
            </thead>
            <tbody>
              {ents.filter((e) => e.mentioned || e.spans.length || e.entityKey === "client").map((e) => (
                <tr key={e.entityKey}>
                  <td>
                    <strong>{e.name}</strong>
                    <div className="aiv-ev">{e.kind}</div>
                  </td>
                  <td>{e.mentioned ? "Yes" : "No"}</td>
                  <td>{e.recommended ? "Yes" : "No"}</td>
                  <td>{e.mentioned ? e.sentiment : "—"}</td>
                  <td className="num">{e.position ?? (e.mentioned ? "No ordered position" : "—")}</td>
                  <td>{e.matchedBy.join(", ") || "—"}</td>
                  <td className="num">{e.confidence.toFixed(2)}</td>
                  <td style={{ fontSize: 12.5 }}>
                    {e.spans.slice(0, 3).map((s, i) => (
                      <div key={i}>“{s.text}” <span className="aiv-ev">@{s.start}</span></div>
                    ))}
                    {e.ownedDomainCited ? <div>Owned domain cited</div> : null}
                    {e.thirdPartyCitationUrls.length ? <div>{e.thirdPartyCitationUrls.length} supporting third-party citation(s)</div> : null}
                    {e.locationConflict ? <div className="aiv-pill aiv-pill--warn">{e.locationConflict}</div> : null}
                    {e.notes.map((n, i) => (
                      <div key={`n${i}`} className="aiv-ev">{n}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canManage && obs.analysis ? <CorrectionForm projectId={obs.projectId} observationId={obs.id} entities={ents.map((e) => ({ key: e.entityKey, name: e.name, mentioned: e.mentioned, recommended: e.recommended, sentiment: e.sentiment, position: e.position }))} competitors={profile.competitors.map((c) => ({ key: c.id, name: c.name }))} /> : null}
        {corrections.length ? (
          <details style={{ marginTop: 8 }}>
            <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Correction history ({corrections.length})</summary>
            <ul>
              {corrections.map((c) => (
                <li key={c.id} style={{ fontSize: 12.5 }}>
                  {c.at.slice(0, 16).replace("T", " ")} · {c.actor}: <code>{JSON.stringify(c.detail)}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="panel">
        <h3 className="panel-title">Citations ({obs.citations.length})</h3>
        {obs.citations.length ? (
          <div className="aiv-table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Source</th>
                  <th>Cited text</th>
                  <th className="num">Answer spans</th>
                </tr>
              </thead>
              <tbody>
                {obs.citations.map((c) => (
                  <tr key={c.normalizedUrl}>
                    <td className="num">{c.order}</td>
                    <td>
                      <SafeLink href={c.url}>{c.title || c.url}</SafeLink>
                      <div className="aiv-ev">{c.domain}</div>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{c.citedText ?? "—"}</td>
                    <td className="num">{c.answerSpans.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="aiv-ev">Citation order is the order sources first appear; it is not a recommendation ranking.</p>
          </div>
        ) : (
          <p className="muted">No citations were returned.</p>
        )}
        {obs.searchResults.length ? (
          <details>
            <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Search results seen by the model ({obs.searchResults.length})</summary>
            <ul style={{ fontSize: 12.5 }}>
              {obs.searchResults.map((r, i) => (
                <li key={i}>
                  <SafeLink href={r.url}>{r.title || r.url}</SafeLink> {r.pageAge ? <span className="aiv-ev">({r.pageAge})</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="panel">
        <h3 className="panel-title">Usage, cost and attempts</h3>
        <dl className="aiv-kv">
          <dt>Tokens</dt>
          <dd>{obs.usage ? `${obs.usage.inputTokens.toLocaleString()} in · ${obs.usage.outputTokens.toLocaleString()} out · ${obs.usage.searchRequests} search request(s)` : "—"}</dd>
          <dt>Cost</dt>
          <dd>{usd(obs.costUsd)} · {obs.costBasis === "calculated_from_reported_usage" ? "calculated from provider-reported usage at listed rates (not an invoice)" : obs.costBasis}</dd>
          <dt>Latency</dt>
          <dd>{obs.latencyMs ? `${(obs.latencyMs / 1000).toFixed(1)} s` : "—"}</dd>
          <dt>Provider request id</dt>
          <dd><code>{obs.requestId ?? "—"}</code></dd>
          <dt>Stop reason</dt>
          <dd>{obs.stopReason ?? "—"}</dd>
        </dl>
        {attempts.length ? (
          <table className="data" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Started</th>
                <th>Outcome</th>
                <th className="num">Latency</th>
                <th className="num">Cost</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {attempts
                .sort((a, b) => a.attemptNumber - b.attemptNumber)
                .map((a) => (
                  <tr key={a.id}>
                    <td className="num">{a.attemptNumber}</td>
                    <td>{a.startedAt.slice(0, 19).replace("T", " ")}</td>
                    <td>{a.outcome}</td>
                    <td className="num">{a.latencyMs ? `${(a.latencyMs / 1000).toFixed(1)}s` : "—"}</td>
                    <td className="num">{usd(a.costUsd)} <span className="aiv-ev">{a.costBasis}</span></td>
                    <td style={{ fontSize: 12 }}>{a.errorMessage ?? a.requestId ?? ""}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {obs.rawResponse ? (
        <section className="panel">
          <details>
            <summary style={{ cursor: "pointer" }}>Raw provider response{obs.rawResponseTruncated ? " (truncated)" : ""}</summary>
            <pre className="aiv-raw">{obs.rawResponse}</pre>
            <p className="aiv-ev">Opaque encrypted search blobs are omitted. No credentials are ever stored.</p>
          </details>
        </section>
      ) : null}
    </div>
  );
}
