import type { SeoProjectV1 } from "@/src/lib/domain/project";
import { isOutboundLocked } from "@/src/lib/server/egress-policy";

/**
 * Offboarding checklist / plan (spec M11.5-M11.18). Deterministic: assembles
 * the standard cleanup steps tailored to what the client actually has
 * (website, GBP, rank tracker, CTR, Google properties), grouped by phase.
 *
 * Governing reality: almost every offboarding step CHANGES an external system
 * (GBP phone, WordPress plugins, GSC/GA4 access) — which the outbound lock
 * blocks. So SEOOS produces and tracks the PLAN and can perform the few
 * internal steps (status, task cleanup, access revocation) itself; the external
 * steps are marked blocked while the lock is on and must be done by hand (or
 * after the lock is lifted). Read-only planning; no outbound.
 */
export interface OffboardingItem {
  group: string;
  label: string;
  /** True = changes an external system (blocked while the outbound lock is on). */
  external: boolean;
  note?: string;
}

export interface OffboardingChecklist {
  outboundLocked: boolean;
  items: OffboardingItem[];
  counts: { total: number; internal: number; externalBlocked: number };
  windingDown: boolean;
}

/** Stages that indicate the client is winding down / cancelled. */
export function isWindingDown(project: SeoProjectV1): boolean {
  return project.stage === "paused" || project.stage === "completed" || project.stage === "archived";
}

export function getOffboardingChecklist(project: SeoProjectV1): OffboardingChecklist {
  const outboundLocked = isOutboundLocked();
  const hasWebsite = Boolean(project.website);
  const svc = `${project.serviceTier ?? ""} ${(project.services ?? []).join(" ")}`.toLowerCase();
  const hasCtr = /ctr|booster|agency assassin|traffic dominator/.test(svc);
  const hasCheckins = /check-?in|map check/.test(svc) || (project.services ?? []).length > 0;

  const items: OffboardingItem[] = [];
  const add = (group: string, label: string, external: boolean, note?: string) =>
    items.push({ group, label, external, note });

  // GBP
  add("Google Business Profile", "Restore the client's real business phone on GBP; remove tracking/CRM number", true);
  add("Google Business Profile", "Remove any scheduled GBP posts", true);
  add("Google Business Profile", "Confirm archive-vs-retain decision, then remove Map Ranking's agency access (AM)", true, "Ownership/archival is an AM/leadership decision.");

  // Website
  if (hasWebsite) {
    add("Website", "Take a full site backup (pre-change) and store it in the client's Drive", true, "Evidence step — capture before touching anything.");
    add("Website", "Set the admin account to the client's email, change the password, hand off credentials", true);
    add("Website", "Remove agency plugins, licenses and API keys", true);
    add("Website", "Replace CRM number / CRM forms / Cloud Map with native equivalents", true);
    add("Website", "Clean robots.txt and remove verification tags; retain client-owned SEO plugin licenses", true);
    add("Website", "Take a final backup after cleanup", true);
  } else {
    add("Website", "No website on file — confirm there's no agency footprint to remove", false);
  }

  // Rank Tracker / CTR
  if (hasCheckins) add("Rank Tracker / Check-Ins", "Disable the heatmap schedule and remove the Map Check-Ins widget (when AM orders)", true);
  if (hasCtr) add("Rank Tracker / Check-Ins", "Disable the CTR Booster campaign (Agency Assassin AND Traffic Dominator)", true);

  // Google properties
  add("Google properties", "GSC: confirm the client is an owner, remove Map Ranking users, delete the property from the MR account", true);
  add("Google properties", "GA4: transfer or remove Map Ranking admin (or move the property for deletion)", true);

  // Closure (internal — SEOOS can do these)
  add("Closure", "Cancel and rebalance the client's active/scheduled tasks", false);
  add("Closure", "Post the cancellation notice to the project channel", true, "Outbound message — blocked while the lock is on.");
  add("Closure", "Set the project status to archived and archive its lists", false);
  add("Closure", "Revoke assignments so the client drops out of specialist views", false);

  const externalBlocked = items.filter((i) => i.external && outboundLocked).length;
  const internal = items.filter((i) => !i.external).length;

  return {
    outboundLocked,
    items,
    counts: { total: items.length, internal, externalBlocked },
    windingDown: isWindingDown(project),
  };
}
