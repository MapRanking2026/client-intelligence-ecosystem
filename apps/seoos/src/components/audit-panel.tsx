"use client";

import { useEffect, useState } from "react";

interface OnPage {
  ok: boolean;
  error?: string;
  finalUrl?: string;
  checks: Array<{ label: string; status: "pass" | "warn" | "fail"; detail?: string }>;
}
interface Gsc {
  ok: boolean;
  error?: string;
  site?: string;
  totals?: { clicks: number; impressions: number; ctr: number; position: number };
  topQueries?: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
}
interface AuditData {
  onpage: OnPage;
  gsc: Gsc | null;
  gscConnected: boolean;
}

const DOT: Record<string, string> = { pass: "#3fb950", warn: "#d29922", fail: "#f85149" };

export function AuditPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    setData(null);
    fetch(`/api/seo/audit/${projectId}`)
      .then((r) => r.json())
      .then((b) => {
        if (!alive) return;
        if (b.error) setErr(b.error);
        else setData(b.data as AuditData);
      })
      .catch(() => alive && setErr("Failed to run audit"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [projectId]);

  if (loading) return <p className="muted" style={{ fontSize: 13 }}>Running on-page audit…</p>;
  if (err) return <p className="muted" style={{ fontSize: 13 }}>{err}</p>;
  if (!data) return null;

  const { onpage, gsc, gscConnected } = data;
  return (
    <>
      <div className="panel">
        <div className="panel-head"><h3 className="panel-title">On-page audit</h3></div>
        {!onpage.ok ? (
          <p className="muted" style={{ fontSize: 13 }}>{onpage.error}</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>{onpage.finalUrl}</p>
            <div className="table-scroll">
              <table className="data">
                <thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead>
                <tbody>
                  {onpage.checks.map((c) => (
                    <tr key={c.label}>
                      <td>{c.label}</td>
                      <td>
                        <span style={{ color: DOT[c.status], fontWeight: 600 }}>
                          {c.status === "pass" ? "● Pass" : c.status === "warn" ? "● Warn" : "● Fail"}
                        </span>
                      </td>
                      <td className="muted">{c.detail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <div className="panel-head"><h3 className="panel-title">Search Console (28 days)</h3></div>
        {!gscConnected ? (
          <p className="muted" style={{ fontSize: 13 }}>Connect Google Search Console under Integrations for live query data.</p>
        ) : !gsc ? (
          <p className="muted" style={{ fontSize: 13 }}>No Search Console data.</p>
        ) : !gsc.ok ? (
          <p className="muted" style={{ fontSize: 13 }}>{gsc.error}</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>Property: {gsc.site}</p>
            {gsc.totals ? (
              <div className="grid-cards" style={{ marginBottom: 10 }}>
                <div className="stat-card"><div className="stat-value">{gsc.totals.clicks.toLocaleString()}</div><div className="stat-label">Clicks</div></div>
                <div className="stat-card"><div className="stat-value">{gsc.totals.impressions.toLocaleString()}</div><div className="stat-label">Impressions</div></div>
                <div className="stat-card"><div className="stat-value">{gsc.totals.ctr}%</div><div className="stat-label">CTR</div></div>
                <div className="stat-card"><div className="stat-value">{gsc.totals.position}</div><div className="stat-label">Avg position</div></div>
              </div>
            ) : null}
            {gsc.topQueries?.length ? (
              <div className="table-scroll">
                <table className="data">
                  <thead><tr><th>Query</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th></tr></thead>
                  <tbody>
                    {gsc.topQueries.map((q) => (
                      <tr key={q.query}>
                        <td>{q.query}</td>
                        <td>{q.clicks}</td>
                        <td>{q.impressions}</td>
                        <td className="muted">{q.ctr}%</td>
                        <td className="muted">{q.position}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
