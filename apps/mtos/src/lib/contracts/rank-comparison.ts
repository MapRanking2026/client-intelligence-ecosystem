/**
 * The rules a keyword comparison obeys before it may sit on a client slide.
 *
 * One rule shapes this whole file: MTOS never draws the map. What reaches a deck is the provider's
 * own captured Report Builder image, approved by the account manager first, because a grid of pins
 * redrawn here from scan data would look exactly like the measurement while being our picture of
 * it. The helpers that used to redraw those pins (`comparisonPins`, `rankColor`, `rankValue`) and
 * the one that guessed last month's scan (`selectPriorMonth`) were removed with the PowerPoint
 * redraw on 18 November 2026: the account manager now chooses both scan dates explicitly, so there
 * is nothing left to infer and nothing left to draw.
 *
 * What remains is about whether a comparison is honest -- `sameRankGrid` decides whether the two
 * scans even cover the same ground -- and where its slide belongs in the deck.
 */
import type { HeatmapGrid, Presentation, PresentationRankComparison, PresentationSlide } from "@/src/lib/mtos-data";

export function sameRankGrid(a: HeatmapGrid, b: HeatmapGrid): boolean {
  if ([...a.pins, ...b.pins].some(pin => !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng))) return false;
  const keys = (grid: HeatmapGrid) => grid.pins.map(pin => `${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`).sort();
  const left = keys(a), right = keys(b);
  return left.length > 0 && new Set(left).size === left.length && left.length === right.length && left.every((key, index) => key === right[index]);
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
