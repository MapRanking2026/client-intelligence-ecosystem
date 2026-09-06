import type { TaskCadence, TaskPhase } from "@/src/lib/domain/prepared-task";

/** Which package scope a task applies to. */
export type TaskScope = "all" | "website" | "ai";

export interface TaskTemplate {
  key: string;
  phase: TaskPhase;
  order: number;
  title: string;
  cadence: TaskCadence;
  scope: TaskScope;
  /** Prompt key that drafts this task (AI-draftable) — omit for run/verify tasks. */
  promptKey?: string;
}

/**
 * The SEO department's task library, in workflow order. Drawn from the Playbook.
 * `scope`: all = every package; website = Dominator & Map Sense; ai = Map Sense.
 */
export const TASK_TEMPLATES: TaskTemplate[] = [
  // ---- Phase 1 · setup & quick wins (all packages) ----
  { key: "p1.dashboard", phase: "phase1", order: 10, title: "Add project to the SEO Dashboard & Rank Tracker", cadence: "once", scope: "all" },
  { key: "p1.baseline", phase: "phase1", order: 20, title: "Run 1st scans + baseline grids", cadence: "once", scope: "all" },
  { key: "p1.keywords", phase: "phase1", order: 30, title: "Keyword selection (SOP)", cadence: "once", scope: "all", promptKey: "keywords.selection" },
  { key: "p1.gbp_audit", phase: "phase1", order: 40, title: "GBP audit & 100% optimization", cadence: "once", scope: "all", promptKey: "gbp.audit" },
  { key: "p1.gbp_report", phase: "phase1", order: 50, title: "GBP Optimization Report for the Client's Book", cadence: "once", scope: "all", promptKey: "gbp.audit" },
  { key: "p1.posts_setup", phase: "phase1", order: 60, title: "Schedule 1 GBP post per grid keyword × 4 weeks", cadence: "once", scope: "all", promptKey: "gbp.post" },
  { key: "p1.ctr_booster", phase: "phase1", order: 70, title: "CTR Booster set up (Agency Assassin)", cadence: "once", scope: "all" },
  { key: "p1.qc", phase: "phase1", order: 80, title: "QC & finalization (Phase 1)", cadence: "once", scope: "all" },

  // ---- Phase 2 · website SEO (Dominator & Map Sense) ----
  { key: "p2.audit", phase: "phase2", order: 110, title: "Website audit", cadence: "once", scope: "website" },
  { key: "p2.hierarchy", phase: "phase2", order: 120, title: "Page hierarchy review & competitor analysis", cadence: "once", scope: "website" },
  { key: "p2.keyword_research", phase: "phase2", order: 130, title: "Keyword research", cadence: "once", scope: "website", promptKey: "keywords.selection" },
  { key: "p2.sitemap", phase: "phase2", order: 140, title: "Sitemap in Miro + add to Client's Book", cadence: "once", scope: "website" },
  { key: "p2.technical", phase: "phase2", order: 150, title: "Technical optimization & Core Web Vitals", cadence: "once", scope: "website" },
  { key: "p2.home", phase: "phase2", order: 160, title: "Home page content", cadence: "once", scope: "website", promptKey: "content.service_page" },
  { key: "p2.about", phase: "phase2", order: 170, title: "About Us page", cadence: "once", scope: "website", promptKey: "content.service_page" },
  { key: "p2.service_pages", phase: "phase2", order: 180, title: "Service / city pages (1–5)", cadence: "once", scope: "website", promptKey: "content.service_page" },
  { key: "p2.blog", phase: "phase2", order: 190, title: "Authority blog post", cadence: "once", scope: "ai", promptKey: "content.blog" },
  { key: "p2.qc", phase: "phase2", order: 200, title: "QC & finalization (Phase 2)", cadence: "once", scope: "website" },

  // ---- Recurring · steady state ----
  { key: "r.heatmap", phase: "recurring", order: 310, title: "Run the heatmap (before the Monthly Touch)", cadence: "monthly", scope: "all" },
  { key: "r.keyword_refresh", phase: "recurring", order: 320, title: "Refresh keyword selection", cadence: "monthly", scope: "all", promptKey: "keywords.selection" },
  { key: "r.gbp_updates", phase: "recurring", order: 330, title: "GBP services / products updates", cadence: "monthly", scope: "all", promptKey: "gbp.audit" },
  { key: "r.monthly_posts", phase: "recurring", order: 340, title: "Schedule this month's GBP posts (per grid keyword)", cadence: "monthly", scope: "all", promptKey: "gbp.post" },
  { key: "r.new_offer", phase: "recurring", order: 350, title: "Add a new GBP offer", cadence: "monthly", scope: "all", promptKey: "gbp.post" },
  { key: "r.citations", phase: "recurring", order: 360, title: "Citations", cadence: "monthly", scope: "all" },
  { key: "r.blog", phase: "recurring", order: 370, title: "Monthly authority blog post", cadence: "monthly", scope: "ai", promptKey: "content.blog" },
  { key: "r.report", phase: "recurring", order: 380, title: "Update dashboard + monthly report", cadence: "monthly", scope: "all", promptKey: "report.monthly" },
  { key: "r.weekly_photo", phase: "recurring", order: 410, title: "Add a new GBP photo (weekly)", cadence: "weekly", scope: "all" },
  { key: "r.weekly_posts", phase: "recurring", order: 420, title: "Publish & monitor scheduled GBP posts (weekly)", cadence: "weekly", scope: "all" },
  { key: "r.weekly_checkins", phase: "recurring", order: 430, title: "Map Check-Ins posts across platforms (weekly)", cadence: "weekly", scope: "all" },
  { key: "r.reviews", phase: "recurring", order: 440, title: "Respond to new reviews", cadence: "weekly", scope: "all", promptKey: "reviews.response" },
  { key: "r.daily_checkins", phase: "recurring", order: 510, title: "Map Check-Ins activity (daily)", cadence: "daily", scope: "all" },
];

export function getTaskTemplate(key: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find((t) => t.key === key);
}
