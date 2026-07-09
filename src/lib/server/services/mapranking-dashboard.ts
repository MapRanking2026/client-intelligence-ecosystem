import type { TenantContext } from "@/src/lib/contracts/mtos";
import type {
  HeatmapCompetitor,
  HeatmapGrid,
  HeatmapPin,
  KeywordScanHistory,
  KeywordScanPoint,
} from "@/src/lib/mtos-data";
import {
  getIntegrationConnection,
  getIntegrationCredentials,
} from "@/src/lib/server/integrations";

type JsonRecord = Record<string, unknown>;

const DEFAULT_API_BASE = "https://dashboardapi.mapranking.com";
// One live fetch per prepared touch; cap grid fetches so a keyword-heavy client can't stall prep.
const MAX_GRIDS_PER_CLIENT = 8;

interface DashboardSession {
  baseUrl: string;
  token: string;
}

async function postJson(url: string, body: JsonRecord, token?: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok) {
    const message =
      (typeof payload.message === "string" && payload.message) ||
      `MapRanking dashboard request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export async function openDashboardSession(context: TenantContext): Promise<DashboardSession | null> {
  const record = await getIntegrationConnection(context, "rank-tracker");
  if (!record || record.status !== "connected") {
    return null;
  }

  const credentials = getIntegrationCredentials(record);
  const email = credentials.clientId;
  const password = credentials.clientSecret;
  const baseUrl = (credentials.apiBaseUrl || record.apiBaseUrl || DEFAULT_API_BASE).replace(/\/$/, "");
  if (!email || !password) {
    return null;
  }

  const payload = await postJson(`${baseUrl}/api/auth/login`, { type: "email", email, password });
  const data = (payload.data || {}) as JsonRecord;
  const token = typeof data.token === "string" ? data.token : "";
  if (!token) {
    return null;
  }

  return { baseUrl, token };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function round1(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10;
}

export async function fetchKeywordScanHistory(
  session: DashboardSession,
  businesses: Array<{ businessId: string; businessName: string }>,
): Promise<KeywordScanHistory[]> {
  const byKeyword = new Map<string, KeywordScanHistory>();

  for (const business of businesses) {
    if (!business.businessId) {
      continue;
    }

    const payload = await postJson(
      `${session.baseUrl}/api/heatmap/keyword-history`,
      { business_id: business.businessId },
      session.token,
    );
    const rows = Array.isArray(payload.data) ? (payload.data as JsonRecord[]) : [];

    for (const row of rows) {
      const keyword = String(row.keyword || "").trim();
      if (!keyword) {
        continue;
      }

      const score = (row.score || {}) as JsonRecord;
      const marketShare = toNumber(score.marketShare);
      const scan: KeywordScanPoint = {
        scanDate: String(row.created_at || ""),
        averageRank: round1(toNumber(score.avg)),
        top3Pins: toNumber(score.high),
        marketSharePercent: marketShare === null ? null : Math.round(marketShare * 1000) / 10,
        notRankingPins: toNumber(score.not_ranking),
        reportId: String(row.report_id || ""),
      };

      const mapKey = `${business.businessName}::${keyword}`;
      const entry = byKeyword.get(mapKey) || {
        keyword,
        businessName: business.businessName,
        scans: [],
      };
      entry.scans.push(scan);
      byKeyword.set(mapKey, entry);
    }
  }

  return Array.from(byKeyword.values()).map((entry) => ({
    ...entry,
    // newest first, keep enough history for a 3-month trend read
    scans: entry.scans
      .sort((a, b) => b.scanDate.localeCompare(a.scanDate))
      .slice(0, 4),
  }));
}

export async function fetchHeatmapGrids(
  session: DashboardSession,
  keywordHistory: KeywordScanHistory[],
): Promise<HeatmapGrid[]> {
  const grids: HeatmapGrid[] = [];

  for (const entry of keywordHistory.slice(0, MAX_GRIDS_PER_CLIENT)) {
    const latestScan = entry.scans[0];
    if (!latestScan?.reportId) {
      continue;
    }

    try {
      const payload = await postJson(
        `${session.baseUrl}/api/heatmap/report`,
        { id: latestScan.reportId },
        session.token,
      );
      const report = (payload.data || {}) as JsonRecord;
      const scanData = ((report.data as JsonRecord | undefined)?.data || {}) as JsonRecord;
      const results = Array.isArray(scanData.results) ? (scanData.results as JsonRecord[]) : [];

      const pins: HeatmapPin[] = results.map((pin) => ({
        lat: toNumber(pin.lat) ?? 0,
        lng: toNumber(pin.lng) ?? 0,
        rank: pin.found === false ? null : toNumber(pin.rank),
      }));

      const competitorTally = new Map<string, HeatmapCompetitor & { hits: number }>();
      for (const pin of results) {
        const pinResults = Array.isArray(pin.results) ? (pin.results as JsonRecord[]).slice(0, 3) : [];
        for (const competitor of pinResults) {
          const name = String(competitor.business || "").trim();
          if (!name || name.toLowerCase() === entry.businessName.toLowerCase()) {
            continue;
          }
          const existing = competitorTally.get(name) || {
            name,
            rating: toNumber(competitor.rating),
            reviews: toNumber(competitor.reviews),
            hits: 0,
          };
          existing.hits += 1;
          competitorTally.set(name, existing);
        }
      }
      const topCompetitors = Array.from(competitorTally.values())
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 5)
        .map(({ name, rating, reviews }) => ({ name, rating, reviews }));

      const points = toNumber(scanData.points) ?? pins.length;
      const top3Count = pins.filter((pin) => pin.rank !== null && pin.rank <= 3).length;

      grids.push({
        keyword: entry.keyword,
        scanDate: latestScan.scanDate,
        gridSize: Math.round(Math.sqrt(points || pins.length)) || 0,
        averageRankPosition: round1(toNumber(scanData.arp)),
        shareOfLocalVoicePercent: round1(toNumber(scanData.solv)),
        top3Percent: points ? Math.round((top3Count / points) * 1000) / 10 : null,
        pins,
        topCompetitors,
      });
    } catch {
      // One failed report should not sink the rest of the prep evidence.
      continue;
    }
  }

  return grids;
}

export async function fetchCheckinBusinesses(session: DashboardSession) {
  const businesses: JsonRecord[] = [];
  let page = 1;

  // paginate defensively; the API ignores unknown filters so match client-side
  for (; page <= 10; page += 1) {
    const payload = await postJson(
      `${session.baseUrl}/api/checkin-business/get-business-paginated`,
      { page, limit: 100 },
      session.token,
    );
    const rows = Array.isArray(payload.data) ? (payload.data as JsonRecord[]) : [];
    businesses.push(...rows);
    if (rows.length < 100) {
      break;
    }
  }

  return businesses.map((row) => ({
    businessName: String(row.business_name || ""),
    totalPosts: toNumber(row.totalPosts) ?? 0,
    scheduledPosts: toNumber(row.scheduledPosts) ?? 0,
    connectedPlatforms: Object.entries((row.integration_status || {}) as Record<string, unknown>)
      .filter(([, connected]) => connected === true)
      .map(([platform]) => platform),
  }));
}
