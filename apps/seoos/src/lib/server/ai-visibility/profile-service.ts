import { z } from "zod";

import { newId, nowIso } from "@/src/lib/ids";
import type { SeoProjectV1 } from "@/src/lib/domain/project";
import {
  AivCompetitor,
  AivLocation,
  AivProfileV1,
  ProviderId,
  ReviewedValue,
  ScanFrequency,
} from "@/src/lib/ai-visibility/types";
import { aliasWarnings } from "@/src/lib/ai-visibility/prompts";
import { normalizeDomain } from "@/src/lib/ai-visibility/url";
import { normPhrase, stateCode } from "@/src/lib/ai-visibility/text";
import { suggestFromHtml, type WebsiteSuggestions } from "@/src/lib/ai-visibility/website-suggest";
import { audit } from "./audit";
import { safeFetchHtml } from "./safe-fetch";
import { profiles } from "./store";

/**
 * Client onboarding. Identity (name, website) is seeded from the SEOOS project
 * (canonical CIE client) — never re-entered as a second source of truth.
 * Website extraction only ever adds `suggested` items; measurement uses
 * `approved` items exclusively.
 */

export async function getProfile(tenantId: string, projectId: string): Promise<AivProfileV1 | null> {
  return profiles().get(tenantId, projectId);
}

export async function listProfiles(tenantId: string): Promise<AivProfileV1[]> {
  return profiles().list(tenantId);
}

function rv(value: string, source: ReviewedValue["source"], status: ReviewedValue["status"], extra: Partial<ReviewedValue> = {}): ReviewedValue {
  return { id: newId("v"), value: value.trim(), source, status, ...extra };
}

export async function initProfile(project: SeoProjectV1, actor: string): Promise<AivProfileV1> {
  const existing = await getProfile(project.tenantId, project.id);
  if (existing) return existing;
  const now = nowIso();
  const domain = project.website ? normalizeDomain(project.website) : "";
  const profile = AivProfileV1.parse({
    schemaVersion: 1,
    tenantId: project.tenantId,
    projectId: project.id,
    clientId: project.clientId,
    status: "draft",
    businessName: project.businessName,
    ownedDomains: domain ? [rv(domain, "cie", "approved")] : [],
    // Project target locations are free text from the roster: suggestions only.
    locations: project.targetLocations
      .map((t) => t.match(/^\s*([^,]+?)\s*,\s*([A-Za-z .]+)\s*$/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => ({ id: newId("loc"), city: m[1], region: stateCode(m[2]) || m[2].trim(), country: "US", zipCodes: [], neighborhoods: [], status: "suggested", source: "cie" })),
    categories: project.niche ? [rv(project.niche, "cie", "suggested")] : [],
    createdAt: now,
    updatedAt: now,
    updatedBy: actor,
  });
  await profiles().set(project.tenantId, project.id, profile);
  await audit(project.tenantId, actor, "profile.create", { projectId: project.id });
  return profile;
}

export const ProfilePatch = z
  .object({
    businessName: z.string().min(1).max(200),
    aliases: z.array(ReviewedValue),
    ownedDomains: z.array(ReviewedValue),
    gbpUrl: z.string().max(500).optional(),
    placeId: z.string().max(200).optional(),
    primaryLocationId: z.string().optional(),
    timezone: z.string().max(64),
    language: z.string().max(12),
    isServiceAreaBusiness: z.boolean(),
    publicAddress: z.string().max(300).optional(),
    services: z.array(ReviewedValue),
    categories: z.array(ReviewedValue),
    locations: z.array(AivLocation),
    competitors: z.array(AivCompetitor),
    providerIds: z.array(ProviderId),
    scanFrequency: ScanFrequency,
    repetitions: z.number().int().min(1).max(10),
    monthlyBudgetUsd: z.number().min(0).max(10000),
    perScanBudgetUsd: z.number().min(0).max(5000),
    bilingualLanguage: z.string().max(12).optional(),
  })
  .partial();
export type ProfilePatch = z.infer<typeof ProfilePatch>;

function normalizeLists(p: AivProfileV1): AivProfileV1 {
  const dedupe = <T extends { value: string }>(xs: T[]) => {
    const seen = new Set<string>();
    return xs.filter((x) => {
      const k = normPhrase(x.value).join(" ");
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return {
    ...p,
    aliases: dedupe(p.aliases),
    services: dedupe(p.services),
    categories: dedupe(p.categories),
    ownedDomains: dedupe(p.ownedDomains.map((d) => ({ ...d, value: normalizeDomain(d.value) || d.value }))),
    competitors: p.competitors.map((c) => ({ ...c, domains: c.domains.map((d) => normalizeDomain(d) || d).filter(Boolean) })),
    locations: p.locations.map((l) => ({ ...l, region: stateCode(l.region) || l.region })),
  };
}

export async function updateProfile(tenantId: string, projectId: string, patch: ProfilePatch, actor: string): Promise<AivProfileV1> {
  const parsed = ProfilePatch.parse(patch);
  const cur = await getProfile(tenantId, projectId);
  if (!cur) throw new Error("Profile not found — open onboarding first");
  const next = normalizeLists(
    AivProfileV1.parse({ ...cur, ...parsed, version: cur.version + 1, updatedAt: nowIso(), updatedBy: actor }),
  );
  if (next.primaryLocationId && !next.locations.some((l) => l.id === next.primaryLocationId)) next.primaryLocationId = undefined;
  await profiles().set(tenantId, projectId, next);
  await audit(tenantId, actor, "profile.update", { projectId, detail: { changed: Object.keys(parsed), version: next.version } });
  return next;
}

export interface ActivationCheck {
  ok: boolean;
  problems: string[];
  warnings: string[];
}

export function activationCheck(p: AivProfileV1): ActivationCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!p.businessName.trim()) problems.push("Business name is required.");
  if (!p.services.some((s) => s.status === "approved")) problems.push("Approve at least one service.");
  if (!p.locations.some((l) => l.status === "approved")) problems.push("Approve at least one location.");
  const pending = [...p.services, ...p.aliases, ...p.categories, ...p.ownedDomains].filter((x) => x.status === "suggested").length +
    p.locations.filter((l) => l.status === "suggested").length;
  if (pending) warnings.push(`${pending} suggested item(s) are still unreviewed and will be ignored until approved.`);
  for (const w of aliasWarnings(p.aliases.filter((a) => a.status === "approved"))) warnings.push(w.warning);
  if (!p.ownedDomains.some((d) => d.status === "approved")) warnings.push("No approved owned domain — owned-domain citation rate will be 0 by definition.");
  if (!p.providerIds.length) warnings.push("No provider selected — choose at least one before running a scan.");
  return { ok: problems.length === 0, problems, warnings };
}

export async function setProfileStatus(tenantId: string, projectId: string, status: "active" | "paused" | "draft", actor: string) {
  const cur = await getProfile(tenantId, projectId);
  if (!cur) throw new Error("Profile not found");
  if (status === "active") {
    const chk = activationCheck(cur);
    if (!chk.ok) throw new Error(`Cannot activate: ${chk.problems.join(" ")}`);
  }
  const next = { ...cur, status, updatedAt: nowIso(), updatedBy: actor, ...(status === "active" ? { activatedAt: nowIso(), activatedBy: actor } : {}) };
  await profiles().set(tenantId, projectId, AivProfileV1.parse(next));
  await audit(tenantId, actor, `profile.${status}`, { projectId });
  return next;
}

/**
 * Fetch the client website (SSRF-guarded) and merge SUGGESTIONS into the
 * profile. Existing approved/rejected items are never overwritten.
 */
export async function suggestFromWebsite(tenantId: string, projectId: string, url: string, actor: string): Promise<{ profile: AivProfileV1; suggestions: WebsiteSuggestions }> {
  const cur = await getProfile(tenantId, projectId);
  if (!cur) throw new Error("Profile not found");
  const { finalUrl, html } = await safeFetchHtml(url);
  const s = suggestFromHtml(html, finalUrl);
  const has = (xs: Array<{ value: string }>, v: string) => xs.some((x) => normPhrase(x.value).join(" ") === normPhrase(v).join(" "));
  const next: AivProfileV1 = { ...cur };
  for (const n of s.names) {
    if (normPhrase(n.value).join(" ") === normPhrase(cur.businessName).join(" ") || has(next.aliases, n.value)) continue;
    next.aliases = [...next.aliases, rv(n.value, "website_extraction", "suggested", { sourceUrl: finalUrl, evidence: n.evidence })];
  }
  for (const sv of s.services) {
    if (has(next.services, sv.value)) continue;
    next.services = [...next.services, rv(sv.value, "website_extraction", "suggested", { sourceUrl: finalUrl, evidence: sv.evidence })];
  }
  for (const l of s.locations) {
    if (next.locations.some((x) => normPhrase(x.city).join(" ") === normPhrase(l.city).join(" ") && (stateCode(x.region) || x.region) === (stateCode(l.region) || l.region))) continue;
    next.locations = [
      ...next.locations,
      { id: newId("loc"), city: l.city, region: stateCode(l.region) || l.region, country: "US", zipCodes: [], neighborhoods: [], status: "suggested", source: "website_extraction", sourceUrl: finalUrl, evidence: l.evidence.slice(0, 400) },
    ];
  }
  const dom = normalizeDomain(finalUrl);
  if (dom && !next.ownedDomains.some((d) => normalizeDomain(d.value) === dom)) {
    next.ownedDomains = [...next.ownedDomains, rv(dom, "website_extraction", "suggested", { sourceUrl: finalUrl, evidence: "Fetched site host" })];
  }
  next.lastSuggestionAt = nowIso();
  next.updatedAt = nowIso();
  next.updatedBy = actor;
  const saved = AivProfileV1.parse(next);
  await profiles().set(tenantId, projectId, saved);
  await audit(tenantId, actor, "profile.suggest_from_website", {
    projectId,
    detail: { url: finalUrl, names: s.names.length, services: s.services.length, locations: s.locations.length },
  });
  return { profile: saved, suggestions: s };
}
