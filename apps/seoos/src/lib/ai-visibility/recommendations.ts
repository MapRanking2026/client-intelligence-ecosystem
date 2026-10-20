import type { AivObservationV1, AivProfileV1 } from "./types";
import { effectiveEntities, validity } from "./effective";
import { hostMatchesDomain, normalizeDomain } from "./url";
import { stableHash } from "./util";

/**
 * Evidence-based recommendations. Each one separates the OBSERVED gap (facts
 * from stored observations) from the PROPOSED action (a hypothesis). None of
 * the actions is claimed to guarantee AI inclusion. Website-audit findings are
 * intentionally not mixed in here.
 */

export interface AivRecommendation {
  id: string;
  rule: string;
  title: string;
  observedGap: string;
  evidenceObsIds: string[];
  sourceLinks: string[];
  proposedAction: string;
  actionIsHypothesis: boolean;
  priority: "high" | "medium" | "low";
  priorityReason: string;
  confidence: "high" | "medium" | "low";
  limitations: string[];
}

const DIRECTORY_HINT = /(yelp|angi|angieslist|homeadvisor|thumbtack|bbb\.org|nextdoor|houzz|porch|google\.com\/maps|facebook|yellowpages|superpages|manta|mapquest|bark\.com|expertise\.com|threebestrated|avvo|justia|findlaw|lawyers\.com|martindale|nolo|superlawyers|networx|fixr|reddit|tripadvisor|indeed)/i;

function confidenceFor(n: number): AivRecommendation["confidence"] {
  return n >= 15 ? "high" : n >= 6 ? "medium" : "low";
}

const BASE_LIMITS = [
  "AI answers vary with time, model, search behavior, location support and personalization; these are samples, not complete coverage.",
  "Official-API results are not identical to consumer apps (ChatGPT, Claude.ai, Gemini app, Google AI Overviews).",
];

export function buildRecommendations(all: AivObservationV1[], profile: AivProfileV1): AivRecommendation[] {
  const live = all.filter((o) => !o.isFixture && o.channel === "official_api");
  const valid = live.filter((o) => validity(o) === "valid");
  const unbranded = valid.filter((o) => !o.branded);
  const out: AivRecommendation[] = [];
  const small = unbranded.length < 30 ? ["Small sample (fewer than 30 valid unbranded answers) — treat as directional only."] : [];
  const svcName = (id?: string) => profile.services.find((s) => s.id === id)?.value ?? "(unspecified service)";
  const locName = (id?: string) => {
    const l = profile.locations.find((x) => x.id === id);
    return l ? `${l.city}${l.region ? `, ${l.region}` : ""}` : "(unspecified location)";
  };
  const ownedDomains = profile.ownedDomains.filter((d) => d.status === "approved").map((d) => normalizeDomain(d.value));
  const competitorDomains = profile.competitors.flatMap((c) => c.domains.map(normalizeDomain));

  // R1 — service × location visibility gaps.
  const groups = new Map<string, AivObservationV1[]>();
  for (const o of unbranded) {
    const k = `${o.serviceId ?? ""}|${o.locationId ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  for (const [k, os] of groups) {
    if (os.length < 3) continue;
    const mentioned = os.filter((o) => effectiveEntities(o).find((e) => e.entityKey === "client")?.mentioned);
    const othersRec = os.filter((o) => effectiveEntities(o).some((e) => e.entityKey !== "client" && e.recommended));
    const rate = mentioned.length / os.length;
    if (rate >= 0.2 || othersRec.length / os.length < 0.5) continue;
    const [sid, lid] = k.split("|");
    out.push({
      id: `rec_${stableHash(`R1|${k}`, 12)}`,
      rule: "service_location_gap",
      title: `Low AI visibility for ${svcName(sid)} in ${locName(lid)}`,
      observedGap: `The client was mentioned in ${mentioned.length} of ${os.length} valid unbranded answers for this service and location, while other businesses were recommended in ${othersRec.length}.`,
      evidenceObsIds: os.map((o) => o.id),
      sourceLinks: [],
      proposedAction: `Check whether the website has a dedicated, crawlable page that clearly states ${svcName(sid)} in ${locName(lid)} (service, area served, proof such as reviews/projects), and that the Google Business Profile lists this service. Re-measure after changes.`,
      actionIsHypothesis: true,
      priority: rate === 0 && os.length >= 6 ? "high" : "medium",
      priorityReason: rate === 0 ? "Zero mentions while competitors are recommended" : "Mentioned in under 20% of answers",
      confidence: confidenceFor(os.length),
      limitations: [...BASE_LIMITS, ...small, "This finding does not verify the website's content; run the Website Audit separately."],
    });
  }

  // R2 — third-party domains cited where competitors win and the client is absent.
  const domainHits = new Map<string, { obs: Set<string>; urls: Set<string> }>();
  for (const o of unbranded) {
    const ents = effectiveEntities(o);
    const clientIn = ents.find((e) => e.entityKey === "client")?.mentioned;
    const othersIn = ents.some((e) => e.entityKey !== "client" && e.mentioned);
    if (clientIn || !othersIn) continue;
    for (const c of o.citations) {
      if (ownedDomains.some((d) => hostMatchesDomain(c.domain, d)) || competitorDomains.some((d) => hostMatchesDomain(c.domain, d))) continue;
      const row = domainHits.get(c.domain) ?? { obs: new Set(), urls: new Set() };
      row.obs.add(o.id);
      row.urls.add(c.url);
      domainHits.set(c.domain, row);
    }
  }
  // A discovered business's own website (e.g. acmecleaning.com for "Acme Cleaning") is a competitor
  // site, not a third-party source the client could appear on — R3 covers those pages.
  const discoveredSlugs = new Set(
    unbranded.flatMap((o) => effectiveEntities(o).filter((e) => e.kind !== "client").map((e) => e.name.toLowerCase().replace(/[^a-z0-9]/g, ""))).filter((x) => x.length >= 5),
  );
  const isCompetitorSite = (domain: string) => {
    const label = domain.split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");
    return [...discoveredSlugs].some((slug) => label.includes(slug.slice(0, Math.min(slug.length, 12))) || (label.length >= 8 && slug.includes(label)));
  };
  for (const [domain, row] of [...domainHits].filter(([d]) => !isCompetitorSite(d)).sort((a, b) => b[1].obs.size - a[1].obs.size).slice(0, 6)) {
    if (row.obs.size < 2) continue;
    const isDir = DIRECTORY_HINT.test(domain);
    out.push({
      id: `rec_${stableHash(`R2|${domain}`, 12)}`,
      rule: "cited_third_party_source",
      title: `${domain} is frequently cited in answers that omit the client`,
      observedGap: `${domain} was cited in ${row.obs.size} valid unbranded answers that recommended other businesses but did not mention the client.`,
      evidenceObsIds: [...row.obs],
      sourceLinks: [...row.urls].slice(0, 8),
      proposedAction: isDir
        ? `Verify the client has an accurate, claimed profile on ${domain} (name, categories, service area, reviews). If absent or inaccurate, consider creating/correcting it.`
        : `Review the cited ${domain} pages to understand why they are used as sources and whether the client could be accurately included (e.g., local roundups, associations, press).`,
      actionIsHypothesis: true,
      priority: row.obs.size >= 4 ? "high" : "medium",
      priorityReason: `Cited in ${row.obs.size} answers where the client was absent`,
      confidence: confidenceFor(row.obs.size),
      limitations: [...BASE_LIMITS, ...small, "Being listed on a cited site does not guarantee the AI will mention the client."],
    });
  }

  // R3 — specific pages repeatedly supporting a competitor.
  const support = new Map<string, { name: string; obs: Set<string> }>();
  for (const o of unbranded) {
    for (const e of effectiveEntities(o)) {
      if (e.entityKey === "client" || !e.recommended) continue;
      for (const url of e.thirdPartyCitationUrls) {
        const key = `${e.entityKey}|${url}`;
        const row = support.get(key) ?? { name: e.name, obs: new Set() };
        row.obs.add(o.id);
        support.set(key, row);
      }
    }
  }
  for (const [key, row] of [...support].sort((a, b) => b[1].obs.size - a[1].obs.size).slice(0, 5)) {
    if (row.obs.size < 2) continue;
    const url = key.split("|").slice(1).join("|");
    out.push({
      id: `rec_${stableHash(`R3|${key}`, 12)}`,
      rule: "source_supporting_competitor",
      title: `A source repeatedly supports ${row.name}`,
      observedGap: `${url} was attached to recommendations of ${row.name} in ${row.obs.size} answers.`,
      evidenceObsIds: [...row.obs],
      sourceLinks: [url],
      proposedAction: `Review this page: what it says about ${row.name}, whether the client is covered, and whether there is a legitimate way to be included or to publish comparable proof on the client's own site.`,
      actionIsHypothesis: true,
      priority: "medium",
      priorityReason: "Recurring citation tied to a competitor",
      confidence: confidenceFor(row.obs.size),
      limitations: [...BASE_LIMITS, ...small],
    });
  }

  // R4 — negative or ambiguous statements about the client (branded or unbranded).
  const neg = valid.filter((o) => {
    const c = effectiveEntities(o).find((e) => e.entityKey === "client");
    return c?.mentioned && (c.sentiment === "negative" || c.sentiment === "ambiguous");
  });
  if (neg.length) {
    const negative = neg.filter((o) => effectiveEntities(o).find((e) => e.entityKey === "client")?.sentiment === "negative").length;
    out.push({
      id: `rec_${stableHash("R4", 12)}`,
      rule: "negative_or_ambiguous_mentions",
      title: "AI answers contain negative or uncertain statements about the client",
      observedGap: `${neg.length} valid answers described the client negatively (${negative}) or with hedged/uncertain language (${neg.length - negative}).`,
      evidenceObsIds: neg.map((o) => o.id),
      sourceLinks: [...new Set(neg.flatMap((o) => effectiveEntities(o).find((e) => e.entityKey === "client")?.thirdPartyCitationUrls ?? []))].slice(0, 8),
      proposedAction: "Read each answer and its cited sources. Correct inaccurate facts at the source (profiles, directories, own site) and address genuine review issues. Do not dispute accurate information.",
      actionIsHypothesis: false,
      priority: negative ? "high" : "medium",
      priorityReason: negative ? "Negative statements can deter buyers" : "Uncertain statements may reduce recommendations",
      confidence: confidenceFor(neg.length),
      limitations: [...BASE_LIMITS, "Sentiment is detected with keyword rules; verify each case (manual corrections are audited)."],
    });
  }

  // R5 — name confusion with businesses elsewhere.
  const conflict = live.filter((o) => effectiveEntities(o).some((e) => e.entityKey === "client" && e.locationConflict));
  if (conflict.length) {
    out.push({
      id: `rec_${stableHash("R5", 12)}`,
      rule: "name_confusion",
      title: "Similarly named businesses elsewhere appear in answers",
      observedGap: `${conflict.length} answers matched the client's name but placed it in another state; these were not counted as client mentions.`,
      evidenceObsIds: conflict.map((o) => o.id),
      sourceLinks: [],
      proposedAction: "Confirm these are different businesses (correct manually if not). Make location signals explicit and consistent (city/area on the site, GBP, directories) so the client can be distinguished.",
      actionIsHypothesis: true,
      priority: "low",
      priorityReason: "Affects accuracy of detection and possibly of AI answers",
      confidence: "medium",
      limitations: BASE_LIMITS,
    });
  }

  // R6 — mentioned but own site never cited.
  const mentionedObs = unbranded.filter((o) => effectiveEntities(o).find((e) => e.entityKey === "client")?.mentioned);
  const citedOwn = mentionedObs.filter((o) => effectiveEntities(o).find((e) => e.entityKey === "client")?.ownedDomainCited);
  if (mentionedObs.length >= 3 && citedOwn.length === 0 && ownedDomains.length) {
    out.push({
      id: `rec_${stableHash("R6", 12)}`,
      rule: "owned_site_not_cited",
      title: "The client is mentioned but its own website is never cited",
      observedGap: `In ${mentionedObs.length} answers mentioning the client, none cited ${ownedDomains.join(", ")}.`,
      evidenceObsIds: mentionedObs.map((o) => o.id),
      sourceLinks: [],
      proposedAction: "Check that key service/location pages are indexable and state facts plainly (services, areas, credentials you can verify). Third-party sources currently carry the client's mentions.",
      actionIsHypothesis: true,
      priority: "low",
      priorityReason: "Opportunity to control the facts AI cites",
      confidence: confidenceFor(mentionedObs.length),
      limitations: [...BASE_LIMITS, ...small],
    });
  }

  // R7 — measurement quality.
  const failed = live.filter((o) => validity(o) === "not_collected");
  if (live.length >= 5 && failed.length / live.length > 0.2) {
    out.push({
      id: `rec_${stableHash("R7", 12)}`,
      rule: "measurement_quality",
      title: "Many observations failed to collect",
      observedGap: `${failed.length} of ${live.length} observations did not return a usable answer (errors, timeouts, rate limits or grounding failures).`,
      evidenceObsIds: failed.map((o) => o.id),
      sourceLinks: [],
      proposedAction: "Open Scan history to see the error classes, retry failed jobs, and consider lowering concurrency or requests per minute in provider settings.",
      actionIsHypothesis: false,
      priority: "medium",
      priorityReason: "Coverage gaps weaken every metric",
      confidence: "high",
      limitations: [],
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.priority] - rank[b.priority]);
}
