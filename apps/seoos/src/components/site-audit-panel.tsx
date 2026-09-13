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
  notes: string[];
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

          <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
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
