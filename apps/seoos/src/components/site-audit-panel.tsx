"use client";

import { useState } from "react";

type Severity = "high" | "medium" | "low";

interface SiteIssue {
  severity: Severity;
  code: string;
  label: string;
  count: number;
  detail: string;
  examples: string[];
}
interface SiteAudit {
  ok: boolean;
  error?: string;
  origin?: string;
  pagesCrawled: number;
  discoveredNotCrawled: number;
  reachedCap: boolean;
  cap: number;
  durationMs: number;
  thresholds: { titleRange: [number, number]; metaRange: [number, number]; h1Count: number; maxDepthClicks: number; thinWords: number };
  summary: { indexablePages: number; noindexPages: number; brokenPages: number; avgWordCount: number; maxDepthSeen: number };
  issues: SiteIssue[];
  nap: NapConsistency;
  indexation: IndexationAudit;
  notes: string[];
}
interface IndexationAudit {
  sitemapFound: boolean;
  sitemapUrlCount: number;
  sitemapSources: string[];
  sitemapTruncated: boolean;
  reachablePages: number;
  notReached: string[];
  notReachedCount: number;
  notInSitemap: string[];
  notInSitemapCount: number;
  hubs: Array<{ url: string; outboundLinks: number }>;
  reliableOrphanCheck: boolean;
  notes: string[];
}
interface StructuredNap { name?: string; telephone?: string; street?: string; locality?: string; region?: string; postalCode?: string }
interface NapConsistency {
  canonicalName: string;
  targetPct: number;
  phones: Array<{ phone: string; display: string; pages: number }>;
  primaryPhone?: string;
  phoneConsistent: boolean;
  pagesWithPhone: number;
  pagesScanned: number;
  structuredNapPresent: boolean;
  structuredNap?: StructuredNap;
  nameMatchesStructured?: boolean;
  issues: string[];
  directoryChecklist: Array<{ name: string; note: string }>;
}

function formatAddress(n?: StructuredNap): string {
  if (!n) return "—";
  const parts = [n.street, n.locality, [n.region, n.postalCode].filter(Boolean).join(" ")].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

const SEV_COLOR: Record<Severity, string> = { high: "#f85149", medium: "#d29922", low: "#8b949e" };
const SEV_LABEL: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };

export function SiteAuditPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<SiteAudit | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setErr(null);
    setData(null);
    try {
      const r = await fetch(`/api/seo/site-audit/${projectId}`);
      const b = await r.json();
      if (b.error) setErr(b.error);
      else setData(b.data as SiteAudit);
    } catch {
      setErr("Crawl failed to run.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 className="panel-title">Site crawl &amp; pattern audit</h3>
        <button type="button" onClick={run} disabled={loading}>
          {loading ? "Crawling…" : data ? "Re-crawl" : "Run crawl"}
        </button>
      </div>

      {!data && !loading && !err ? (
        <p className="muted" style={{ fontSize: 13 }}>
          Crawls the pages reachable from the homepage and finds site-wide patterns a single-page audit can&apos;t —
          duplicate titles/metas, thin pages, broken links, and pages buried too deep. Read-only; can take up to a minute.
        </p>
      ) : null}
      {loading ? <p className="muted" style={{ fontSize: 13 }}>Crawling the site (up to a minute)…</p> : null}
      {err ? <p className="muted" style={{ fontSize: 13 }}>{err}</p> : null}

      {data && !data.ok ? <p className="muted" style={{ fontSize: 13 }}>{data.error}</p> : null}

      {data && data.ok ? (
        <>
          <div className="grid-cards" style={{ marginBottom: 10 }}>
            <div className="stat-card"><div className="stat-value">{data.pagesCrawled}</div><div className="stat-label">Pages crawled</div></div>
            <div className="stat-card"><div className="stat-value">{data.summary.indexablePages}</div><div className="stat-label">Indexable</div></div>
            <div className="stat-card"><div className="stat-value" style={{ color: data.summary.brokenPages ? SEV_COLOR.high : undefined }}>{data.summary.brokenPages}</div><div className="stat-label">Broken</div></div>
            <div className="stat-card"><div className="stat-value">{data.issues.length}</div><div className="stat-label">Issue types</div></div>
          </div>

          {data.issues.length ? (
            <div className="table-scroll">
              <table className="data">
                <thead><tr><th>Severity</th><th>Issue</th><th>Pages</th><th>Detail</th></tr></thead>
                <tbody>
                  {data.issues.map((iss) => (
                    <tr key={iss.code}>
                      <td>
                        <span className="badge" style={{ borderColor: SEV_COLOR[iss.severity], color: SEV_COLOR[iss.severity], fontSize: 10 }}>
                          {SEV_LABEL[iss.severity]}
                        </span>
                      </td>
                      <td>{iss.label}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{iss.count}</td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {iss.detail}
                        {iss.examples.length ? (
                          <details style={{ marginTop: 4 }}>
                            <summary style={{ cursor: "pointer" }}>examples</summary>
                            <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                              {iss.examples.map((e, i) => (<li key={i} style={{ wordBreak: "break-all" }}>{e}</li>))}
                            </ul>
                          </details>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>No site-wide issues found across the crawled pages. 🎉</p>
          )}

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>
              NAP consistency (M5){" "}
              <span
                className="badge"
                style={data.nap.phoneConsistent && data.nap.structuredNapPresent ? { borderColor: SEV_COLOR.low, color: "#3fb950", fontSize: 10 } : { borderColor: SEV_COLOR.medium, color: SEV_COLOR.medium, fontSize: 10 }}
              >
                target {data.nap.targetPct}%
              </span>
            </h4>
            <div className="table-scroll">
              <table className="data">
                <tbody>
                  <tr><td style={{ width: 140 }} className="muted">Name (tracked)</td><td>{data.nap.canonicalName}</td></tr>
                  <tr>
                    <td className="muted">Phone(s) on site</td>
                    <td>
                      {data.nap.phones.length === 0 ? (
                        <span style={{ color: SEV_COLOR.medium }}>none found</span>
                      ) : (
                        data.nap.phones.map((p) => (
                          <span key={p.phone} style={{ marginRight: 10 }}>
                            {p.display} <span className="muted" style={{ fontSize: 11 }}>({p.pages} pg)</span>
                          </span>
                        ))
                      )}
                      {data.nap.phones.length > 1 ? <span style={{ color: SEV_COLOR.high, fontWeight: 600 }}> ⚠ inconsistent</span> : null}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">Structured NAP</td>
                    <td>
                      {data.nap.structuredNapPresent ? (
                        <>JSON-LD: {data.nap.structuredNap?.name ?? "—"} · {formatAddress(data.nap.structuredNap)}</>
                      ) : (
                        <span style={{ color: SEV_COLOR.medium }}>no LocalBusiness JSON-LD</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {data.nap.issues.length ? (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
                {data.nap.issues.map((iss, i) => (<li key={i} style={{ marginBottom: 3 }}>{iss}</li>))}
              </ul>
            ) : (
              <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>Site NAP looks internally consistent.</p>
            )}
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 12 }}>Citation alignment checklist ({data.nap.directoryChecklist.length}) — submission deferred until unlock</summary>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
                {data.nap.directoryChecklist.map((d) => (
                  <li key={d.name} style={{ marginBottom: 2 }}><strong>{d.name}</strong> <span className="muted">— {d.note}</span></li>
                ))}
              </ul>
            </details>
          </div>

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>
              Indexation &amp; sitemap coverage{" "}
              <span
                className="badge"
                style={data.indexation.sitemapFound ? { borderColor: SEV_COLOR.low, color: "#3fb950", fontSize: 10 } : { borderColor: SEV_COLOR.medium, color: SEV_COLOR.medium, fontSize: 10 }}
              >
                {data.indexation.sitemapFound ? `sitemap: ${data.indexation.sitemapUrlCount} URLs` : "no sitemap"}
              </span>
            </h4>
            <div className="grid-cards" style={{ marginBottom: 8 }}>
              <div className="stat-card"><div className="stat-value">{data.indexation.reachablePages}</div><div className="stat-label">Reached by crawl</div></div>
              <div className="stat-card"><div className="stat-value" style={{ color: data.indexation.notReachedCount ? SEV_COLOR.medium : undefined }}>{data.indexation.notReachedCount}</div><div className="stat-label">Declared, not reached</div></div>
              <div className="stat-card"><div className="stat-value" style={{ color: data.indexation.notInSitemapCount ? SEV_COLOR.medium : undefined }}>{data.indexation.notInSitemapCount}</div><div className="stat-label">Reached, not in sitemap</div></div>
            </div>
            {data.indexation.notReachedCount ? (
              <details style={{ marginBottom: 4 }}>
                <summary style={{ cursor: "pointer", fontSize: 12 }}>
                  Declared but not reached{data.indexation.reliableOrphanCheck ? " (likely orphans)" : " (may be beyond crawl budget)"} — showing {data.indexation.notReached.length} of {data.indexation.notReachedCount}
                </summary>
                <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12 }}>
                  {data.indexation.notReached.map((u, i) => (<li key={i} style={{ wordBreak: "break-all" }}>{u}</li>))}
                </ul>
              </details>
            ) : null}
            {data.indexation.notInSitemapCount ? (
              <details style={{ marginBottom: 4 }}>
                <summary style={{ cursor: "pointer", fontSize: 12 }}>Reached but missing from sitemap — showing {data.indexation.notInSitemap.length} of {data.indexation.notInSitemapCount}</summary>
                <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12 }}>
                  {data.indexation.notInSitemap.map((u, i) => (<li key={i} style={{ wordBreak: "break-all" }}>{u}</li>))}
                </ul>
              </details>
            ) : null}
            {data.indexation.hubs.length ? (
              <details style={{ marginBottom: 4 }}>
                <summary style={{ cursor: "pointer", fontSize: 12 }}>Top internal-link hubs</summary>
                <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12 }}>
                  {data.indexation.hubs.map((h, i) => (<li key={i} style={{ wordBreak: "break-all" }}>{h.url} <span className="muted">— {h.outboundLinks} internal links</span></li>))}
                </ul>
              </details>
            ) : null}
            {data.indexation.notes.length ? (
              <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>{data.indexation.notes.join(" ")}</p>
            ) : null}
          </div>

          <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
            Thresholds from the Rule Library — title {data.thresholds.titleRange[0]}–{data.thresholds.titleRange[1]},
            meta {data.thresholds.metaRange[0]}–{data.thresholds.metaRange[1]}, H1 {data.thresholds.h1Count},
            max depth {data.thresholds.maxDepthClicks} clicks. Avg {data.summary.avgWordCount} words/page ·
            deepest {data.summary.maxDepthSeen} clicks · {(data.durationMs / 1000).toFixed(1)}s.
            {data.notes.length ? " " + data.notes.join(" ") : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}
