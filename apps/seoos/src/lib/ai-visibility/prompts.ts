import type { AivLocation, AivProfileV1, PromptGroup, ReviewedValue } from "./types";
import { findPhrase, nameVariants, tokenize } from "./text";
import { normalizeDomain } from "./url";

/**
 * Prompt generation + guard rails. Templates are industry-neutral and filled
 * only from APPROVED services and locations. Unbranded prompts are checked so
 * they never contain the client's name/aliases/domains or competitor names.
 */

export interface PromptDraft {
  group: PromptGroup;
  text: string;
  language: string;
  serviceId?: string;
  serviceLabel?: string;
  locationId?: string;
  nearMe: boolean;
  templateKey: string;
}

export function locationLabel(l: Pick<AivLocation, "city" | "region">): string {
  return l.region ? `${l.city}, ${l.region}` : l.city;
}

const T = {
  unbranded_discovery: [
    { key: "disc.reliable", t: "Who offers reliable {service} in {loc}?" },
    { key: "disc.best", t: "What are the best {service} companies in {loc}?" },
    { key: "disc.consider", t: "I need {service} in {loc}. Which local companies should I consider?" },
  ],
  service_intent: [
    { key: "intent.soon", t: "I need {service} in {loc} this week. Who can I call?" },
    { key: "intent.quote", t: "Where can I get a quote for {service} in {loc}?" },
  ],
  comparison: [
    { key: "cmp.reputable", t: "Compare local {service} providers in {loc}. Which ones are the most reputable?" },
  ],
  branded: [
    { key: "brand.reviews", t: "What do customers say about {brand} in {loc}?" },
    { key: "brand.good", t: "Is {brand} a good choice for {service} in {loc}?" },
  ],
  bilingual_es: [{ key: "es.reliable", t: "¿Quién ofrece {service} confiable en {loc}?" }],
  near_me: [{ key: "near.reliable", t: "Who offers reliable {service} near me?" }],
} as const;

/** Lowercase service words for natural phrasing, keeping acronyms ("HVAC"). */
export function serviceText(v: string): string {
  return v
    .split(/(\s+|-)/)
    .map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()))
    .join("");
}

function fill(t: string, vars: Record<string, string>): string {
  return t.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

const approved = <V extends { status: string }>(xs: V[]) => xs.filter((x) => x.status === "approved");

export interface GenerateOptions {
  groups: PromptGroup[];
  includeNearMe: boolean;
  /** Cap per group (default 10 for unbranded discovery pilot). */
  maxPerGroup?: number;
  locationIds?: string[];
}

export function generatePromptDrafts(profile: AivProfileV1, opts: GenerateOptions): PromptDraft[] {
  const services = approved(profile.services);
  const locations = approved(profile.locations).filter((l) => !opts.locationIds?.length || opts.locationIds.includes(l.id));
  const out: PromptDraft[] = [];
  const cap = opts.maxPerGroup ?? 10;
  const lang = profile.language || "en";

  const pushGroup = (group: PromptGroup, templates: ReadonlyArray<{ key: string; t: string }>, extra: Partial<PromptDraft> = {}) => {
    let n = 0;
    // Spread across services first so 10 prompts cover more services.
    for (const tpl of templates) {
      for (const loc of locations) {
        for (const svc of services) {
          if (n >= cap) return;
          const text = fill(tpl.t, { service: serviceText(svc.value), loc: locationLabel(loc), brand: profile.businessName });
          if (out.some((d) => d.text === text)) continue;
          out.push({ group, text, language: lang, serviceId: svc.id, serviceLabel: svc.value, locationId: loc.id, nearMe: false, templateKey: tpl.key, ...extra });
          n += 1;
        }
      }
    }
  };

  for (const g of opts.groups) {
    if (g === "bilingual") {
      if (profile.bilingualLanguage === "es") pushGroup("bilingual", T.bilingual_es, { language: "es" });
      continue;
    }
    pushGroup(g, T[g]);
  }
  if (opts.includeNearMe) {
    for (const svc of services.slice(0, cap)) {
      out.push({
        group: "unbranded_discovery",
        text: fill(T.near_me[0].t, { service: serviceText(svc.value) }),
        language: lang,
        serviceId: svc.id,
        serviceLabel: svc.value,
        // The location used for the provider location control is chosen at scan time.
        locationId: locations[0]?.id,
        nearMe: true,
        templateKey: T.near_me[0].key,
      });
    }
  }
  return out;
}

export interface PromptCheck {
  ok: boolean;
  problems: string[];
}

function containsAny(text: string, phrases: string[]): string[] {
  const toks = tokenize(text);
  const hits: string[] = [];
  for (const p of phrases) {
    for (const v of nameVariants(p)) {
      if (findPhrase(toks, v).length) {
        hits.push(p);
        break;
      }
    }
  }
  return hits;
}

/**
 * Validate a prompt for its group. Unbranded prompts must not name the client,
 * its aliases or domains, nor any configured competitor, and must not include
 * hints that steer toward the client.
 */
export function checkPrompt(text: string, group: PromptGroup, profile: AivProfileV1): PromptCheck {
  const problems: string[] = [];
  const trimmed = text.trim();
  if (trimmed.length < 8) problems.push("Prompt is too short.");
  if (trimmed.length > 600) problems.push("Prompt is too long (600 characters max).");
  const clientNames = [profile.businessName, ...profile.aliases.filter((a) => a.status !== "rejected").map((a) => a.value)];
  const domains = profile.ownedDomains.map((d) => normalizeDomain(d.value)).filter(Boolean);
  const compNames = profile.competitors.flatMap((c) => [c.name, ...c.aliases]);
  const compDomains = profile.competitors.flatMap((c) => c.domains.map(normalizeDomain)).filter(Boolean);
  const lower = trimmed.toLowerCase();

  if (group !== "branded") {
    const hit = containsAny(trimmed, clientNames);
    if (hit.length) problems.push(`Unbranded prompt names the client (${hit.join(", ")}).`);
    for (const d of domains) if (lower.includes(d)) problems.push(`Unbranded prompt contains the client domain (${d}).`);
    if (/\b(include|mention|such as|like)\b[^.?]*\b(my|our)\b/i.test(trimmed)) problems.push("Prompt contains a steering hint (\"such as our/my …\").");
  } else {
    const hit = containsAny(trimmed, clientNames);
    if (!hit.length) problems.push("Branded prompts must name the client.");
  }
  const compHit = containsAny(trimmed, compNames);
  if (compHit.length) problems.push(`Measurement prompts must not include the competitor list (${compHit.join(", ")}).`);
  for (const d of compDomains) if (lower.includes(d)) problems.push(`Prompt contains a competitor domain (${d}).`);
  if (/https?:\/\//i.test(trimmed)) problems.push("Prompts must not contain URLs.");
  return { ok: problems.length === 0, problems };
}

export function isNearMe(text: string): boolean {
  return /\bnear (me|by)\b|\bcerca de m[ií]\b|\bclose to me\b|\baround me\b/i.test(text);
}

/** Generic aliases match other businesses; flag them during onboarding review. */
export function aliasWarnings(aliases: ReviewedValue[]): Array<{ id: string; warning: string }> {
  return aliases
    .filter((a) => nameVariants(a.value).length === 0)
    .map((a) => ({ id: a.id, warning: `"${a.value}" is too generic to identify the business and will be ignored by detection.` }));
}
