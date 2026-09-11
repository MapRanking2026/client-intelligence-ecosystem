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

  // ---- Grids & rankings (more) ----
  { key: "grid.expansion.step_miles", category: "Grids & rankings", name: "Grid expansion increment", description: "When a client earns an expansion, grow the grid radius by this much per step.", defaultValue: "2", unit: "miles", alternatives: ["3"], sources: ["37831"] },
  { key: "grid.max.radius_miles", category: "Grids & rankings", name: "Grid radius cap", description: "Never expand a grid beyond this radius without an AM sign-off (past this, the map pack stops being locally relevant).", defaultValue: "15", unit: "miles", sources: ["37831"] },
  { key: "rankings.tracked_keywords.default", category: "Grids & rankings", name: "Tracked keywords per client (default)", description: "The default number of keywords tracked on the geo-grid for a standard client.", defaultValue: "5", unit: "keywords", sources: ["291411"] },
  { key: "rankings.top3.max_rank", category: "Grids & rankings", name: "Top-3 (green) cutoff", description: "A grid point at this rank or better counts as map-pack top-3 (green) for dominance and market-share math.", defaultValue: "3", unit: "rank", sources: ["37831", "167231"] },
  { key: "rankings.visible.max_rank", category: "Grids & rankings", name: "Visible (yellow) cutoff", description: "A grid point ranked at or better than this counts as 'visible' on the map (yellow); worse is effectively invisible (red).", defaultValue: "10", unit: "rank", sources: ["167231"] },

  // ---- Onboarding & setup ----
  { key: "onboarding.kickoff_sla_days", category: "Onboarding & setup", name: "Kickoff SLA", description: "Hold the onboarding kickoff within this many business days of a client signing.", defaultValue: "3", unit: "days", sources: ["Onboarding SOP"] },
  { key: "onboarding.baseline_scan.within_days", category: "Onboarding & setup", name: "Baseline scan window", description: "Run the first full rank/grid scan within this many business days of kickoff, to lock the before-state.", defaultValue: "5", unit: "days", sources: ["Onboarding SOP"] },
  { key: "onboarding.phase1.target_days", category: "Onboarding & setup", name: "Phase 1 target duration", description: "Target elapsed days to complete Phase 1 (quick wins + GBP to 100%) from kickoff.", defaultValue: "30", unit: "days", alternatives: ["45"], sources: ["Onboarding SOP"] },
  { key: "onboarding.gbp_completeness.target_pct", category: "Onboarding & setup", name: "GBP completeness target (Phase 1 exit)", description: "GBP must reach this completeness before Phase 1 is considered done.", defaultValue: "100", unit: "%", sources: ["369111"] },
  { key: "setup.readiness.ready_pct", category: "Onboarding & setup", name: "Setup-readiness 'ready' bar", description: "A client at or above this setup-readiness percentage is treated as fully set up (below it, the Health panel flags setup).", defaultValue: "80", unit: "%", sources: ["SEOOS"] },
  { key: "lifecycle.phase2.start_month", category: "Onboarding & setup", name: "Phase 2 start", description: "Website-SEO work (Phase 2) begins in this service month, after Phase 1 local foundations are set.", defaultValue: "2", unit: "month", alternatives: ["3"], sources: ["Delivery SOP"] },

  // ---- Keywords & portfolio ----
  { key: "keywords.portfolio.size", category: "Keywords & portfolio", name: "Keyword portfolio size", description: "Standard keyword portfolio size built during onboarding.", defaultValue: "5", unit: "keywords", alternatives: ["10"], sources: ["291411"] },
  { key: "keywords.service_pages.per_primary", category: "Keywords & portfolio", name: "Service pages per primary keyword", description: "Build this many dedicated service/landing pages per primary money keyword.", defaultValue: "1", unit: "pages", sources: ["14831"] },
  { key: "keywords.secondary.per_page.max", category: "Keywords & portfolio", name: "Secondary keywords per page (cap)", description: "Don't target more than this many secondary keywords on a single page (dilutes relevance).", defaultValue: "3", unit: "keywords", sources: ["14831"] },

  // ---- Citations & NAP ----
  { key: "citations.tier1.count", category: "Citations & NAP", name: "Tier-1 citation set", description: "The core citation set (Apple, Bing, Yelp, FB, data aggregators, top niche/geo directories) every client gets.", defaultValue: "40", unit: "citations", alternatives: ["25", "50"], sources: ["Citations SOP"] },
  { key: "citations.monthly.build_count", category: "Citations & NAP", name: "Ongoing citations per month", description: "Net-new citations built per month after the Tier-1 foundation is placed.", defaultValue: "5", unit: "/month", sources: ["Citations SOP"] },
  { key: "nap.consistency.target_pct", category: "Citations & NAP", name: "NAP consistency target", description: "Name/Address/Phone must match this percentage across all live citations.", defaultValue: "100", unit: "%", sources: ["Citations SOP"] },

  // ---- Website & technical SEO ----
  { key: "web.title.char_max", category: "Website & technical SEO", name: "Title tag length", description: "Keep title tags at or under this length so they aren't truncated in the SERP.", defaultValue: "60", unit: "chars", sources: ["14751"] },
  { key: "web.meta_description.char_max", category: "Website & technical SEO", name: "Meta description length", description: "Keep meta descriptions at or under this length.", defaultValue: "155", unit: "chars", alternatives: ["160"], sources: ["14751"] },
  { key: "web.h1.per_page", category: "Website & technical SEO", name: "H1 per page", description: "Exactly one H1 per page.", defaultValue: "1", unit: "per page", sources: ["14751"] },
  { key: "web.cwv.lcp_seconds", category: "Website & technical SEO", name: "Core Web Vitals — LCP (good)", description: "Largest Contentful Paint should be at or under this to pass CWV.", defaultValue: "2.5", unit: "seconds", sources: ["Google CWV"] },
  { key: "web.cwv.inp_ms", category: "Website & technical SEO", name: "Core Web Vitals — INP (good)", description: "Interaction to Next Paint should be at or under this.", defaultValue: "200", unit: "ms", sources: ["Google CWV"] },
  { key: "web.cwv.cls", category: "Website & technical SEO", name: "Core Web Vitals — CLS (good)", description: "Cumulative Layout Shift should be at or under this.", defaultValue: "0.1", sources: ["Google CWV"] },
  { key: "web.pagespeed.mobile_min", category: "Website & technical SEO", name: "PageSpeed mobile floor", description: "Flag any page whose mobile PageSpeed Insights score falls below this.", defaultValue: "70", unit: "score", alternatives: ["50", "80"], sources: ["Web Audit SOP"] },
  { key: "web.image.alt_coverage_pct", category: "Website & technical SEO", name: "Image alt-text coverage", description: "Share of content images that must carry descriptive alt text.", defaultValue: "100", unit: "%", sources: ["Web Audit SOP"] },

  // ---- Content ----
  { key: "content.homepage.min_words", category: "Content", name: "Homepage minimum length", description: "Minimum body word count for a homepage build.", defaultValue: "800", unit: "words", alternatives: ["600", "1000"], sources: ["14751"] },
  { key: "content.service_page.min_words", category: "Content", name: "Service page minimum length", description: "Minimum body word count for a service/landing page.", defaultValue: "600", unit: "words", alternatives: ["500", "750"], sources: ["14831"] },
  { key: "content.blog.monthly_count", category: "Content", name: "Blog / content cadence", description: "New content pieces published per month (where content is in scope).", defaultValue: "2", unit: "/month", alternatives: ["1", "4"], sources: ["Content SOP"] },
  { key: "content.keyword_density.max_pct", category: "Content", name: "Keyword density ceiling", description: "Keep primary-keyword density at or under this to avoid stuffing (a suspension/penalty risk).", defaultValue: "2", unit: "%", sources: ["14831"] },

  // ---- Reviews & reputation (more) ----
  { key: "reviews.min_avg_rating", category: "Reviews & reputation", name: "Minimum healthy average rating", description: "Flag a client whose GBP average rating falls below this.", defaultValue: "4.0", unit: "stars", sources: ["166591"] },
  { key: "reviews.request.after_service_hours", category: "Reviews & reputation", name: "Review-request timing", description: "Send the review request this many hours after the job is completed, while the experience is fresh.", defaultValue: "24", unit: "hours", alternatives: ["48"], sources: ["166591"] },

  // ---- Posting & media (more) ----
  { key: "posting.photos_per_month", category: "Posting & CTR", name: "GBP photos per month", description: "Fresh GBP photos uploaded per month to keep the profile active.", defaultValue: "8", unit: "photos/mo", alternatives: ["4", "10"], sources: ["35411"] },
  { key: "posting.offer_post.monthly", category: "Posting & CTR", name: "GBP offer posts per month", description: "Offer/what's-new GBP posts per month (on top of the baseline cadence).", defaultValue: "1", unit: "/month", sources: ["35411"] },

  // ---- Reporting & cadence ----
  { key: "cadence.full_scan.per_month", category: "Reporting & cadence", name: "Full scans per month", description: "How many full rank/grid scans run per client per month.", defaultValue: "1", unit: "/month", sources: ["200851"] },
  { key: "reporting.report.delivery_sla_days", category: "Reporting & cadence", name: "Monthly report delivery SLA", description: "Deliver the monthly report within this many business days after the scan/close of month.", defaultValue: "3", unit: "days", sources: ["Reporting SOP"] },
  { key: "reporting.monthly_touch.lead_days", category: "Reporting & cadence", name: "Monthly-touch prep lead time", description: "Have the monthly-touch agenda and data ready this many business days before the client call.", defaultValue: "2", unit: "days", sources: ["200851"] },

  // ---- Retention & lifecycle ----
  { key: "retention.at_risk.months_flat", category: "Retention & lifecycle", name: "At-risk — months without movement", description: "Flag a client as retention-risk after this many consecutive months with no ranking improvement.", defaultValue: "3", unit: "months", sources: ["210791"] },
  { key: "retention.offboarding.notice_days", category: "Retention & lifecycle", name: "Offboarding notice period", description: "Standard notice period honored on cancellation before access/work stops.", defaultValue: "30", unit: "days", sources: ["Offboarding SOP"] },
  { key: "retention.min_tenure_months", category: "Retention & lifecycle", name: "Expected time-to-results", description: "Set client expectations that meaningful local movement typically takes at least this long.", defaultValue: "3", unit: "months", alternatives: ["4", "6"], sources: ["Onboarding SOP"] },

  // ---- Performance & scoring (more) ----
  { key: "scoring.pass_threshold", category: "Performance & scoring", name: "Monthly score — pass line", description: "A monthly performance score at or above this is considered healthy; below it triggers review.", defaultValue: "70", unit: "pts", alternatives: ["75", "80"], sources: ["210791"] },
  { key: "low_perf.review_after_days", category: "Performance & scoring", name: "Low-performance escalation window", description: "A client sitting in the Low-Performance band this long gets escalated to a strategy review.", defaultValue: "60", unit: "days", sources: ["133391", "174691"] },

  // ---- App internals (already consumed today) ----
  { key: "health.stale_days", category: "App internals", name: "Client data staleness threshold", description: "The client Health panel flags a client whose data hasn't refreshed in more than this many days.", defaultValue: "14", unit: "days", sources: ["SEOOS"] },
];

const BY_KEY = new Map(RULE_CATALOG.map((r) => [r.key, r]));
export function getRuleDef(key: string): RuleDef | undefined {
  return BY_KEY.get(key);
}
