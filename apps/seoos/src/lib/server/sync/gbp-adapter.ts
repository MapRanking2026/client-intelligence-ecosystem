import { getIntegrationCredentials } from "@/src/lib/server/integrations-service";
import { refreshAccessToken } from "@/src/lib/server/google-oauth";

/**
 * Live Google Business Profile pull. Uses the stored OAuth refresh token to get
 * an access token, finds the location matching the client, and fetches its
 * reviews summary + performance. Every call is best-effort: a section that
 * Google blocks (e.g. API not yet approved → 403) returns an error string
 * instead of breaking the page. Never fabricates figures.
 */
export interface GbpResult {
  ok: boolean;
  error?: string;
  location?: { name: string; title: string };
  reviews?: { averageRating: number | null; totalReviewCount: number; recent: Array<{ rating: string; comment?: string }> };
  reviewsError?: string;
  performance?: Record<string, number>;
  performanceError?: string;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

async function gapi(url: string, token: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

function gapiError(status: number, body: unknown): string {
  const msg = (body as { error?: { message?: string } })?.error?.message;
  if (status === 403) return `Access denied (403)${msg ? `: ${msg}` : " — the Business Profile API may not be approved for this Google project yet."}`;
  return msg || `Google returned ${status}.`;
}

export async function fetchGbpForClient(tenantId: string, businessName: string): Promise<GbpResult> {
  const creds = await getIntegrationCredentials(tenantId, "google-business-profile");
  if (!creds?.refreshToken) {
    return { ok: false, error: "Google Business Profile isn't connected (no refresh token). Reconnect it under Integrations." };
  }

  let token: string;
  try {
    token = await refreshAccessToken(creds.refreshToken);
  } catch (e) {
    return { ok: false, error: `Couldn't refresh the Google token: ${e instanceof Error ? e.message : "error"}.` };
  }

  // 1) Accounts.
  const accountsRes = await gapi("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", token);
  if (!accountsRes.ok) return { ok: false, error: gapiError(accountsRes.status, accountsRes.body) };
  const accounts = ((accountsRes.body as { accounts?: Array<{ name: string }> }).accounts) ?? [];
  if (!accounts.length) return { ok: false, error: "No Google Business Profile accounts on this Google login." };

  // 2) Find the location matching this client's business name.
  const target = norm(businessName);
  let match: { name: string; title: string } | undefined;
  for (const acct of accounts) {
    const locRes = await gapi(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${acct.name}/locations?pageSize=100&readMask=name,title`,
      token,
    );
    if (!locRes.ok) continue;
    const locations = ((locRes.body as { locations?: Array<{ name: string; title?: string }> }).locations) ?? [];
    match = locations
      .map((l) => ({ name: `${acct.name}/${l.name.split("/").pop()}`, title: l.title ?? "" }))
      .find((l) => {
        const t = norm(l.title);
        return t && (t === target || t.includes(target) || target.includes(t));
      });
    if (match) break;
  }
  if (!match) {
    return { ok: false, error: `No GBP location matched "${businessName}". Names may differ between GBP and ClickUp.` };
  }

  const result: GbpResult = { ok: true, location: match };
  const locationId = match.name.split("/").pop();

  // 3) Reviews summary (v4).
  const revRes = await gapi(`https://mybusiness.googleapis.com/v4/${match.name}/reviews`, token);
  if (revRes.ok) {
    const rb = revRes.body as {
      averageRating?: number;
      totalReviewCount?: number;
      reviews?: Array<{ starRating?: string; comment?: string }>;
    };
    result.reviews = {
      averageRating: rb.averageRating ?? null,
      totalReviewCount: rb.totalReviewCount ?? 0,
      recent: (rb.reviews ?? []).slice(0, 5).map((r) => ({ rating: r.starRating ?? "—", comment: r.comment })),
    };
  } else {
    result.reviewsError = gapiError(revRes.status, revRes.body);
  }

  // 4) Performance — last 30 days totals for a few key metrics.
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    const metrics = [
      "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
      "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
      "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
      "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
      "CALL_CLICKS",
      "WEBSITE_CLICKS",
      "BUSINESS_DIRECTION_REQUESTS",
    ];
    const q = new URLSearchParams();
    for (const m of metrics) q.append("dailyMetrics", m);
    q.set("dailyRange.start_date.year", String(start.getUTCFullYear()));
    q.set("dailyRange.start_date.month", String(start.getUTCMonth() + 1));
    q.set("dailyRange.start_date.day", String(start.getUTCDate()));
    q.set("dailyRange.end_date.year", String(end.getUTCFullYear()));
    q.set("dailyRange.end_date.month", String(end.getUTCMonth() + 1));
    q.set("dailyRange.end_date.day", String(end.getUTCDate()));
    const perfRes = await gapi(
      `https://businessprofileperformance.googleapis.com/v1/locations/${locationId}:fetchMultiDailyMetricsTimeSeries?${q.toString()}`,
      token,
    );
    if (perfRes.ok) {
      const pb = perfRes.body as {
        multiDailyMetricTimeSeries?: Array<{
          dailyMetricTimeSeries?: Array<{
            dailyMetric?: string;
            timeSeries?: { datedValues?: Array<{ value?: string }> };
          }>;
        }>;
      };
      const totals: Record<string, number> = {};
      for (const outer of pb.multiDailyMetricTimeSeries ?? []) {
        for (const s of outer.dailyMetricTimeSeries ?? []) {
          const sum = (s.timeSeries?.datedValues ?? []).reduce((a, d) => a + Number(d.value ?? 0), 0);
          if (s.dailyMetric) totals[s.dailyMetric] = (totals[s.dailyMetric] ?? 0) + sum;
        }
      }
      result.performance = totals;
    } else {
      result.performanceError = gapiError(perfRes.status, perfRes.body);
    }
  } catch (e) {
    result.performanceError = e instanceof Error ? e.message : "performance_failed";
  }

  return result;
}
