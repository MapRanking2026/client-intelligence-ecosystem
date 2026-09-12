import type { AuthzContextV1 } from "@cie/contracts";

import type { SeoProjectV1 } from "@/src/lib/domain/project";
import { getPerformanceSnapshotRepo } from "@/src/lib/server/repositories/performance-snapshot-repo";
import { getRuleNumber, getRuleRange } from "@/src/lib/server/rules-service";

/**
 * Rankings intelligence: turn a client's latest grid snapshot into two
 * decisions the SOPs govern — "does this client dominate its current grid?"
 * (the M6.1 expansion rule) and "is it in the Low-Performance band?" (M12.14) —
 * reading every threshold live from the Rule Library rather than hardcoding it.
 * Read-only; nothing is written or sent (compatible with the outbound lock).
 */
export type RankingsVerdict = "dominating" | "low_performance" | "progressing" | "no_data";

export interface RankingsIntel {
  verdict: RankingsVerdict;
  trackedKeywords: number;
  top3Keywords: number;
  top3Pct: number | null;
  avgRank: number | null;
  /** True when the M6.1 dominance rule is met for the current grid. */
  dominatesGrid: boolean;
  /** True when avg rank sits inside the Low-Performance band. */
  inLowPerformanceBand: boolean;
  /** The thresholds actually applied, for transparent display. */
  applied: {
    top3CountRule: number;
    top3PctRule: number;
    portfolioSize: number;
    top3RankCutoff: number;
    lowPerfBand: [number, number];
  };
  headline: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function getRankingsIntel(
  authz: AuthzContextV1,
  project: SeoProjectV1,
): Promise<RankingsIntel> {
  const tenantId = authz.tenantId;
  const snapshot = await getPerformanceSnapshotRepo().get(tenantId, project.id);

  const [top3CountRule, top3PctRule, portfolioSize, top3RankCutoff, lowPerfBand] = await Promise.all([
    getRuleNumber(tenantId, "grid.dominance.top3_count", 3),
    getRuleNumber(tenantId, "grid.dominance.top3_pct", 60),
    getRuleNumber(tenantId, "keywords.portfolio.size", 5),
    getRuleNumber(tenantId, "heatmap.color_bands", 3), // leading number = green (top-3) cutoff
    getRuleRange(tenantId, "low_performance.avg_rank_band", 5, 20),
  ]);
  const applied = { top3CountRule, top3PctRule, portfolioSize, top3RankCutoff, lowPerfBand };

  const grids = snapshot?.grids ?? [];
  const ranked = grids.filter((g) => g.averageRankPosition != null) as Array<{ averageRankPosition: number }>;
  const trackedKeywords = grids.length;

  if (trackedKeywords === 0 || ranked.length === 0) {
    return {
      verdict: "no_data",
      trackedKeywords,
      top3Keywords: 0,
      top3Pct: null,
      avgRank: null,
      dominatesGrid: false,
      inLowPerformanceBand: false,
      applied,
      headline: "No rank/grid data yet — run a full scan to assess dominance and performance.",
    };
  }

  // A keyword counts as "in the top 3" when its average grid rank is at or
  // better than the heatmap green cutoff (default 3).
  const top3Keywords = ranked.filter((g) => g.averageRankPosition <= top3RankCutoff).length;
  const top3Pct = round1((top3Keywords / ranked.length) * 100);
  const avgRank = round1(ranked.reduce((a, g) => a + g.averageRankPosition, 0) / ranked.length);

  // M6.1 dominance: for portfolios up to the standard size, use the top-3 count
  // rule; for larger portfolios use the percentage rule.
  const dominatesGrid =
    ranked.length <= portfolioSize ? top3Keywords >= top3CountRule : top3Pct >= top3PctRule;

  const [lpLo, lpHi] = lowPerfBand;
  const inLowPerformanceBand = avgRank >= lpLo && avgRank <= lpHi;

  let verdict: RankingsVerdict;
  let headline: string;
  if (dominatesGrid) {
    verdict = "dominating";
    headline = `Dominating the current grid (${top3Keywords}/${ranked.length} keywords in the top ${top3RankCutoff}). Expansion candidate — grow the grid a step.`;
  } else if (inLowPerformanceBand) {
    verdict = "low_performance";
    headline = `Low-Performance band: average rank ${avgRank} sits within ${lpLo}-${lpHi}. Needs a diagnosis + improvement plan.`;
  } else {
    verdict = "progressing";
    headline = `Progressing: ${top3Keywords}/${ranked.length} keywords in the top ${top3RankCutoff}, average rank ${avgRank}. Keep executing.`;
  }

  return {
    verdict,
    trackedKeywords,
    top3Keywords,
    top3Pct,
    avgRank,
    dominatesGrid,
    inLowPerformanceBand,
    applied,
    headline,
  };
}
