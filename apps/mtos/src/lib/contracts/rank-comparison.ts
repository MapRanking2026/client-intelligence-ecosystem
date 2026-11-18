import type { HeatmapGrid, KeywordScanPoint, Presentation, PresentationRankComparison, PresentationSlide } from "@/src/lib/mtos-data";

export function selectPriorMonth(scans: KeywordScanPoint[], current: KeywordScanPoint): KeywordScanPoint | undefined {
  const date = new Date(current.scanDate);
  if (!Number.isFinite(date.getTime())) return;
  const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  return scans.filter(scan => scan.reportId !== current.reportId && scan.scanDate.slice(0, 7) === month && Date.parse(scan.scanDate) < Date.parse(current.scanDate)).sort((a, b) => Date.parse(b.scanDate) - Date.parse(a.scanDate))[0];
}
export function sameRankGrid(a: HeatmapGrid, b: HeatmapGrid): boolean {
  if ([...a.pins, ...b.pins].some(pin => !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng))) return false;
  const keys = (grid: HeatmapGrid) => grid.pins.map(pin => `${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`).sort();
  const left = keys(a), right = keys(b);
  return left.length > 0 && new Set(left).size === left.length && left.length === right.length && left.every((key, index) => key === right[index]);
}
export function rankValue(value: number | null | undefined): string { return typeof value === "number" && Number.isFinite(value) && value > 0 ? String(Math.round(value * 10) / 10) : "Not available"; }
export function rankColor(rank: number | null): string { return rank === null || rank <= 0 ? "#8A97A6" : rank <= 3 ? "#16866B" : rank <= 10 ? "#E4A11B" : "#D36755"; }
/** Shared pin positions for the HTML deck and native PowerPoint shapes; no invented map tiles. */
export function comparisonPins(comparison: PresentationRankComparison, grid: HeatmapGrid) {
  const all = [...comparison.current.grid.pins, ...(comparison.previous?.grid.pins || [])].filter(pin => Number.isFinite(pin.lat) && Number.isFinite(pin.lng));
  const lats = all.map(pin => pin.lat), lngs = all.map(pin => pin.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  return grid.pins.filter(pin => Number.isFinite(pin.lat) && Number.isFinite(pin.lng)).map(pin => ({ ...pin, x: maxLng === minLng ? 0.5 : (pin.lng - minLng) / (maxLng - minLng), y: maxLat === minLat ? 0.5 : (maxLat - pin.lat) / (maxLat - minLat) }));
}
export function rankSummary(comparison: PresentationRankComparison): string {
  if (!comparison.previous) return "No verified prior-month scan available";
  if (!comparison.sameGrid) return "Scan coverage changed · compare with care";
  const before = comparison.previous.grid.averageRankPosition, after = comparison.current.grid.averageRankPosition;
  if (before === null || after === null || before <= 0 || after <= 0) return "Average rank change unavailable";
  const delta = Math.round((before - after) * 10) / 10;
  return delta === 0 ? "Average rank unchanged" : `${Math.abs(delta)} positions ${delta > 0 ? "better" : "lower"} in average rank`;
}
export function withRankComparisons(presentation: Presentation, comparisons: PresentationRankComparison[]): Presentation {
  const slides = [...(presentation.slides || [])];
  for (const comparison of comparisons.filter(item => item.originalImage && item.nativeSource).slice(0, 12)) {
    const keyword = comparison.keyword.toLowerCase();
    const index = slides.findIndex(slide => slide.layout !== "rank_comparison" && [slide.title, slide.subtitle, ...(slide.bullets || []), ...(slide.table?.rows.flat() || [])].filter(Boolean).join(" ").toLowerCase().includes(keyword));
    const matching = index >= 0 ? slides[index] : undefined;
    const slide: PresentationSlide = { layout: "rank_comparison", sectionId: matching?.sectionId || "8", section: "GOOGLE MAPS · KEYWORD COMPARISON", title: comparison.keyword,
      subtitle: `${comparison.businessName}${comparison.address ? ` · ${comparison.address}` : ""}`, rankComparison: comparison,
      footnote: "Source: Original Report Builder capture · Selected scan dates shown in the image.",
      presenterNotes: `${rankSummary(comparison)}. Previous scan: ${comparison.previous?.grid.scanDate || "unavailable"}; latest scan: ${comparison.current.grid.scanDate}. These are local grid ranks, not one universal Google position. Do not infer causation from a ranking change.` };
    const duplicate = slides.findIndex(item => item.rankComparison?.businessId === comparison.businessId && item.rankComparison.keyword === comparison.keyword);
    if (duplicate >= 0) slides[duplicate] = slide;
    else if (index >= 0) slides.splice(index + 1, 0, slide);
    else { const closing = slides.findIndex(item => item.layout === "closing"); slides.splice(closing < 0 ? slides.length : closing, 0, slide); }
  }
  return { ...presentation, slides };
}
