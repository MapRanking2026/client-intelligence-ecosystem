import { z } from "zod";
import { zIsoTimestamp, zTenantId, zUserId } from "@cie/contracts";

/**
 * The Rule Library (spec module M12 "Knowledge & Rule Library"): the single
 * versioned source of truth for every numeric threshold, band, cadence and
 * config value the automation reads from — so a rule lives in ONE editable
 * place instead of hardcoded in ten. A RuleV1 is a per-tenant OVERRIDE of a
 * catalog default (mirrors the Prompt Engine: default catalog + optional
 * override, override wins, live immediately).
 *
 * Keys, defaults, conflict `alternatives`, and `sources` (ClickUp SOP page ids
 * under doc 8chvq4p-38711) are taken from Deliverable-1's M12 catalogue
 * (M12.1-M12.42). Where the SOPs genuinely disagree, the chosen value is the
 * default and every other documented value is kept in `alternatives` rather
 * than lost.
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
  /** M12 rule code (e.g. "M12.7") for traceability back to the spec. */
  code?: string;
  /** Other documented values from the SOPs, kept as alternates (conflict notes). */
  alternatives?: string[];
  /** Source SOP page id(s) under ClickUp doc 8chvq4p-38711, or a label. */
  sources?: string[];
}

/**
 * Canonical M12 rule catalogue. Keys match the spec's proposed Rule Library
 * keys verbatim so any future consumer reads the same key the spec names.
 */
export const RULE_CATALOG: RuleDef[] = [
  // ---- Grids & rankings ----
  { key: "heatmap.color_bands", code: "M12.1", category: "Grids & rankings", name: "Heatmap color bands", description: "Grid-point coloring by map-pack rank: Green = top 3 (revenue), Yellow = 4-10 (opportunity), Orange = 11-20 (vulnerability), Red = 21+ (invisible).", defaultValue: "Green<=3 | Yellow 4-10 | Orange 11-20 | Red 21+", sources: ["168291"] },
  { key: "grid.dominance.top3_count", code: "M6.1", category: "Grids & rankings", name: "Dominance - top-3 keyword count (5-keyword portfolios)", description: "Expand the grid when at least this many of the 5 tracked keywords rank in the map-pack top 3.", defaultValue: "3", unit: "keywords", sources: ["37831"] },
  { key: "grid.dominance.top3_pct", code: "M6.1", category: "Grids & rankings", name: "Dominance - top-3 percentage (larger portfolios)", description: "For portfolios larger than 5 keywords, expand when this % of tracked keywords are in the top 3.", defaultValue: "60", unit: "%", sources: ["37831"] },
  { key: "grid.initial.size", code: "M6.1", category: "Grids & rankings", name: "Initial grid size", description: "The grid size a new client's very first scan runs on.", defaultValue: "9x9", sources: ["37831"] },
  { key: "grid.initial.radius_miles", code: "M6.1", category: "Grids & rankings", name: "Initial grid radius", description: "The starting grid radius for a new client's first scan.", defaultValue: "3", unit: "miles", sources: ["37831"] },
  { key: "grid.pre_mt_verification.lead_time_days", code: "M12.25", category: "Grids & rankings", name: "Scan lead time before Monthly Touch", description: "Run/verify the grid scan this many business days before the client's Monthly Touch.", defaultValue: "2", unit: "days", alternatives: ["1 (per SOP 200851 'at least one day before')"], sources: ["200851", "37831"] },
  { key: "grid.comparison.lock_config_fields", code: "M12.25", category: "Grids & rankings", name: "Locked fields for month-over-month comparison", description: "A scan may only be compared to a prior scan when these fields are unchanged; any change makes the comparison invalid and must be flagged.", defaultValue: "keyword_set, grid_size, area", sources: ["200851", "200871"] },
  { key: "grid.scan.preferred_window", code: "M12.4", category: "Grids & rankings", name: "Preferred scan window", description: "Run scans while the business is open, preferably Mon-Wed mornings; scans while closed / on Sundays are volatile and should be tagged non-representative.", defaultValue: "Mon-Wed 9:00-12:00 local, business open", alternatives: ["day-of-week bias = hypothesis only, unconfirmed"], sources: ["90771"] },
  { key: "market_share.definition_threshold", code: "M12.2", category: "Grids & rankings", name: "Market-share headline band", description: "Which coverage band is reported as the headline market-share figure. Both are stored; consuming reports pick one.", defaultValue: "Top-3", alternatives: ["Top-5"], sources: ["167231", "168711"] },
  { key: "market_share.dominance_floor_pct", code: "M12.2", category: "Grids & rankings", name: "Market-share dominance floor", description: "Point-share at which true local dominance is considered to begin.", defaultValue: "60-70", unit: "%", sources: ["167231", "168711"] },
  { key: "expansion.min_new_site_spacing_miles", code: "M12.7", category: "Grids & rankings", name: "Multi-location minimum site spacing", description: "Minimum distance between a client's separate GBP locations when planning a multi-location expansion.", defaultValue: "10-15", unit: "miles", sources: ["269811", "291431"] },
  { key: "lab.project_tier.grid_avg_bands", code: "M12.26", category: "Grids & rankings", name: "Project performance tiers (A/B/C)", description: "Grid-average rank bands classifying a project: A = poor, B = medium, C = good. (Lab 70791; reconcile with expansion zone tiers before use.)", defaultValue: "A 12-20 | B 5-12 | C 1-5", alternatives: ["B 6-12 | C 1-6 (page's own methodology, internal inconsistency)"], sources: ["70791"] },

  // ---- Google Business Profile ----
  { key: "gbp.business_description.target_range", code: "M12.5", category: "Google Business Profile", name: "GBP business description length", description: "Target character range for the single GBP business description (hard max 750).", defaultValue: "700-720", unit: "chars", alternatives: ["250-300"], sources: ["168051", "369111"] },
  { key: "gbp.business_description.max_chars", code: "M12.5", category: "Google Business Profile", name: "GBP business description hard max", description: "Google's hard character limit for the GBP business description.", defaultValue: "750", unit: "chars", sources: ["168051"] },
  { key: "gbp.service_description.target_range", code: "M12.5", category: "Google Business Profile", name: "GBP service description length", description: "Target character range for each GBP service description (floor 250).", defaultValue: "250-300", unit: "chars", alternatives: ["300 (2.2 body)", ">=250 (2.2 DoD)"], sources: ["167931"] },
  { key: "gbp.secondary_category.max_count", code: "M12.6", category: "Google Business Profile", name: "Additional (secondary) categories cap", description: "Maximum additional GBP categories; more dilutes primary-category relevance.", defaultValue: "3", unit: "categories", alternatives: ["2 (Lab 70791 - fewer is better)"], sources: ["167731", "70831", "70791"] },
  { key: "gbp.primary_category.stagnation_window_months", code: "M12.6", category: "Google Business Profile", name: "Primary-category change stagnation window", description: "A primary-category change on stagnation grounds requires this many months of flat data first (one of 5 allowed change reasons).", defaultValue: "2-3", unit: "months", sources: ["167731"] },
  { key: "gbp.service_area.max_count", code: "M12.7", category: "Google Business Profile", name: "Service areas cap (Google limit)", description: "Google's hard limit on the number of GBP service areas.", defaultValue: "20", unit: "areas", sources: ["168031"] },
  { key: "gbp.service_area.max_drive_hours", code: "M12.7", category: "Google Business Profile", name: "Service-area drive-time ceiling (Google limit)", description: "Google's rule that service-area coverage should stay within this driving time of the business.", defaultValue: "2", unit: "hours", sources: ["168031"] },
  { key: "gbp.service_area.mr_target_radius_miles", code: "M12.7", category: "Google Business Profile", name: "Service-area target radius (policy)", description: "Map Ranking's target service-area perimeter radius from the business address.", defaultValue: "10-15", unit: "miles", alternatives: ["5-10 (SAB SOP 153071)"], sources: ["168031", "50231"] },
  { key: "gbp.service_area.warn_radius_miles", code: "M12.7", category: "Google Business Profile", name: "Service-area distance warning", description: "Flag any service area farther than this from the business as a risk.", defaultValue: "15", unit: "miles", sources: ["168031"] },
  { key: "gbp.service_area.error_radius_miles", code: "M12.7", category: "Google Business Profile", name: "Service-area distance error", description: "A service area beyond this distance is treated as a mistake, not just a warning.", defaultValue: "45", unit: "miles", sources: ["168031"] },
  { key: "gbp.hours.competitor_audit_pool_size", code: "M12.8", category: "Google Business Profile", name: "Competitor-hours audit pool", description: "Audit the top N most relevant competitors when setting hours (the '20% open' rule).", defaultValue: "20", unit: "competitors", sources: ["168151"] },
  { key: "gbp.hours.open_close_percentile", code: "M12.8", category: "Google Business Profile", name: "Competitor-hours percentile (20% rule)", description: "Set opening/closing at the time when only ~this % of competitors are already open / still open.", defaultValue: "20", unit: "%", sources: ["168151"] },
  { key: "gbp.pre_mt_readiness.completeness_pct", code: "M12.24", category: "Google Business Profile", name: "GBP completeness gate (pre-Monthly-Touch)", description: "GBP must reach this completeness before a Monthly Touch call.", defaultValue: "100", unit: "%", sources: ["200831"] },
  { key: "gbp.pre_mt_readiness.reviews_replied_pct", code: "M12.24", category: "Google Business Profile", name: "Reviews-replied gate (pre-Monthly-Touch)", description: "Share of reviews that must be replied to before a Monthly Touch call.", defaultValue: "100", unit: "%", sources: ["200831"] },

  // ---- Reviews & reputation ----
  { key: "reviews.velocity.default_monthly_target", code: "M12.9", category: "Reviews & reputation", name: "Review velocity target (org default)", description: "Org-wide monthly new-review floor; niche studies override per vertical.", defaultValue: "3-5", unit: "reviews/mo", alternatives: ["1/week", "8-15 (plumbing niche)", "5-10 (roofing niche)"], sources: ["166591", "169471"] },
  { key: "reviews.response_sla_hours", code: "M12.10", category: "Reviews & reputation", name: "Review response SLA", description: "How quickly a review should be responded to (by whoever owns the reply per the min-rating rule).", defaultValue: "24", unit: "hours", sources: ["376771", "376791"] },
  { key: "reviews.team_reply_min_rating", code: "M12.10", category: "Reviews & reputation", name: "Min rating for a team-drafted reply", description: "Map Ranking's team only drafts replies for reviews at or above this rating; lower ratings route to the client via the AM.", defaultValue: "4", unit: "stars", sources: ["112071"] },
  { key: "reviews.acquisition_channel", code: "M12.41", category: "Reviews & reputation", name: "Review acquisition channel", description: "How reviews may be requested. Never buy or incentivize reviews.", defaultValue: "Ask-a-review link / QR only; never buy", sources: ["70851"] },

  // ---- Posting & CTR ----
  { key: "posting.baseline_per_week", code: "M12.11", category: "Posting & CTR", name: "GBP post cadence (baseline)", description: "Baseline number of GBP posts per week.", defaultValue: "1", unit: "posts/week", alternatives: ["2-3 (competitive market)", "daily (experimentally supported, Lab 71031)"], sources: ["169471", "51211", "71031"] },
  { key: "posting.competitive_market_per_week", code: "M12.11", category: "Posting & CTR", name: "GBP post cadence (competitive market)", description: "Post cadence per week in a competitive market.", defaultValue: "2-3", unit: "posts/week", sources: ["169471"] },
  { key: "posting.experimental_daily_cadence.hour_local", code: "M12.29", category: "Posting & CTR", name: "Experimental daily-post hour", description: "Local hour for the experimentally-supported daily posting cadence (image + CTA to a transactional service page).", defaultValue: "9", unit: "hour (local)", sources: ["71031"] },
  { key: "ctr.daily_volume_by_gbp_age", code: "M12.12", category: "Posting & CTR", name: "CTR daily volume by GBP age", description: "Daily simulated-engagement volume banded by how long the GBP has existed. Start conservative, scale gradually.", defaultValue: "0-3mo: 8-10 | 3-12mo: 10-20 | 12mo+: 20-40", unit: "/day", sources: ["169471"] },
  { key: "ctr.initial_check_days", code: "M12.13", category: "Posting & CTR", name: "CTR campaign initial check", description: "Check a new CTR campaign this many days after launch.", defaultValue: "3", unit: "days", sources: ["169471"] },
  { key: "ctr.refresh_cadence_days", code: "M12.13", category: "Posting & CTR", name: "CTR campaign refresh cadence", description: "Refresh CTR campaign keywords from GBP Performance on this cadence.", defaultValue: "30", unit: "days", sources: ["169471"] },

  // ---- Content & on-page ----
  { key: "content.serp_analysis.top_n", code: "M12.34", category: "Content & on-page", name: "SERP analysis depth", description: "Analyze the top N organic results when planning content that ranks.", defaultValue: "3", unit: "results", sources: ["44591"] },
  { key: "content.meta_title.char_range", code: "M12.34", category: "Content & on-page", name: "Meta title length (soft)", description: "Target meta-title length including the primary keyword. Soft warning, not a hard block (per 6.5 content hierarchy).", defaultValue: "55-60", unit: "chars", sources: ["46391"] },
  { key: "content.meta_description.char_range", code: "M12.34", category: "Content & on-page", name: "Meta description length (soft)", description: "Target meta-description length with natural keyword + benefit/CTA. Soft warning, not a hard block.", defaultValue: "150-160", unit: "chars", sources: ["46391"] },
  { key: "content.heading_rules.h1_count", code: "M12.34", category: "Content & on-page", name: "H1 per page", description: "Exactly one H1 per page, containing the primary keyword.", defaultValue: "1", unit: "per page", sources: ["46391"] },
  { key: "content_qa.gbp_post.max_chars", code: "M12.37", category: "Content & on-page", name: "GBP post content cap", description: "Map Ranking's internal max length for AI-authored GBP post copy (Google's own field allows more).", defaultValue: "1500", unit: "chars", sources: ["378691"] },
  { key: "keyword_strategy.new_site_priority_sequence", code: "M12.33", category: "Content & on-page", name: "Keyword attack sequence (new sites)", description: "Order to pursue keyword difficulty tiers for a new/low-authority site.", defaultValue: "long_tail -> short_tail -> head_term", sources: ["44371"] },
  { key: "keywords.portfolio.size", code: "M2.29", category: "Content & on-page", name: "Tracked keyword portfolio size", description: "Standard number of keywords tracked on the geo-grid for a standard client.", defaultValue: "5", unit: "keywords", sources: ["291411"] },
  { key: "content_curation.gsc_opportunity_band", code: "M12.39", category: "Content & on-page", name: "Content-curation opportunity band", description: "GSC average-position range that defines curation opportunities to act on.", defaultValue: "1-20", unit: "avg position", sources: ["50211"] },

  // ---- Website & technical SEO ----
  { key: "technical.ahrefs_health_score.min_pct", code: "M12.22", category: "Website & technical SEO", name: "Ahrefs Health Score gate", description: "Site must reach this Ahrefs SEO Health Score before content execution, and hold it month to month.", defaultValue: "95", unit: "%", sources: ["174631"] },
  { key: "web.cwv.lcp_seconds", category: "Website & technical SEO", name: "Core Web Vitals - LCP (good)", description: "Largest Contentful Paint should be at or under this to pass CWV.", defaultValue: "2.5", unit: "seconds", sources: ["174251", "Google CWV"] },
  { key: "web.cwv.inp_ms", category: "Website & technical SEO", name: "Core Web Vitals - INP (good)", description: "Interaction to Next Paint should be at or under this.", defaultValue: "200", unit: "ms", sources: ["174251", "Google CWV"] },
  { key: "web.cwv.cls", category: "Website & technical SEO", name: "Core Web Vitals - CLS (good)", description: "Cumulative Layout Shift should be at or under this.", defaultValue: "0.1", sources: ["174251", "Google CWV"] },
  { key: "architecture.max_depth_clicks", code: "M12.42", category: "Website & technical SEO", name: "Max page depth from home", description: "No important page should sit more than this many clicks from the homepage.", defaultValue: "3", unit: "clicks", sources: ["44471", "44491"] },
  { key: "schema.validation.error_tolerance", code: "M12.31", category: "Website & technical SEO", name: "Schema validation tolerance", description: "Structured data must validate with zero errors; warnings are investigated, not ignored.", defaultValue: "0", unit: "errors", sources: ["174191", "37891"] },
  { key: "schema.review_recurrence_months", code: "M12.31", category: "Website & technical SEO", name: "Schema review recurrence", description: "Re-review a site's schema on this cadence.", defaultValue: "3", unit: "months", sources: ["174191"] },

  // ---- Citations & links ----
  { key: "citations.brightlocal_niche_count", code: "M5.3", category: "Citations & links", name: "BrightLocal citation set size", description: "Number of niche citations built per BrightLocal campaign (Data Axle aggregator only).", defaultValue: "10", unit: "citations", sources: ["147771"] },
  { key: "link_building.monthly_link_cap", code: "M12.38", category: "Citations & links", name: "Paid links per month", description: "Cap on purchased backlinks per month (on-page QA must pass first).", defaultValue: "1", unit: "/month", sources: ["46631"] },

  // ---- Performance & scoring ----
  { key: "scoring.tier_bands", code: "M12.19", category: "Performance & scoring", name: "Monthly score - tier bands", description: "Total-score classification: Excellent 90-100, Strong 80-89, Needs Optimization 70-79, Review Required <70.", defaultValue: "Excellent 90-100 | Strong 80-89 | Needs Opt 70-79 | Review <70", sources: ["210791", "210811"] },
  { key: "scoring.results_grid_weights", code: "M12.19", category: "Performance & scoring", name: "Results score - grid weight", description: "Grid-radius weight multiplier in the monthly Results score.", defaultValue: "3mi:10 | 5mi:15 | 7mi:20 | >7mi:23", sources: ["210791", "210811"] },
  { key: "scoring.retention_weight", code: "M12.19", category: "Performance & scoring", name: "Monthly score - Retention weight", description: "Points weight of the Retention pillar.", defaultValue: "25", unit: "pts", sources: ["210791", "210811"] },
  { key: "scoring.execution_weight", code: "M12.19", category: "Performance & scoring", name: "Monthly score - Execution weight", description: "Points weight of the Execution pillar.", defaultValue: "25", unit: "pts", sources: ["210791", "210811"] },
  { key: "scoring.results_weight", code: "M12.19", category: "Performance & scoring", name: "Monthly score - Results weight", description: "Points weight of the Results pillar.", defaultValue: "50", unit: "pts", sources: ["210791", "210811"] },
  { key: "kpi.task_execution_target_pct", code: "M12.19", category: "Performance & scoring", name: "Task Execution KPI target", description: "Weekly task-execution target for Specialists/Assistants/Strategists.", defaultValue: "95", unit: "%", sources: ["39011"] },
  { key: "kpi.monthly_gbp_performance_target_pct", code: "M12.19", category: "Performance & scoring", name: "Monthly GBP Performance KPI target", description: "Share of GBPs showing 'Good or better' ranking improvement each month.", defaultValue: "75", unit: "%", sources: ["39011"] },
  { key: "kpi.client_involvement.reduce_weight_below_pct", code: "M12.15", category: "Performance & scoring", name: "Client-involvement - reduce Results weight below", description: "When client involvement drops below this, the Results KPI weight is reduced for the pod.", defaultValue: "80", unit: "%", sources: ["174751"] },
  { key: "kpi.client_involvement.no_penalty_below_pct", code: "M12.15", category: "Performance & scoring", name: "Client-involvement - no penalty below", description: "When client involvement drops below this, the Results KPI does not penalize the pod at all.", defaultValue: "60", unit: "%", sources: ["174751"] },
  { key: "low_performance.avg_rank_band", code: "M12.14", category: "Performance & scoring", name: "Low-Performance average-rank band", description: "A Phase-1/2-complete client whose 5 tracked keywords average within this rank band (after a second scan) is classified Low Performance.", defaultValue: "5-20", sources: ["174691", "133391"] },

  // ---- SPIP & experiments ----
  { key: "spip.base_eligibility_min_score", code: "M12.20", category: "SPIP & experiments", name: "SPIP base eligibility - min monthly score", description: "Average monthly performance score required to be eligible for any SPIP bonus.", defaultValue: "85", unit: "pts", sources: ["210731"] },
  { key: "spip.quarterly_bonus_thresholds", code: "M12.20", category: "SPIP & experiments", name: "SPIP quarterly point thresholds", description: "Quarterly SPIP points needed per bonus tier.", defaultValue: "100 eligible | 150 boosted | 200+ premium", unit: "pts", sources: ["210731"] },
  { key: "experiment.eligibility_band", code: "M12.18", category: "SPIP & experiments", name: "Experiment eligibility band", description: "A project is experiment-eligible when >=4 of 5 primary keywords sit in this band, with 2-3 months of stable grid history.", defaultValue: "6-12", unit: "rank", sources: ["67971"] },
  { key: "experiment.cycle_days", code: "M10.25", category: "SPIP & experiments", name: "Lab experiment cycle", description: "A new SEO hypothesis is researched/tested on this cadence.", defaultValue: "15", unit: "days", sources: ["67971"] },

  // ---- Team operations ----
  { key: "workload.hard_cap_minutes", code: "M10.1", category: "Team operations", name: "Daily workload hard cap", description: "No team member (incl. Pod Manager) may start a day with more than this many minutes assigned.", defaultValue: "480", unit: "minutes", sources: ["112071"] },
  { key: "workload.plan_cap_minutes", code: "M10.14", category: "Team operations", name: "Friday planning cap per day", description: "Target planned minutes per day per Specialist/Assistant in the weekly plan (±10).", defaultValue: "390", unit: "minutes", sources: ["67871"] },
  { key: "reassignment.high_max_business_days", code: "M12.16", category: "Team operations", name: "High-priority task move limit", description: "A High-priority task moved more than this many business days past plan auto-escalates to Urgent.", defaultValue: "3", unit: "days", sources: ["67871"] },
  { key: "reassignment.normal_max_business_days", code: "M12.16", category: "Team operations", name: "Normal-priority task move limit", description: "A Normal-priority task moved more than this many business days past plan auto-escalates to Urgent.", defaultValue: "5", unit: "days", sources: ["67871"] },
  { key: "reassignment.low_max_business_days", code: "M12.16", category: "Team operations", name: "Low-priority task move limit", description: "A Low-priority task moved more than this many business days past plan auto-escalates to Urgent.", defaultValue: "10", unit: "days", sources: ["67871"] },
  { key: "ticket.normal_low_sla_business_days", code: "M12.16", category: "Team operations", name: "Normal/Low ticket SLA", description: "Normal/Low priority tickets must be resolved within this many business days.", defaultValue: "3", unit: "days", sources: ["67871"] },
  { key: "blocked.recheck_interval_days", code: "M10.18", category: "Team operations", name: "Blocked-task recheck interval", description: "Re-check access-blocked projects on this cadence.", defaultValue: "15", unit: "days", sources: ["67871"] },

  // ---- Grids & rankings (more) ----
  { key: "expansion.zone_tiers", code: "M12.3", category: "Grids & rankings", name: "Multi-location zone tiers", description: "Per-zone classification used in expansion analysis, by map-pack rank.", defaultValue: "Zone A top-3 | Zone B top 5-10 | Zone C top 10+", sources: ["269811", "291431"] },
  { key: "expansion.winnability_classes", code: "M12.3", category: "Grids & rankings", name: "Zone winnability classes", description: "Competitor-strength classification of a candidate expansion zone (from review count/velocity, GBP optimization, profile age, website strength, proximity).", defaultValue: "Winnable | Contestable | Saturated", sources: ["291431"] },
  { key: "grid.day_of_week_bias", code: "M12.4", category: "Grids & rankings", name: "Scan day-of-week bias (reserved)", description: "Reserved: whether the day a scan runs measurably biases results. Hypothesis only, not confirmed - log scan day-of-week so it can be applied if confirmed.", defaultValue: "unconfirmed", sources: ["90771"] },
  { key: "lab.organic_vs_grid_correlation.status", code: "M12.27", category: "Grids & rankings", name: "Organic rank vs grid correlation (reserved)", description: "Reserved: preliminary Lab observation that improving organic GSC position tends to lift grid position, minus keywords lacking local intent. No formal result.", defaultValue: "unconfirmed / hypothesis only", sources: ["94691"] },

  // ---- Google Business Profile (more) ----
  { key: "gbp.primary_category.change_allowed_reasons", code: "M12.6", category: "Google Business Profile", name: "Primary-category change allowed reasons", description: "A primary GBP category may only be changed for one of these documented reasons (never casually); change is APPROVAL-gated + client-confirmed.", defaultValue: "market demand shift; business pivot; 2-3mo stagnation; clear competitor category advantage; structured test", sources: ["167731"] },
  { key: "gbp.performance_comparison.windows", code: "M12.24", category: "Google Business Profile", name: "GBP performance comparison windows", description: "Time windows to compare GBP performance against for the Monthly Touch.", defaultValue: "MoM, YoY same-month", sources: ["200831"] },
  { key: "gbp.additional_categories.recommended_max", code: "M12.26", category: "Google Business Profile", name: "Additional categories - Lab recommended max", description: "Lab-corroborated tighter cap: <=2 additional categories correlates with better rank than more.", defaultValue: "2", unit: "categories", sources: ["70791"] },

  // ---- Reviews & reputation (more) ----
  { key: "reviews.velocity.risk_bands", code: "M12.9", category: "Reviews & reputation", name: "Review velocity risk classification", description: "Risk tiering of a client's review velocity vs competitors.", defaultValue: "Low: aligned with competitors | Medium: below but active | High: 0 in 30d OR far below competitor velocity", sources: ["169471"] },
  { key: "reviews.velocity.state_tier_overrides", code: "M12.26", category: "Reviews & reputation", name: "Review velocity - market-tier overrides", description: "Lab-derived per-market review targets that override the org default.", defaultValue: "high-competition (CA/FL/TX): 50 reviews <90 days | medium markets (AZ/MI/VA/TN): 10-20 reviews", sources: ["70791"] },
  { key: "reviews.quality_profile", code: "M12.41", category: "Reviews & reputation", name: "Ideal review profile", description: "What a high-value review looks like.", defaultValue: "Local Guide level 6-7+, long, natural transactional-keyword mention, images/video preferred", sources: ["70851"] },
  { key: "reviews.negative_escalation_ladder", code: "M12.41", category: "Reviews & reputation", name: "Negative-review escalation ladder", description: "Steps for handling an unjust negative review; step 4 is policy-risky and needs explicit approval/human judgment.", defaultValue: "1 respond politely | 2 report via Google form if unjust | 3 appeal with evidence | 4 sustained external reporting (policy-risk, APPROVAL only)", sources: ["70851"] },
  { key: "reviews.keyword_targeting.customer_facing_recommendation", code: "M12.28", category: "Reviews & reputation", name: "Keyword-in-review recommendation (customer-facing only)", description: "Safe, customer-facing tactic from a partially-valid Lab result. NEVER auto-generate team-authored reviews.", defaultValue: "prompt real customers to mention the specific service + how it resolved their problem", sources: ["93431"] },

  // ---- Posting & CTR (more) ----
  { key: "posting.experimental_daily_cadence.cta_target", code: "M12.29", category: "Posting & CTR", name: "Experimental daily-post CTA target", description: "CTA button destination for the experimentally-supported daily posting cadence.", defaultValue: "transactional service page", sources: ["71031"] },
  { key: "posting.experimental_daily_cadence.success_criteria", code: "M12.29", category: "Posting & CTR", name: "Experimental daily-post success bar", description: "Success threshold for the daily-posting experiment.", defaultValue: "avg rank +15% OR engagement +15%; >=75% of tested GBPs pass", sources: ["71031"] },

  // ---- Content & on-page (more) ----
  { key: "content.quality_boosters", code: "M12.34", category: "Content & on-page", name: "Content quality boosters (presence check)", description: "Elements that lift content quality; used as a presence check, not all required.", defaultValue: "price ranges, comparison tables, calculators, checklists, awards/guarantees, offers, real FAQs", sources: ["44591"] },
  { key: "content_curation.keyword_gap_decision_rule", code: "M12.39", category: "Content & on-page", name: "Content-curation keyword-gap decision", description: "How to treat a GSC keyword not present in a page's content.", defaultValue: "ignore (preposition/article/accent variant) | incorporate (same-intent synonym) | new_url_idea (different intent)", sources: ["50211"] },
  { key: "linking.gbp_post_rotation.target_pool", code: "M12.32", category: "Content & on-page", name: "GBP post internal-link rotation", description: "Cycle each GBP post's CTA link through every money page so all get a monthly signal.", defaultValue: "all sitemap money pages, cyclic (monthly full coverage)", sources: ["50191"] },
  { key: "linking.homepage_header_anchor.exact_keyword_forbidden", code: "M12.32", category: "Content & on-page", name: "Homepage header exact-keyword guard", description: "Whether an exact primary-keyword anchor is forbidden inside homepage H2/H3 headers. Conflicts with the 6.5 rule 'first H2 = main keyword + near me' - expose as one admin toggle.", defaultValue: "true", alternatives: ["false (6.5 Content Hierarchy: first H2 = main keyword + near me)"], sources: ["50191"] },

  // ---- Website & technical SEO (more) ----
  { key: "technical.schema_rollout.iteration_1_scope", code: "M12.22", category: "Website & technical SEO", name: "Schema rollout - iteration 1", description: "Schema types deployed in the initial technical setup.", defaultValue: "Homepage LocalBusiness only", sources: ["174631"] },
  { key: "technical.schema_rollout.iteration_2_scope", code: "M12.22", category: "Website & technical SEO", name: "Schema rollout - iteration 2 (monthly)", description: "Schema types deployed during monthly maintenance.", defaultValue: "Service, About, Location, Website, WebPage, Person, FAQ", sources: ["174631"] },
  { key: "technical.plugin_removal.requires_am_approval", code: "M12.22", category: "Website & technical SEO", name: "Plugin removal requires AM approval", description: "Report to the AM before removing any plugin.", defaultValue: "true", sources: ["174631"] },
  { key: "schema.variant_selector", code: "M12.31", category: "Website & technical SEO", name: "Schema variant selector", description: "Which LocalBusiness/Service schema variant applies, keyed to business type.", defaultValue: "storefront | sab_hybrid | multi_location", sources: ["174191"] },
  { key: "schema.mark_up_only_visible_content", code: "M12.31", category: "Website & technical SEO", name: "Schema - mark up only visible content", description: "Only mark up information actually visible on the page.", defaultValue: "true", sources: ["174191", "46411"] },
  { key: "architecture.cannibalization_definition", code: "M12.42", category: "Website & technical SEO", name: "Keyword cannibalization definition", description: "The rule defining cannibalization for the detection feature.", defaultValue: "2+ pages targeting the same search intent", sources: ["44471"] },

  // ---- Citations & links (more) ----
  { key: "citations.brightlocal_aggregator", code: "M5.3", category: "Citations & links", name: "BrightLocal aggregator", description: "Which data aggregator a BrightLocal citation campaign uses (do not select Neustar/Foursquare/YP/GPS Network).", defaultValue: "Data Axle only", sources: ["147771"] },
  { key: "citations.nap_consistency_target_pct", code: "M5.1", category: "Citations & links", name: "NAP consistency target", description: "Name/Address/Phone must match this share across all live citations before any campaign runs.", defaultValue: "100", unit: "%", sources: ["169611", "147771"] },
  { key: "citations.link_to_website", code: "M12.41", category: "Citations & links", name: "Citations link to website?", description: "Whether citation entries should link to the website (they should not - link via backlinks instead).", defaultValue: "false", sources: ["70851"] },
  { key: "citations.text_field_requirements", code: "M12.41", category: "Citations & links", name: "Citation text-field requirements", description: "What every citation's text fields must contain.", defaultValue: "exact entity name; full NAP; local transactional keywords", sources: ["70851"] },
  { key: "link_building.prerequisite_gate", code: "M12.38", category: "Citations & links", name: "Link building prerequisite", description: "Link building is the expensive last lever - on-page QA must pass first.", defaultValue: "on-page QA must pass first", sources: ["46631"] },
  { key: "link_building.target_priority_sequence", code: "M12.38", category: "Citations & links", name: "Link building target priority", description: "Order to target URLs when acquiring links.", defaultValue: "homepage -> early-ranking URLs -> highest-business-value URLs", sources: ["46631"] },

  // ---- Local SEO fundamentals ----
  { key: "local_seo.business_type_taxonomy", code: "M12.40", category: "Local SEO fundamentals", name: "Business-type taxonomy", description: "The business-type field driving service-area rules, schema variant, and CTR campaign type.", defaultValue: "physical | sab | hybrid", sources: ["50231"] },
  { key: "local_seo.proximity_target_miles", code: "M12.40", category: "Local SEO fundamentals", name: "Local proximity target", description: "Typical customer-proximity radius local SEO targets (corroborates the service-area radius policy).", defaultValue: "15", unit: "miles", sources: ["50231"] },

  // ---- Performance & scoring (more) ----
  { key: "scoring.retention_bands", code: "M12.19", category: "Performance & scoring", name: "Retention score bands", description: "Retention % to points mapping (note: the documented table tops out at 20 though the pillar is worth 25 - ceiling gap flagged in the spec).", defaultValue: ">=95:20 | 90-95:17 | 86-89:14 | 83-85:10 | 80-82:5 | <80:0", sources: ["210791"] },
  { key: "scoring.capacity_bands", code: "M12.19", category: "Performance & scoring", name: "Capacity Load score bands", description: "Capacity utilization % to points (operational efficiency modifier).", defaultValue: "<=70:1 | 71-85:3 | 86-100:5 | 101-110:6 | 111-120:7 | 121-130:8 | 131-140:9 | >140:10", sources: ["210791"] },
  { key: "scoring.execution_review_trigger_pct", code: "M10.45", category: "Performance & scoring", name: "Execution review trigger", description: "Execution below this for two consecutive weeks triggers a performance review.", defaultValue: "90", unit: "%", sources: ["210791", "210811"] },
  { key: "scoring.audit_trigger_delta_pts", code: "M10.43", category: "Performance & scoring", name: "Scoring audit trigger (score jump)", description: "A month-over-month total-score increase greater than this triggers an audit.", defaultValue: "15", unit: "pts", sources: ["210811"] },
  { key: "scoring.error_recalc_hours", code: "M10.43", category: "Performance & scoring", name: "Scoring error recalculation window", description: "An invalidated score must be recalculated within this window.", defaultValue: "48", unit: "hours", sources: ["210811"] },

  // ---- SPIP & experiments (more) ----
  { key: "spip.bonus_fixed_range", code: "M12.20", category: "SPIP & experiments", name: "SPIP fixed quarterly bonus range", description: "Fixed quarterly bonus range (Option A); Leadership chooses fixed/percentage/hybrid per case.", defaultValue: "500-1500", unit: "USD", sources: ["210731"] },
  { key: "experiment.success_formula", code: "M12.18", category: "SPIP & experiments", name: "Experiment success formula", description: "When a controlled experiment counts as successful.", defaultValue: ">=50% of >=7th-ranked grid points improve >=3 positions; OR 5th/6th-ranked primary keywords reach top 3", sources: ["67971"] },
  { key: "experiment.monthly_quota_per_pod", code: "M10.31", category: "SPIP & experiments", name: "Experiments per pod per month", description: "Minimum controlled experiments each pod must run monthly.", defaultValue: "1", unit: "/month", sources: ["67971"] },

  // ---- Spam & compliance ----
  { key: "spam.check_cadence", code: "M12.17", category: "Spam & compliance", name: "Competitor spam-check cadence", description: "How often to run the competitor spam-fighting review. Cadence undocumented; defaults to monthly (its position in the recurring-tasks list).", defaultValue: "monthly", alternatives: ["every 3 months"], sources: ["8491", "51211"] },
  { key: "spam.mechanism_status", code: "M12.17", category: "Spam & compliance", name: "Spam-fighting mechanism status", description: "Known-status flag: the underlying spam-report mechanism may be non-functional and the SOP needs updating.", defaultValue: "known broken per Lab 43311 - Google not accepting recommendations; SOP needs update", sources: ["43311"] },
  { key: "content_qa.social_post.max_chars_by_platform", code: "M12.37", category: "Spam & compliance", name: "Social post length caps by platform", description: "Per-platform character limits when a check-in/post syndicates to social.", defaultValue: "Instagram 2200 | YouTube 5000 | TikTok 4000 | Facebook unlimited", sources: ["378691"] },
  { key: "content_qa.post_description.forbid_phone_or_personal_name", code: "M12.37", category: "Spam & compliance", name: "Forbid phone/personal name in post copy", description: "Never put phone numbers or personal names in post descriptions (flag risk); use the CTA phone field instead.", defaultValue: "true", sources: ["378691"] },

  // ---- Services catalog (GAP - video-only definitions) ----
  { key: "service_catalog.definition_status", code: "M12.35", category: "Services catalog", name: "Service definitions status", description: "The 6 Services-Module service definitions (Map Pack Dominator, Map Sense, CTR Booster, Map Check-Ins, Local Growth Engine, Map Booster/Top Service Booster) exist only as videos - scope undocumented in text.", defaultValue: "undocumented - video only, needs transcription", sources: ["104931", "104951", "104971", "105011", "105051", "106891"] },

  // ---- Client touch pattern ----
  { key: "pattern.audit_before_touch", code: "M12.36", category: "Client lifecycle", name: "Audit before every client touch", description: "Reusable pattern: audit the account state before any client touch (Monthly Touch, follow-up, etc.).", defaultValue: "true", sources: ["378531"] },

  // ---- App internals (SEOOS-specific, consumed today) ----
  { key: "health.stale_days", category: "App internals", name: "Client data staleness threshold", description: "The client Health panel flags a client whose data hasn't refreshed in more than this many days.", defaultValue: "14", unit: "days", sources: ["SEOOS"] },
];

const BY_KEY = new Map(RULE_CATALOG.map((r) => [r.key, r]));
export function getRuleDef(key: string): RuleDef | undefined {
  return BY_KEY.get(key);
}
