/* eslint-disable @next/next/no-img-element -- Original provider PNG is displayed unchanged on the fixed slide canvas. */
import type { PresentationRankComparison } from "@/src/lib/mtos-data";
export function RankComparisonVisual({ comparison }: { comparison: PresentationRankComparison }) {
  const image = comparison.originalImage;
  return image ? <div style={{ position: "relative", width: 1152, height: 430, background: "#F7F9FC", borderRadius: 10, overflow: "hidden", border: "1px solid #D8E1EC" }}><img src={`/api/monthly-touches/${encodeURIComponent(image.touchId)}/rank-comparisons?image=${image.id}`} alt={`Original Rank Tracker comparison for ${comparison.keyword}: ${comparison.previous?.grid.scanDate.slice(0,10)} to ${comparison.current.grid.scanDate.slice(0,10)}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} /></div> : <p style={{ color: "#607086", fontSize: 22 }}>An original Rank Tracker screenshot is required for this comparison. No recreated map is shown.</p>;
}
