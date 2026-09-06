import { getIntegrationCredentials } from "@/src/lib/server/integrations-service";
import { refreshAccessToken } from "@/src/lib/server/google-oauth";

/**
 * Live Google Search Console pull. Uses the stored OAuth refresh token, finds
 * the GSC property matching the client's website, and fetches 28-day totals +
 * top queries. Best-effort; clear errors instead of breaking. Never fabricates.
 */
export interface GscResult {
  ok: boolean;
  error?: string;
  site?: string;
  totals?: { clicks: number; impressions: number; ctr: number; position: number };
  topQueries?: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
}

function domainOf(s: string): string {
  return s
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function fetchGscForClient(tenantId: string, website?: string): Promise<GscResult> {
  if (!website?.trim()) return { ok: false, error: "This client has no website set." };

  const creds = await getIntegrationCredentials(tenantId, "google-search-console");
  if (!creds?.refreshToken) {
    return { ok: false, error: "Search Console isn't connected. Connect it under Integrations." };
  }

  let token: string;
  try {
    token = await refreshAccessToken(creds.refreshToken);
  } catch (e) {
    return { ok: false, error: `Couldn't refresh the Google token: ${e instanceof Error ? e.message : "error"}.` };
  }

  // Find the matching property.
  const sitesRes = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const sitesBody = (await sitesRes.json().catch(() => ({}))) as {
    siteEntry?: Array<{ siteUrl: string; permissionLevel?: string }>;
    error?: { message?: string };
  };
  if (!sitesRes.ok) {
    return { ok: false, error: sitesBody.error?.message || `Search Console returned ${sitesRes.status}.` };
  }
  const target = domainOf(website);
  const site = (sitesBody.siteEntry ?? []).find((s) => {
    const d = domainOf(s.siteUrl);
    return d === target || d.endsWith(`.${target}`) || target.endsWith(`.${d}`);
  })?.siteUrl;
  if (!site) return { ok: false, error: `No Search Console property matched "${target}".` };

  const end = new Date();
  const start = new Date(end.getTime() - 28 * 24 * 60 * 60 * 1000);
  const base = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;

  async function query(body: Record<string, unknown>) {
    const r = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return (await r.json().catch(() => ({}))) as {
      rows?: Array<{ keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }>;
    };
  }

  const totalsBody = await query({ startDate: ymd(start), endDate: ymd(end) });
  const totalsRow = totalsBody.rows?.[0];
  const queriesBody = await query({
    startDate: ymd(start),
    endDate: ymd(end),
    dimensions: ["query"],
    rowLimit: 10,
  });

  return {
    ok: true,
    site,
    totals: totalsRow
      ? {
          clicks: totalsRow.clicks,
          impressions: totalsRow.impressions,
          ctr: Math.round(totalsRow.ctr * 1000) / 10,
          position: Math.round(totalsRow.position * 10) / 10,
        }
      : { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    topQueries: (queriesBody.rows ?? []).map((r) => ({
      query: r.keys?.[0] ?? "—",
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: Math.round(r.ctr * 1000) / 10,
      position: Math.round(r.position * 10) / 10,
    })),
  };
}
