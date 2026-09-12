import type { AuthzContextV1 } from "@cie/contracts";

import type { SeoProjectV1 } from "@/src/lib/domain/project";
import { getPerformanceSnapshotRepo } from "@/src/lib/server/repositories/performance-snapshot-repo";
import { getRuleNumber, getRuleValue } from "@/src/lib/server/rules-service";

/**
 * Monthly performance scoring (spec M10.38-42): a 100-point score of
 * Retention(25) + Execution(25) + Results(50), banded into tiers. SEOOS can
 * compute the **Results pillar** honestly from grid data; Retention, Execution
 * and Capacity depend on org-internal inputs (client-count history, ClickUp
 * task KPIs, capacity hours) that don't live in SEOOS yet, so this readout
 * reports the Results pillar + the tier scale and is explicit about the gap
 * rather than inventing a total. Every tunable threshold comes from the Rule
 * Library. Read-only; nothing sent (outbound-lock safe).
 */
export interface MonthlyScoreReadout {
  hasData: boolean;
  /** Ranking distribution across the client's tracked keywords. */
  distribution: { top5Pct: number; pos5to12Pct: number; pos12to20Pct: number; rankedKeywords: number };
  /** Results distribution points (0-30) per the documented bands (M10.40). */
  resultsDistributionPoints: number;
  resultsDistributionMax: number;
  /** Grid weight applied, looked up from scoring.results_grid_weights by grid size. */
  gridWeight: number | null;
  gridSize: number | null;
  gridRadiusAssumedMiles: number | null;
  /** Results pillar cap (scoring.results_weight, default 50). */
  resultsPillarMax: number;
  /** The tier-band scale, verbatim from scoring.tier_bands, for reference. */
  tierScale: string;
  /** Pillars SEOOS cannot compute yet — surfaced honestly, never faked. */
  uncomputedPillars: string[];
}

/** Documented Results ranking-distribution bands (spec M10.40 / policy 210791). */
function top5Points(pct: number): number {
  if (pct >= 60) return 18;
  if (pct >= 50) return 15;
  if (pct >= 40) return 12;
  if (pct >= 30) return 6;
  return 0;
}
function pos5to12Points(pct: number): number {
  if (pct <= 30) return 6;
  if (pct <= 40) return 4;
  if (pct <= 50) return 2;
  return 0;
}
function pos12to20Points(pct: number): number {
  if (pct <= 10) return 6;
  if (pct <= 20) return 3;
  return 0;
}

/** Parse "3mi:10 | 5mi:15 | 7mi:20 | >7mi:23" into [{miles, weight}]. */
function parseGridWeights(raw: string | undefined): Array<{ miles: number; weight: number }> {
  if (!raw) return [];
  return raw
    .split("|")
    .map((part) => {
      const nums = part.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      if (nums.length < 2) return null;
      return { miles: nums[0], weight: nums[1] };
    })
    .filter((x): x is { miles: number; weight: number } => x != null)
    .sort((a, b) => a.miles - b.miles);
}

/** Best-effort grid-size (9x9 / 13x13) -> radius miles. Flagged as an assumption. */
function gridSizeToMiles(gridSize: number | undefined): number | null {
  if (gridSize == null) return null;
  if (gridSize <= 9) return 3;
  if (gridSize <= 11) return 5;
  return 7;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function getMonthlyScoreReadout(
  authz: AuthzContextV1,
  project: SeoProjectV1,
): Promise<MonthlyScoreReadout> {
  const tenantId = authz.tenantId;
  const [snapshot, gridWeightsRaw, tierScale, resultsPillarMax] = await Promise.all([
    getPerformanceSnapshotRepo().get(tenantId, project.id),
    getRuleValue(tenantId, "scoring.results_grid_weights"),
    getRuleValue(tenantId, "scoring.tier_bands"),
    getRuleNumber(tenantId, "scoring.results_weight", 50),
  ]);

  const uncomputedPillars = [
    "Retention (25 pts) - needs client-count history",
    "Execution (25 pts) - needs ClickUp task KPIs",
    "Capacity Load - needs approved capacity hours",
  ];

  const grids = snapshot?.grids ?? [];
  const ranked = grids
    .filter((g) => g.averageRankPosition != null)
    .map((g) => g.averageRankPosition as number);

  if (ranked.length === 0) {
    return {
      hasData: false,
      distribution: { top5Pct: 0, pos5to12Pct: 0, pos12to20Pct: 0, rankedKeywords: 0 },
      resultsDistributionPoints: 0,
      resultsDistributionMax: 30,
      gridWeight: null,
      gridSize: null,
      gridRadiusAssumedMiles: null,
      resultsPillarMax,
      tierScale: tierScale ?? "Excellent 90-100 | Strong 80-89 | Needs Optimization 70-79 | Review <70",
      uncomputedPillars,
    };
  }

  const n = ranked.length;
  const top5Pct = round1((ranked.filter((r) => r <= 5).length / n) * 100);
  const pos5to12Pct = round1((ranked.filter((r) => r > 5 && r <= 12).length / n) * 100);
  const pos12to20Pct = round1((ranked.filter((r) => r > 12 && r <= 20).length / n) * 100);

  const resultsDistributionPoints = top5Points(top5Pct) + pos5to12Points(pos5to12Pct) + pos12to20Points(pos12to20Pct);

  // Grid weight: most common grid size across the snapshot, mapped to miles,
  // then looked up in the Rule Library's grid-weight table.
  const sizes = grids.map((g) => g.gridSize).filter((s): s is number => typeof s === "number");
  const gridSize = sizes.length ? sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)] : null;
  const gridRadiusAssumedMiles = gridSizeToMiles(gridSize ?? undefined);
  const weights = parseGridWeights(gridWeightsRaw);
  let gridWeight: number | null = null;
  if (gridRadiusAssumedMiles != null && weights.length) {
    // pick the weight for the largest tier at or below the assumed radius.
    const match = [...weights].reverse().find((w) => w.miles <= gridRadiusAssumedMiles);
    gridWeight = (match ?? weights[weights.length - 1]).weight;
  }

  return {
    hasData: true,
    distribution: { top5Pct, pos5to12Pct, pos12to20Pct, rankedKeywords: n },
    resultsDistributionPoints,
    resultsDistributionMax: 30,
    gridWeight,
    gridSize,
    gridRadiusAssumedMiles,
    resultsPillarMax,
    tierScale: tierScale ?? "Excellent 90-100 | Strong 80-89 | Needs Optimization 70-79 | Review <70",
    uncomputedPillars,
  };
}
