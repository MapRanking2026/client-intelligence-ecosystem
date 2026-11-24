import { createHash } from "node:crypto";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { HeatmapGrid, MonthlyTouchRecord, PresentationRankComparison, RankScanScreenshot } from "@/src/lib/mtos-data";
import { sameRankGrid } from "@/src/lib/contracts/rank-comparison";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { namesLikelyMatch } from "@/src/lib/server/name-matching";
import { fetchAllBusinesses, openDashboardSession, type DashboardSession } from "./mapranking-dashboard";
import { captureOriginalRankComparison } from "./rank-comparison-capture";

type Json = Record<string, unknown>;
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
/**
 * One report row belongs to one prepared location.
 *
 * The name must be exact, because two locations of the same brand are only told apart by address.
 * A blank address on the report side is not treated as a mismatch: Rank Tracker leaves it empty on
 * some reports, and refusing those would hide a location the account manager can plainly see.
 */
const sameLocation = (business: { businessName: string; address: string }, row: { name: string; address: string }) =>
  normalized(business.businessName) === normalized(row.name)
  && (!normalized(row.address) || normalized(business.address) === normalized(row.address));
async function visibleTouch(context: TenantContext, touchId: string) {
  const source = getMtosDataSource(context), touch = await source.getMonthlyTouchById(touchId);
  if (!touch || !await source.getClientById(touch.clientId)) throw new Error("Monthly Touch is not available to your account.");
  return touch;
}
/**
 * The client's Rank Tracker locations, whether or not the preparation has run.
 *
 * This panel sits in the Prep stage, so account managers open it before generating the brief. Until
 * now the only source of locations was the prep pack, which left the picker empty with nothing to
 * choose and no explanation. Falling back to the same live match the preparation itself performs --
 * fuzzy name match plus the client's manually pinned businesses -- means the panel works from the
 * moment the account is connected, while a generated prep pack still takes precedence because its
 * locations were already reviewed.
 */
async function clientLocations(touch: MonthlyTouchRecord, client: { name: string; integrationMappings?: { rankTracker?: string[] } }, session: DashboardSession) {
  const prepared = [...(touch.prepPack?.seoPerformance?.matchedBusinesses || []), ...(touch.prepPack?.seoPerformance?.profiles || []).map(profile => profile.business)];
  if (prepared.length) return prepared;
  const pinned = new Set(client.integrationMappings?.rankTracker || []);
  const live = await fetchAllBusinesses(session);
  const matched = live.filter(business => namesLikelyMatch(client.name, business.businessName) || pinned.has(business.businessId));
  if (!matched.length) throw new Error(`No Rank Tracker location is matched to ${client.name}. Pin the location on the client's integration settings, then reopen this panel.`);
  return matched;
}
async function read(url: string, token?: string): Promise<Json> {
  const response = await fetch(url, { headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(45000), cache: "no-store" });
  const payload = await response.json().catch(() => null) as Json | null;
  if (!response.ok) {
    const detail = typeof payload?.message === "string" ? payload.message.slice(0, 300) : "";
    const recovery = response.status === 401 || response.status === 403
      ? " Reconnect Rank Tracker or verify access to this report."
      : " Try loading the report again.";
    throw new Error(`Rank Tracker returned ${response.status}${detail ? `: ${detail}` : "."}${recovery}`);
  }
  if (!payload) throw new Error("Rank Tracker returned an unreadable response. Try loading the report again.");
  return payload;
}
export async function listOriginalReports(context: TenantContext, touchId: string) {
  const touch = await visibleTouch(context, touchId);
  const client = await getMtosDataSource(context).getClientById(touch.clientId);
  const session = await openDashboardSession(context); if (!session || !client) throw new Error("Connect Rank Tracker and refresh preparation first.");
  const businesses = await clientLocations(touch, client, session);
  const matched = new Map<string, { id: string; name: string; address: string }>();
  // Use the same page size as the provider's Report Builder UI. Its report-list
  // contract differs from eligible-businesses, where a limit of 50 is accepted.
  const limit = 10;
  // Whoever built the report named it, and that is often the location rather than the account. Both
  // are searched so a report filed under one name is not invisible because MTOS knows the other.
  const searches = [...new Set([client.name, ...businesses.map(business => business.businessName)].map(term => term.trim()).filter(Boolean))].slice(0, 8);
  for (const search of searches) {
    let exhausted = false;
    for (let page = 1; page <= 100 && !exhausted; page++) {
      const response = await read(`${session.baseUrl}/api/report-builder?${new URLSearchParams({ search, page: String(page), limit: String(limit) })}`, session.token);
      const data = response.data as { items?: { id: string; name: string; address: string }[]; total?: number } | undefined;
      if (!Array.isArray(data?.items)) throw new Error("Rank Tracker did not return a report list. Try loading the report again.");
      for (const row of data.items) {
        if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.address !== "string") continue;
        if (businesses.some(business => sameLocation(business, row))) matched.set(row.id, { id: row.id, name: row.name, address: row.address });
      }
      exhausted = !data.items.length || (typeof data.total === "number" && page * limit >= data.total) || (data.total === undefined && data.items.length < limit);
    }
    if (!exhausted) throw new Error("Rank Tracker returned too many report pages. Narrow this client's report search before retrying.");
  }
  return [...matched.values()];
}
export async function readOriginalReport(context: TenantContext, touchId: string, reportId: string) {
  const touch = await visibleTouch(context, touchId);
  const client = await getMtosDataSource(context).getClientById(touch.clientId);
  const session = await openDashboardSession(context);
  if (!session || !client) throw new Error("Connect Rank Tracker before reviewing its original reports.");
  // Verify access through the connected account before reading the report's existing share view.
  await read(`${session.baseUrl}/api/report-builder/${reportId}`, session.token);
  const original = await read(`https://dashboardapi.mapranking.com/api/public/report-builder/${reportId}`);
  const data = original.data as { business: { name: string; address: string }; settings: { rank?: { keywordGroups?: Json[] } }; data: { sections: { rankings: { keywords: { heatmapId: string; keyword: string }[]; groups: { heatmapId: string; scanReportIds: string[] }[] } } } };
  const businesses = await clientLocations(touch, client, session);
  const business = businesses.find(item => sameLocation(item, { name: data.business.name, address: data.business.address }));
  if (!business) throw new Error("This report location is not matched to this client's Rank Tracker locations. Pin the location on the client's integration settings, then reopen this panel.");
  const keywords = await Promise.all((data.data.sections.rankings.keywords || []).slice(0, 24).map(async keyword => {
    const payload = await read(`${session.baseUrl}/api/report-builder/${reportId}/rank/scans?heatmapId=${encodeURIComponent(keyword.heatmapId)}`, session.token);
    const scans = (payload.data as { scans: { reportId: string; date: string }[] }).scans || [];
    const selected = data.data.sections.rankings.groups.find(group => group.heatmapId === keyword.heatmapId)?.scanReportIds || [];
    return { ...keyword, scans, selected };
  }));
  return { touch, business, original, keywords };
}
export async function previewOriginalComparison(context: TenantContext, touchId: string, selection: { reportId: string; heatmapId: string; scanA: string; scanB: string }) {
  const report = await readOriginalReport(context, touchId, selection.reportId);
  const keyword = report.keywords.find(item => item.heatmapId === selection.heatmapId);
  if (!keyword || selection.scanA === selection.scanB || ![selection.scanA, selection.scanB].every(id => keyword.scans.some(scan => scan.reportId === id))) throw new Error("Select two different available scans for this keyword.");
  const params = new URLSearchParams({ heatmapId: selection.heatmapId, scanA: selection.scanA, scanB: selection.scanB });
  const originalCompare = await read(`https://dashboardapi.mapranking.com/api/public/report-builder/${selection.reportId}/rank/compare?${params}`);
  type Scan = { available: boolean; reportId: string; date: string; gridSize: number; pins: HeatmapGrid["pins"]; summary: { avgRank: number | null; top3Pct: number | null; marketShare: number | null } };
  const native = originalCompare.data as { scanA: Scan; scanB: Scan };
  if (!native.scanA?.available || !native.scanB?.available || Date.parse(native.scanA.date) >= Date.parse(native.scanB.date)) throw new Error("The Before scan must be earlier than the After scan, and both must be available.");
  const grid = (scan: Scan): HeatmapGrid => ({ keyword: keyword.keyword, scanDate: scan.date, gridSize: scan.gridSize, pins: scan.pins, averageRankPosition: scan.summary.avgRank, top3Percent: scan.summary.top3Pct, shareOfLocalVoicePercent: scan.summary.marketShare, topCompetitors: [] });
  const current = grid(native.scanB), previous = grid(native.scanA);
  const comparison: PresentationRankComparison = { nativeSource: selection, keyword: keyword.keyword, businessId: report.business.businessId, businessName: report.business.businessName, address: report.business.address, current: { reportId: native.scanB.reportId, grid: current }, previous: { reportId: native.scanA.reportId, grid: previous }, baselineLabel: "Dates selected and reviewed by the account manager", sameGrid: sameRankGrid(previous, current) };
  const image = await captureOriginalRankComparison(comparison, report.original, originalCompare);
  const id = createHash("sha256").update(image.bytes).digest("hex");
  const screenshot: RankScanScreenshot = { id, touchId, width: image.width, height: image.height, mimeType: "image/png" };
  const db = getFirebaseAdminDb(); if (!db) throw new Error("MTOS storage is unavailable.");
  const ref = db.doc(`${monthlyTouchPath(context.tenantId, touchId)}/rankImages/${id}`);
  const base64 = image.bytes.toString("base64"); if (base64.length > 10000000) throw new Error("The original comparison image is too large to save.");
  const batch = db.batch(); const chunks = Math.ceil(base64.length / 600000);
  for (let index = 0; index < chunks; index++) batch.set(ref.collection("chunks").doc(String(index)), { data: base64.slice(index * 600000, (index + 1) * 600000) });
  batch.set(ref, { ...screenshot, chunks, comparison: { ...comparison, originalImage: screenshot }, capturedAt: new Date().toISOString() }); await batch.commit();
  return { ...comparison, originalImage: screenshot };
}
export async function loadRankImage(context: TenantContext, image: RankScanScreenshot) {
  await visibleTouch(context, image.touchId);
  const db = getFirebaseAdminDb(); if (!db) throw new Error("MTOS storage is unavailable.");
  const ref = db.doc(`${monthlyTouchPath(context.tenantId, image.touchId)}/rankImages/${image.id}`), snapshot = await ref.get();
  const saved = snapshot.data(); if (!saved) throw new Error("Original Rank Tracker image not found. Preview this comparison again.");
  const chunks = await Promise.all(Array.from({ length: saved.chunks as number }, (_, index) => ref.collection("chunks").doc(String(index)).get()));
  return { bytes: Buffer.from(chunks.map(chunk => chunk.data()?.data || "").join(""), "base64"), comparison: saved.comparison as PresentationRankComparison };
}
export async function approveOriginalComparison(context: TenantContext, touchId: string, imageId: string) {
  const touch = await visibleTouch(context, touchId), db = getFirebaseAdminDb(); if (!db) throw new Error("MTOS storage is unavailable.");
  const image = await db.doc(`${monthlyTouchPath(context.tenantId, touchId)}/rankImages/${imageId}`).get();
  const comparison = image.data()?.comparison as PresentationRankComparison | undefined;
  if (!comparison?.originalImage) throw new Error("Preview the original comparison before approving it.");
  await db.runTransaction(async tx => {
    const ref = db.doc(monthlyTouchPath(context.tenantId, touch.id)), fresh = (await tx.get(ref)).data() as MonthlyTouchRecord;
    const previous = (fresh.approvedRankComparisons || []).filter(item => item.nativeSource?.heatmapId !== comparison.nativeSource?.heatmapId || item.businessId !== comparison.businessId);
    if (previous.length >= 12) throw new Error("Keep up to 12 approved comparisons in one presentation.");
    tx.update(ref, { approvedRankComparisons: [...previous, comparison] });
  });
  return { approved: true };
}
