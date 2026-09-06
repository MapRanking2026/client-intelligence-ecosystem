"use client";

import { useEffect, useState } from "react";

interface GbpData {
  ok: boolean;
  error?: string;
  location?: { title: string };
  reviews?: { averageRating: number | null; totalReviewCount: number; recent: Array<{ rating: string; comment?: string }> };
  reviewsError?: string;
  performance?: Record<string, number>;
  performanceError?: string;
}

const METRIC_LABELS: Record<string, string> = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "Maps views (desktop)",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "Maps views (mobile)",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "Search views (desktop)",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "Search views (mobile)",
  CALL_CLICKS: "Calls",
  WEBSITE_CLICKS: "Website clicks",
  BUSINESS_DIRECTION_REQUESTS: "Directions",
};

export function GbpLivePanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<GbpData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    setData(null);
    fetch(`/api/seo/gbp/${projectId}`)
      .then((r) => r.json())
      .then((b) => {
        if (!alive) return;
        if (b.error) setErr(b.error);
        else setData(b.data as GbpData);
      })
      .catch(() => alive && setErr("Failed to load GBP data"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [projectId]);

  if (loading) return <p className="muted" style={{ fontSize: 13 }}>Loading live Google Business Profile data…</p>;
  if (err) return <p className="muted" style={{ fontSize: 13 }}>{err}</p>;
  if (!data) return null;
  if (!data.ok) return <p className="muted" style={{ fontSize: 13 }}>{data.error}</p>;

  const perf = data.performance ?? {};
  return (
    <div>
      {data.location ? (
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>Matched GBP location: <strong>{data.location.title}</strong></p>
      ) : null}

      <h4 style={{ margin: "8px 0" }}>Reviews</h4>
      {data.reviews ? (
        <div className="grid-cards" style={{ marginBottom: 6 }}>
          <div className="stat-card">
            <div className="stat-value">{data.reviews.averageRating != null ? data.reviews.averageRating.toFixed(1) : "—"}</div>
            <div className="stat-label">Average rating</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{data.reviews.totalReviewCount}</div>
            <div className="stat-label">Total reviews</div>
          </div>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 12 }}>{data.reviewsError ?? "No review data."}</p>
      )}

      <h4 style={{ margin: "12px 0 8px" }}>Performance (last 30 days)</h4>
      {Object.keys(perf).length ? (
        <div className="grid-cards">
          {Object.entries(perf).map(([k, v]) => (
            <div className="stat-card" key={k}>
              <div className="stat-value">{v.toLocaleString()}</div>
              <div className="stat-label">{METRIC_LABELS[k] ?? k}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 12 }}>{data.performanceError ?? "No performance data."}</p>
      )}
    </div>
  );
}
