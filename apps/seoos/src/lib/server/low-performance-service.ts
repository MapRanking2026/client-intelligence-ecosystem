import type { AuthzContextV1 } from "@cie/contracts";

import type { SeoProjectV1 } from "@/src/lib/domain/project";
import type { RankingsIntel } from "@/src/lib/server/rankings-intelligence-service";
import { getRuleRange } from "@/src/lib/server/rules-service";

/**
 * Low-Performance diagnosis (spec M8.7-8.11, Academy 9.1-9.3). Runs only when
 * rankings-intelligence has already flagged the client in the Low-Performance
 * band (avg rank within `low_performance.avg_rank_band`). Sub-classifies the
 * cause and produces a prioritized improvement-plan skeleton with the impact
 * tiers the SOP defines. Read-only; nothing sent (outbound-lock safe).
 *
 * Honest scope: the full sub-classification (Technical Suppression vs
 * Stagnation vs Competitive Displacement) needs a crawl + competitor deltas
 * SEOOS doesn't compute here. This pass picks the best-supported sub-class from
 * the current grid band + client data, and flags what a specialist must gather
 * to confirm the rest.
 */
export type LpSubclass = "technical_suppression" | "stagnation" | "authority_or_displacement" | "unknown";

export interface LpPlanAction {
  tier: "high" | "medium" | "low";
  action: string;
}

export interface LowPerformanceDiagnosis {
  applicable: boolean;
  subclass: LpSubclass;
  subclassLabel: string;
  summary: string;
  avgRank: number | null;
  band: [number, number];
  plan: LpPlanAction[];
  confirmNext: string[];
}

const NOT_APPLICABLE: LowPerformanceDiagnosis = {
  applicable: false,
  subclass: "unknown",
  subclassLabel: "",
  summary: "",
  avgRank: null,
  band: [5, 20],
  plan: [],
  confirmNext: [],
};

export async function getLowPerformanceDiagnosis(
  authz: AuthzContextV1,
  project: SeoProjectV1,
  intel: RankingsIntel,
): Promise<LowPerformanceDiagnosis> {
  if (!intel.inLowPerformanceBand) return NOT_APPLICABLE;

  const band = await getRuleRange(authz.tenantId, "low_performance.avg_rank_band", 5, 20);
  const avgRank = intel.avgRank;
  const [lo, hi] = band;
  const mid = lo + (hi - lo) / 2; // stagnation band = lower half (stuck 5-12-ish)

  // Sub-classify from what we can see. Data completeness gaps push toward
  // "technical/data" (fix the foundation first); a shallow-but-stuck grid with
  // setup done reads as stagnation; a deeper weak grid reads as an authority /
  // competitive-displacement problem.
  let subclass: LpSubclass;
  let subclassLabel: string;
  let summary: string;

  const setupIncomplete = project.setupReadiness < 80;
  if (setupIncomplete) {
    subclass = "technical_suppression";
    subclassLabel = "Technical / foundation gap";
    summary = `Setup is only ${project.setupReadiness}% complete — fix the foundation before diagnosing performance. Confirm there's no noindex/canonical/crawl suppression and that the grid is valid (no water points, business open at scan time).`;
  } else if (avgRank != null && avgRank <= mid) {
    subclass = "stagnation";
    subclassLabel = "Stagnation";
    summary = `Average rank ${avgRank} is stuck in the upper part of the band (${lo}-${Math.round(mid)}) with setup complete — signals are deployed but insufficient. Amplify authority and reinforce signals.`;
  } else {
    subclass = "authority_or_displacement";
    subclassLabel = "Authority gap / possible competitive displacement";
    summary = `Average rank ${avgRank ?? "?"} sits in the lower part of the band — likely an authority deficit or a competitor pulling ahead. Run the competitor gap analysis before committing the plan.`;
  }

  // Impact-tiered improvement plan (Academy 9.3), tailored to the sub-class.
  const plan: LpPlanAction[] = [
    { tier: "high", action: "Verify keyword ↔ GBP service ↔ website page alignment for each tracked keyword; fix any missing link." },
  ];
  if (subclass === "technical_suppression") {
    plan.push(
      { tier: "high", action: "Run the technical audit (indexation, canonical, robots, crawl) and resolve any suppression before further work." },
      { tier: "high", action: "Validate the grid: remove water/unpopulated points and confirm the scan ran during business hours." },
      { tier: "medium", action: "Complete the remaining setup items to reach 100% readiness." },
    );
  } else if (subclass === "stagnation") {
    plan.push(
      { tier: "high", action: "Create/restructure a dedicated service page for the weakest keyword; strengthen internal links to it." },
      { tier: "high", action: "Launch a structured review-mention strategy (ask real customers to name the specific service)." },
      { tier: "medium", action: "Raise GBP posting cadence and refresh authentic photos." },
      { tier: "medium", action: "Deepen semantic coverage and add real decision-stage FAQs." },
      { tier: "low", action: "Tidy keyword density and cosmetic on-page issues (low impact)." },
    );
  } else {
    plan.push(
      { tier: "high", action: "Run the keyword-specific competitor gap analysis (reviews, categories, page depth, name keywords)." },
      { tier: "high", action: "Category correction if a competitor's primary category is better aligned to the intent." },
      { tier: "high", action: "Close the review gap — velocity and keyword-mention density vs the top-3 competitors." },
      { tier: "medium", action: "Reinforce local authority: citations, local backlinks, brand mentions." },
    );
  }

  const confirmNext = [
    "Confirm there is no technical suppression (noindex, canonical, robots, crawl) via the website audit.",
    "Confirm the grid is valid (no water points; business open at scan time).",
    "Gather competitor deltas (review spikes, category changes, new service pages) — not computed here.",
    "Check client involvement %: if below the Rule Library thresholds, the Results KPI weighting is protected for the pod.",
  ];

  return { applicable: true, subclass, subclassLabel, summary, avgRank, band, plan, confirmNext };
}
