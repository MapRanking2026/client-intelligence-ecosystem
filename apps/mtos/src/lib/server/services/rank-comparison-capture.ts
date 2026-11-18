import { chromium as playwright } from "playwright-core";
import type { PresentationRankComparison } from "@/src/lib/mtos-data";

/** Capture the provider's original page and renderer; never redraw its map in MTOS. */
export async function captureOriginalRankComparison(comparison: PresentationRankComparison, originalReport: Record<string, unknown>, originalCompare: Record<string, unknown>) {
  const source = comparison.nativeSource;
  if (!source) throw new Error("An original Report Builder comparison is required.");
  const executable = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const chromium = executable ? undefined : (await import("@sparticuz/chromium")).default;
  const browser = await playwright.launch({ executablePath: executable || await chromium!.executablePath(), ...(chromium ? { args: chromium.args } : {}), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const payload = structuredClone(originalReport) as { data: { settings: Record<string, unknown>; data: { sections: Record<string, unknown> } } };
    const settings = payload.data.settings;
    const group = { id: "mtos-selected-comparison", heatmapId: source.heatmapId, scanReportIds: [source.scanA, source.scanB], keyword: comparison.keyword, status: "active", isDefault: false };
    settings.rank = { keywordGroups: [group] };
    settings.hiddenSections = ["checkins", "gbp", "reviews"];
    const rankings = payload.data.data.sections.rankings as Record<string, unknown>;
    rankings.groups = [group];
    rankings.keywords = (rankings.keywords as { heatmapId: string }[]).filter(item => item.heatmapId === source.heatmapId);
    await page.route("https://dashboardapi.mapranking.com/api/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== "GET") return route.abort();
      if (url.pathname === `/api/public/report-builder/${source.reportId}`) return route.fulfill({ json: payload });
      if (url.pathname === `/api/public/report-builder/${source.reportId}/rank/compare` && url.searchParams.get("heatmapId") === source.heatmapId && url.searchParams.get("scanA") === source.scanA && url.searchParams.get("scanB") === source.scanB) return route.fulfill({ json: originalCompare });
      return route.continue();
    });
    await page.goto(`https://dashboard.mapranking.com/public-report-builder?id=${encodeURIComponent(source.reportId)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const card = page.locator("#sec-rankings .print-avoid-break").filter({ has: page.locator(".compare-map-section") }).first();
    await card.waitFor({ state: "visible", timeout: 45000 });
    await card.scrollIntoViewIfNeeded();
    await card.locator(".gm-style").nth(1).waitFor({ state: "visible", timeout: 45000 });
    await page.evaluate(() => document.fonts.ready);
    // Native Google tiles/marker canvases settle asynchronously after the map mounts.
    await page.waitForTimeout(2000);
    if (await card.getByText("No scan on this date", { exact: true }).count()) throw new Error("Report Builder did not render both selected scans.");
    const bytes = await card.screenshot({ type: "png", animations: "disabled", timeout: 30000 });
    return { bytes, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } finally { await browser.close(); }
}
