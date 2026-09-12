import type { AuthzContextV1 } from "@cie/contracts";

import type { SeoProjectV1 } from "@/src/lib/domain/project";
import { normalizePhrase } from "@/src/lib/domain/keyword";
import { getKeywordRepo } from "@/src/lib/server/repositories/keyword-repo";
import { getRuleNumber } from "@/src/lib/server/rules-service";

/**
 * Content & page plan (spec M4.3-M4.5 keyword clustering -> site architecture).
 * Deterministic (no crawl, no AI): from the tracked keywords, services, and
 * target locations SEOOS holds, propose the page structure by tier - Homepage
 * (Tier 1), Service pages (Tier 2), Location pages (Tier 3A, "one GBP = one
 * location page"), and Service+City opportunities (Tier 3B) - and surface
 * coverage gaps (services with no keyword, commercial keywords with no page).
 * Read-only; no outbound.
 */
export interface PlannedPage {
  tier: "1" | "2" | "3A" | "3B";
  type: string;
  title: string;
  keywordCount?: number;
  note?: string;
}

export interface ContentPlan {
  pages: PlannedPage[];
  gaps: string[];
  maxDepthClicks: number;
  counts: { tier1: number; tier2: number; tier3a: number; tier3b: number };
  notes: string[];
}

const COMMERCIAL_INTENTS = new Set(["commercial", "transactional", "local"]);

export async function getContentPlan(
  authz: AuthzContextV1,
  project: SeoProjectV1,
): Promise<ContentPlan> {
  const tenantId = authz.tenantId;
  const [keywords, maxDepthClicks] = await Promise.all([
    getKeywordRepo().listByProject(tenantId, project.id),
    getRuleNumber(tenantId, "architecture.max_depth_clicks", 3),
  ]);

  const services = project.services ?? [];
  const locations = project.targetLocations ?? [];
  const pages: PlannedPage[] = [];
  const gaps: string[] = [];
  const notes: string[] = [];

  // Tier 1 - Homepage (always).
  pages.push({
    tier: "1",
    type: "Homepage",
    title: project.businessName,
    note: locations.length > 1 ? "Multi-location: do not geo-target the homepage to one city" : undefined,
  });

  // Tier 2 - one Service page per service, matched to keywords by group/phrase.
  const usedKeywordIds = new Set<string>();
  const matchService = (service: string) => {
    const s = normalizePhrase(service);
    return keywords.filter((k) => {
      const g = k.group ? normalizePhrase(k.group) : "";
      const p = k.normalizedPhrase;
      const hit = g === s || p.includes(s) || s.includes(p);
      if (hit) usedKeywordIds.add(k.id);
      return hit;
    });
  };
  for (const service of services) {
    const matched = matchService(service);
    pages.push({ tier: "2", type: "Service page", title: service, keywordCount: matched.length });
    if (matched.length === 0) gaps.push(`Service "${service}" has no matching tracked keyword.`);
  }
  if (services.length === 0) {
    notes.push("No services on file — Tier-2 service pages can't be planned. Run a client sync to pull the ⭐ Services field.");
  }

  // Tier 3A - one Location page per target location.
  for (const loc of locations) {
    pages.push({ tier: "3A", type: "Location page", title: loc });
  }
  if (locations.length === 0) {
    notes.push("No target locations on file — Tier-3A location pages can't be planned.");
  }

  // Tier 3B - Service+City opportunities: commercial/local keywords that name a
  // location. Flagged as candidates (need search-volume validation before build).
  const cityTokens = locations.map((l) => normalizePhrase(l)).filter(Boolean);
  const tier3bCandidates = keywords.filter((k) => {
    if (!k.intent || !COMMERCIAL_INTENTS.has(k.intent)) return false;
    return cityTokens.some((c) => c && k.normalizedPhrase.includes(c));
  });
  for (const k of tier3bCandidates) {
    pages.push({ tier: "3B", type: "Service+City (candidate)", title: k.phrase, note: "Validate search volume before building" });
    usedKeywordIds.add(k.id);
  }

  // Coverage gap: commercial/transactional keywords not mapped to any page.
  const uncovered = keywords.filter(
    (k) => k.intent && COMMERCIAL_INTENTS.has(k.intent) && !usedKeywordIds.has(k.id),
  );
  for (const k of uncovered.slice(0, 12)) {
    gaps.push(`Keyword "${k.phrase}" (${k.intent}) has no target page yet.`);
  }

  const counts = {
    tier1: pages.filter((p) => p.tier === "1").length,
    tier2: pages.filter((p) => p.tier === "2").length,
    tier3a: pages.filter((p) => p.tier === "3A").length,
    tier3b: pages.filter((p) => p.tier === "3B").length,
  };

  if (keywords.length === 0) {
    notes.push("No tracked keywords — keyword-to-page mapping and coverage gaps can't be computed.");
  }

  return { pages, gaps, maxDepthClicks, counts, notes };
}
