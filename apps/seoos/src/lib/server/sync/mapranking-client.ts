import type { SeoPerformanceSnapshotV1 } from "@cie/contracts";
import type { SeoProjectV1 } from "@/src/lib/domain/project";
import { nowIso } from "@/src/lib/ids";

/**
 * SEOOS-native MapRanking dashboard client — copied from the MTOS integration
 * so SEOOS connects directly (no gateway). One login (email/password, stored as
 * clientId/clientSecret) yields a bearer token that powers BOTH Rank Tracker
 * rankings and Map Check-Ins. A fresh token is fetched per sync (auto-refresh).
 */
const DEFAULT_API_BASE = "https://dashboardapi.mapranking.com";
const MAX_BUSINESSES = 4;
const MAX_KEYWORDS_PER_PROFILE = 14;
const MAX_GRIDS = 8;

type JsonRecord = Record<string, unknown>;
interface Session {
  baseUrl: string;
  token: string;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

function normalizeText(v: string) {
  return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function stripNoise(v: string) {
  return v.replace(/\([^)]*\)/g, " ").replace(/\b(llc|inc|corp|co|ltd|usa|dba)\b/gi, " ").trim();
}
function namesLikelyMatch(a: string, b: string) {
  const x = normalizeText(stripNoise(a));
  const y = normalizeText(stripNoise(b));
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 6 && long.includes(short);
}

async function postJson(url: string, body: JsonRecord, token?: string): Promise<JsonRecord> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as JsonRecord;
  if (!res.ok) {
    throw new Error(
      (typeof payload.message === "string" && payload.message) ||
        `MapRanking request failed (${res.status})`,
    );
  }
  return payload;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= items.length) return;
        results[i] = await worker(items[i]);
      }
    }),
  );
  return results;
}

async function login(email: string, password: string, baseUrl: string): Promise<Session | null> {
  const payload = await postJson(`${baseUrl}/api/auth/login`, { type: "email", email, password });
  const data = (payload.data || {}) as JsonRecord;
  const token = typeof data.token === "string" ? data.token : "";
  return token ? { baseUrl, token } : null;
}

interface Business {
  businessId: string;
  businessName: string;
}
async function fetchBusinesses(session: Session): Promise<Business[]> {
  const res = await fetch(`${session.baseUrl}/api/business/get-business`, {
    headers: { authorization: `Bearer ${session.token}`, accept: "application/json" },
  });
  const payload = (await res.json().catch(() => ({}))) as JsonRecord;
  const rows = Array.isArray(payload.data) ? (payload.data as JsonRecord[]) : [];
  return rows.map((r) => ({ businessId: String(r._id || ""), businessName: String(r.business_name || "") }));
}

interface Scan {
  reportId: string;
  scanDate: string;
  averageRank: number | null;
  marketSharePercent: number | null;
}
interface KeywordScans {
  keyword: string;
  scans: Scan[];
}

function scanFromHistory(entry: JsonRecord): Scan | null {
  const reportId = String(entry.report_id || "");
  const scanDate = String(entry.timestamp || "");
  if (!reportId || !scanDate || String(entry.status || "") !== "completed") return null;
  const score = (entry.score || {}) as JsonRecord;
  const ms = toNumber(score.marketShare);
  return {
    reportId,
    scanDate,
    averageRank: round1(toNumber(score.avg)),
    marketSharePercent: ms === null ? null : Math.round(ms * 1000) / 10,
  };
}

async function fetchKeywordScans(session: Session, business: Business): Promise<KeywordScans[]> {
  if (!business.businessId) return [];
  const payload = await postJson(
    `${session.baseUrl}/api/heatmap/keyword-history`,
    { business_id: business.businessId },
    session.token,
  );
  const rows = Array.isArray(payload.data) ? (payload.data as JsonRecord[]) : [];
  const configs = new Map<string, Array<{ heatmapId: string; createdAt: string }>>();
  for (const row of rows) {
    const keyword = String(row.keyword || "").trim();
    const heatmapId = String(row.heatmap_id || "");
    if (!keyword || !heatmapId) continue;
    const list = configs.get(keyword) || [];
    list.push({ heatmapId, createdAt: String(row.created_at || "") });
    configs.set(keyword, list);
  }
  const targets: Array<{ keyword: string; heatmapId: string }> = [];
  for (const [keyword, list] of Array.from(configs.entries()).slice(0, MAX_KEYWORDS_PER_PROFILE)) {
    for (const c of [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2)) {
      targets.push({ keyword, heatmapId: c.heatmapId });
    }
  }
  const histories = await mapWithConcurrency(targets, 6, async (t) => {
    try {
      const heatmap = await postJson(`${session.baseUrl}/api/heatmap/get-heatmap`, { heatmapId: t.heatmapId }, session.token);
      const history = Array.isArray((heatmap.data as JsonRecord | undefined)?.history)
        ? ((heatmap.data as JsonRecord).history as JsonRecord[])
        : [];
      return { keyword: t.keyword, history };
    } catch {
      return { keyword: t.keyword, history: [] as JsonRecord[] };
    }
  });
  const byKeyword = new Map<string, Scan[]>();
  for (const { keyword, history } of histories) {
    const list = byKeyword.get(keyword) || [];
    for (const e of history) {
      const s = scanFromHistory(e);
      if (s) list.push(s);
    }
    byKeyword.set(keyword, list);
  }
  const out: KeywordScans[] = [];
  for (const [keyword, scans] of byKeyword) {
    const seen = new Set<string>();
    const deduped = scans
      .filter((s) => (seen.has(s.reportId) ? false : (seen.add(s.reportId), true)))
      .sort((a, b) => b.scanDate.localeCompare(a.scanDate))
      .slice(0, 4);
    if (deduped.length) out.push({ keyword, scans: deduped });
  }
  return out;
}

type Grid = SeoPerformanceSnapshotV1["grids"][number];

async function fetchGrid(session: Session, keyword: string, scan: Scan): Promise<Grid | null> {
  try {
    const payload = await postJson(`${session.baseUrl}/api/heatmap/report`, { id: scan.reportId }, session.token);
    const report = (payload.data || {}) as JsonRecord;
    const scanData = ((report.data as JsonRecord | undefined)?.data || {}) as JsonRecord;
    const results = Array.isArray(scanData.results) ? (scanData.results as JsonRecord[]) : [];
    const points = toNumber(scanData.points) ?? results.length;
    const top3 = results.filter((p) => {
      const rank = p.found === false ? null : toNumber(p.rank);
      return rank !== null && rank <= 3;
    }).length;
    return {
      keyword,
      scanDate: scan.scanDate,
      gridSize: Math.round(Math.sqrt(points || results.length)) || 0,
      averageRankPosition: round1(toNumber(scanData.arp)),
      shareOfLocalVoicePercent: round1(toNumber(scanData.solv)),
      top3Percent: points ? Math.round((top3 / points) * 1000) / 10 : null,
    };
  } catch {
    return null;
  }
}

async function fetchCheckins(session: Session): Promise<Array<{ businessName: string; totalPosts: number }>> {
  const businesses: JsonRecord[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const payload = await postJson(
      `${session.baseUrl}/api/checkin-business/get-business-paginated`,
      { page, limit: 20 },
      session.token,
    );
    const rows = Array.isArray(payload.data) ? (payload.data as JsonRecord[]) : [];
    businesses.push(...rows);
    if (rows.length < 20) break;
  }
  return businesses.map((r) => ({
    businessName: String(r.business_name || ""),
    totalPosts: toNumber(r.totalPosts) ?? 0,
  }));
}

/** Log in and assemble a normalized per-client snapshot (rankings + grids + check-ins). */
export async function syncMapRanking(input: {
  credentials: Record<string, string>;
  project: SeoProjectV1;
}): Promise<{ ok: boolean; snapshot?: SeoPerformanceSnapshotV1; error?: string; summary?: string }> {
  const email = input.credentials.clientId;
  const password = input.credentials.clientSecret;
  const baseUrl = (input.credentials.apiBaseUrl || DEFAULT_API_BASE).replace(/\/$/, "");
  if (!email || !password) return { ok: false, error: "Missing client ID / client secret" };

  try {
    const session = await login(email, password, baseUrl);
    if (!session) return { ok: false, error: "MapRanking login failed" };

    const all = await fetchBusinesses(session);
    const manualId = input.project.externalIds?.rankTrackerBusinessId;
    const matched = all
      .filter((b) => namesLikelyMatch(input.project.businessName, b.businessName) || b.businessId === manualId)
      .slice(0, MAX_BUSINESSES);

    const keywords: SeoPerformanceSnapshotV1["keywords"] = [];
    const grids: Grid[] = [];
    for (const business of matched) {
      const kh = await fetchKeywordScans(session, business);
      for (const k of kh) keywords.push({ keyword: k.keyword, businessName: business.businessName });
      const gridEntries = kh.filter((k) => k.scans[0]?.reportId).slice(0, MAX_GRIDS);
      const fetched = await mapWithConcurrency(gridEntries, 5, (k) => fetchGrid(session, k.keyword, k.scans[0]));
      for (const g of fetched) if (g) grids.push(g);
    }

    const allCheckins = await fetchCheckins(session);
    const clientCheckins = allCheckins.filter((c) => namesLikelyMatch(input.project.businessName, c.businessName));

    const snapshot: SeoPerformanceSnapshotV1 = {
      schemaVersion: 1,
      clientId: input.project.clientId,
      generatedAt: nowIso(),
      businesses: matched.map((b) => ({ businessId: b.businessId, businessName: b.businessName, status: "active" })),
      keywords,
      grids,
      checkinBusinessCount: clientCheckins.length,
      checkinTotalPosts: clientCheckins.reduce((s, c) => s + c.totalPosts, 0),
      notes: matched.length ? [] : [`No Rank Tracker business matched "${input.project.businessName}".`],
    };
    return {
      ok: true,
      snapshot,
      summary: `${matched.length} business(es), ${keywords.length} keyword(s), ${grids.length} grid(s), ${clientCheckins.length} check-in business(es).`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "mapranking_sync_failed" };
  }
}
