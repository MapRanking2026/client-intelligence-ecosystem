import { z } from "zod";
import { zIsoTimestamp, zTenantId, zUserId } from "@cie/contracts";

/**
 * The Rule Library (spec M12): the versioned numeric/config thresholds the rest
 * of the automation reads from — so a value like the map-pack dominance rule or
 * the GBP description length lives in ONE editable place, not hardcoded in ten.
 * A RuleV1 is a per-tenant OVERRIDE of a catalog default (mirrors the Prompt
 * Engine: default catalog + optional override, override wins, live immediately).
 */
export const RuleV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: zTenantId,
  key: z.string().min(1),
  value: z.string().min(1),
  updatedAt: zIsoTimestamp,
  updatedByUserId: zUserId.optional(),
});
export type RuleV1 = z.infer<typeof RuleV1>;

export interface RuleDef {
  key: string;
  category: string;
  name: string;
  description: string;
  defaultValue: string;
  unit?: string;
  /** Other documented values from the SOPs, kept as alternates (conflict notes). */
  alternatives?: string[];
  /** Source SOP page id(s) / references. */
  sources?: string[];
}

/**
 * Default rule catalog — a first, high-value slice of the M12 threshold set,
 * encoded from Map Ranking's SOPs. Where the SOPs conflict, the default is the
 * chosen value and the others are kept in `alternatives` rather than lost.
 */
export const RULE_CATALOG: RuleDef[] = [
  // ---- Grids & rankings ----
  {
    key: "grid.dominance.top3_count",
    category: "Grids & rankings",
    name: "Dominance — top-3 keyword count (5-keyword portfolios)",
    description: "Expand the grid when at least this many of the 5 tracked keywords rank in the map-pack top 3.",
    defaultValue: "3",
    unit: "keywords",
    sources: ["37831", "196171"],
  },
  {
    key: "grid.dominance.top3_pct",
    category: "Grids & rankings",
    name: "Dominance — top-3 percentage (larger portfolios)",
    description: "For portfolios larger than 5 keywords, expand when this % of tracked keywords are in the top 3.",
    defaultValue: "60",
    unit: "%",
    sources: ["37831", "196171"],
  },
  { key: "grid.initial.size", category: "Grids & rankings", name: "Initial grid size", description: "The grid size a new client starts on before any expansion.", defaultValue: "9x9", alternatives: ["13x13"], sources: ["37831"] },
  { key: "grid.initial.radius_miles", category: "Grids & rankings", name: "Initial grid radius", description: "The starting grid radius for a new client.", defaultValue: "3", unit: "miles", alternatives: ["5", "7"], sources: ["37831"] },
  { key: "grid.scan.lead_days_before_touch", category: "Grids & rankings", name: "Scan lead time before Monthly Touch", description: "Schedule the monthly scan this many business days before the client's Monthly Touch date.", defaultValue: "2", unit: "days", sources: ["37831", "200851"] },
  { key: "market_share.headline_band", category: "Grids & rankings", name: "Market-share headline band", description: "Which coverage band is reported as the headline market-share figure.", defaultValue: "Top-3", alternatives: ["Top-5"], sources: ["167231", "168711"] },

  // ---- GBP ----
  { key: "gbp.description.char_target", category: "Google Business Profile", name: "GBP description length", description: "Target character range for the GBP business description (hard max 750).", defaultValue: "700-750", unit: "chars", alternatives: ["250-300"], sources: ["369111"] },
  { key: "gbp.service_description.char_max", category: "Google Business Profile", name: "GBP service description max", description: "Hard cap for each GBP service description (Google UI limit).", defaultValue: "300", unit: "chars", alternatives: ["250-300"], sources: ["70831", "380671"] },
  { key: "gbp.additional_categories.max", category: "Google Business Profile", name: "Additional categories cap", description: "Maximum additional (secondary) GBP categories before requiring an override.", defaultValue: "2", unit: "categories", alternatives: ["3", "2-3"], sources: ["70831", "70791"] },
  { key: "gbp.service_area.warn_miles", category: "Google Business Profile", name: "Service-area distance warning", description: "Flag a service area farther than this from the business address as a risk.", defaultValue: "15", unit: "miles", alternatives: ["10-15"], sources: ["153071", "269811"] },
  { key: "gbp.hours.competitor_open_pct", category: "Google Business Profile", name: "Competitor-hours percentile", description: "Recommend opening/closing times at this competitor-availability percentile (the '20% rule').", defaultValue: "20", unit: "%", sources: ["168151"] },

  // ---- Reviews & reputation ----
  { key: "reviews.velocity.b2c_per_month", category: "Reviews & reputation", name: "Review velocity target — B2C", description: "Monthly new-review target for a B2C client.", defaultValue: "4", unit: "reviews/mo", alternatives: ["1/week", "3-5"], sources: ["166591", "169471"] },
  { key: "reviews.velocity.b2b_per_month", category: "Reviews & reputation", name: "Review velocity target — B2B", description: "Monthly new-review target for a B2B client.", defaultValue: "1", unit: "reviews/mo", sources: ["166591"] },
  { key: "reviews.response_sla_hours", category: "Reviews & reputation", name: "Review response SLA", description: "How quickly a review should be responded to.", defaultValue: "24", unit: "hours", sources: ["200951"] },
  { key: "reviews.team_reply_min_rating", category: "Reviews & reputation", name: "Min rating for a team-drafted reply", description: "Never auto-draft a reply for reviews at or below this star rating — route to the AM instead.", defaultValue: "4", unit: "stars", sources: ["166611"] },

  // ---- Posting & CTR ----
  { key: "posting.gbp_per_week", category: "Posting & CTR", name: "GBP post cadence (baseline)", description: "Baseline number of GBP posts per week.", defaultValue: "1", unit: "posts/week", alternatives: ["2-3 (competitive market)"], sources: ["35411", "51211"] },
  { key: "ctr.volume.age_0_3mo_per_day", category: "Posting & CTR", name: "CTR volume — GBP age 0–3 months", description: "Daily simulated-engagement volume for a GBP under 3 months old (see the M7.13 compliance gate).", defaultValue: "8-10", unit: "/day", sources: ["169471"] },
  { key: "ctr.volume.age_3_12mo_per_day", category: "Posting & CTR", name: "CTR volume — GBP age 3–12 months", description: "Daily simulated-engagement volume for a GBP 3–12 months old.", defaultValue: "10-20", unit: "/day", sources: ["169471"] },
  { key: "ctr.volume.age_12mo_plus_per_day", category: "Posting & CTR", name: "CTR volume — GBP age 12+ months", description: "Daily simulated-engagement volume for a GBP over 12 months old.", defaultValue: "20-40", unit: "/day", sources: ["169471"] },

  // ---- Performance & scoring ----
  { key: "low_perf.avg_rank_band", category: "Performance & scoring", name: "Low-Performance average-rank band", description: "A Phase-1/2-complete client whose 5 tracked keywords average within this rank band is flagged Low Performance.", defaultValue: "5-20", sources: ["133391", "174691"] },
  { key: "scoring.retention_weight", category: "Performance & scoring", name: "Monthly score — Retention weight", description: "Points weight of the Retention pillar in the monthly performance score.", defaultValue: "25", unit: "pts", sources: ["210791", "210811"] },
  { key: "scoring.execution_weight", category: "Performance & scoring", name: "Monthly score — Execution weight", description: "Points weight of the Execution pillar.", defaultValue: "25", unit: "pts", sources: ["210791", "210811"] },
  { key: "scoring.results_weight", category: "Performance & scoring", name: "Monthly score — Results weight", description: "Points weight of the Results pillar.", defaultValue: "50", unit: "pts", sources: ["210791", "210811"] },

  // ---- App internals (already consumed today) ----
  { key: "health.stale_days", category: "App internals", name: "Client data staleness threshold", description: "The client Health panel flags a client whose data hasn't refreshed in more than this many days.", defaultValue: "14", unit: "days", sources: ["SEOOS"] },
];

const BY_KEY = new Map(RULE_CATALOG.map((r) => [r.key, r]));
export function getRuleDef(key: string): RuleDef | undefined {
  return BY_KEY.get(key);
}
