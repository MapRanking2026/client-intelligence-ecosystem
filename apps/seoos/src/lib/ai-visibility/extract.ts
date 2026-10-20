import type { AivAnalysis, AivCitation, AnswerClass, EntityFinding, Sentiment, TextSpan } from "./types";
import { clauses, isProperlyOrdered, parseLists, passages, type ParsedList, type Passage } from "./structure";
import {
  findPhrase,
  findPlaceMentions,
  GENERIC_WORDS,
  isGenericPhrase,
  nameVariants,
  normPhrase,
  sameCity,
  stateCode,
  tokenize,
  type Token,
} from "./text";
import { hostMatchesDomain, normalizeDomain } from "./url";

/**
 * Deterministic business detection over a collected answer. Runs AFTER
 * collection (it never influences what was asked). Versioned so stored
 * analyses can be recomputed and compared.
 */
export const EXTRACTOR_VERSION = "det-1.2.0";

/** "Acme Cleaning, LLC" and "Acme Cleaning" are the same discovered business. */
const LEGAL_SUFFIX_KEYS = new Set(["llc", "inc", "corp", "ltd", "pllc", "co", "lp", "llp", "company"]);

export interface SubjectBusiness {
  key: string;
  kind: "client" | "competitor";
  name: string;
  aliases: string[];
  domains: string[];
}

export interface ExtractionSubject {
  client: SubjectBusiness & {
    /** Approved service-area cities (for the similarly-named-business check). */
    cities: Array<{ city: string; region: string }>;
    neighborhoods: string[];
  };
  competitors: SubjectBusiness[];
}

const POSITIVE_RE =
  /\b(recommend(?:ed|s|ation)?|top[- ]rated|highly[- ]rated|best|reputable|reliable|trusted|trustworthy|well[- ]reviewed|well[- ]regarded|excellent|outstanding|great (?:option|choice|reviews?)|good (?:option|choice|reviews?)|strong reviews?|popular|known for|stands? out|consider|worth (?:considering|calling|contacting|a call)|go-to|favorite|five[- ]star|5[- ]star)\b/i;
const NEGATIVE_RE =
  /\b(complain(?:t|ts|ed)?|avoid|poor(?:ly)?[- ](?:rated|reviews?|service)|negative reviews?|bad reviews?|(?:do|would) not recommend|not recommended|unlicensed|uninsured|scam|lawsuits?|out of business|permanently closed|no longer (?:operating|in business)|red flags?|(?:issues|problems) with|low ratings?|one[- ]star|1[- ]star|bbb (?:alert|warning))\b/i;
const HEDGE_RE =
  /\b(mixed reviews?|could(?: not|n't) verify|unable to verify|cannot verify|can't verify|unverified|unclear|not sure|limited (?:information|reviews)|(?:did|could)(?: not|n't) find much|reviews? (?:are|is) mixed|varies|inconsistent)\b/i;
const REFUSAL_RE =
  /^(?:[^\n]{0,80})\b(I can(?:not|'t|’t) (?:help|provide|recommend|browse)|I(?:'m| am) (?:not able|unable) to (?:provide|recommend|browse|search)|I don(?:'t|’t) have (?:the ability|access) to (?:browse|search|recommend))/i;

/** Leads that are section titles, not businesses. */
const NON_BUSINESS_LEAD =
  /^(tips?|things to|how to|what to|why|when|where|questions|summary|note|notes|final|bottom line|pricing|cost|costs|price|factors|considerations?|step|steps|next steps|overview|conclusion|my recommendation|recommendations?|top picks?|other options|additional|also|sources?|check|ask|get|look|verify|compare|read|call|request|make|ensure|choose|research|schedule|book|confirm)\b/i;

const BUSINESSY = new Set([
  "llc", "inc", "co", "company", "services", "service", "cleaning", "cleaners", "maids", "maid",
  "plumbing", "plumbers", "painting", "painters", "hvac", "heating", "cooling", "air", "garage",
  "doors", "door", "restoration", "roofing", "electric", "electrical", "law", "firm", "attorneys",
  "group", "pros", "solutions", "contractors", "construction", "glass", "auto", "repair", "care",
  "home", "janitorial", "carpet", "pest", "landscaping", "lawn", "movers", "moving", "windows",
]);

function looksLikeBusinessName(lead: string): boolean {
  const clean = lead.replace(/[*_`#\[\]]/g, "").trim();
  if (!clean || clean.length > 70) return false;
  if (NON_BUSINESS_LEAD.test(clean)) return false;
  const words = clean.split(/\s+/);
  if (words.length > 8) return false;
  const toks = normPhrase(clean);
  if (!toks.length || isGenericPhrase(toks)) return false;
  if (/['’]s\b/.test(clean)) return true;
  if (toks.some((t) => BUSINESSY.has(t))) return true;
  const caps = words.filter((w) => /^[A-Z0-9]/.test(w)).length;
  return caps >= 2 && caps >= words.length - 1;
}

interface Hit extends TextSpan {
  by: "name" | "alias" | "domain";
}

function findBusiness(text: string, tokens: Token[], b: SubjectBusiness): Hit[] {
  const hits: Hit[] = [];
  const push = (h: { start: number; end: number }, by: Hit["by"]) => {
    if (hits.some((x) => h.start < x.end && h.end > x.start)) return;
    hits.push({ start: h.start, end: h.end, text: text.slice(h.start, h.end), by });
  };
  for (const v of nameVariants(b.name)) for (const h of findPhrase(tokens, v)) push(h, "name");
  for (const a of b.aliases) for (const v of nameVariants(a)) for (const h of findPhrase(tokens, v)) push(h, "alias");
  for (const d of b.domains) {
    const dom = normalizeDomain(d);
    if (!dom) continue;
    const re = new RegExp(`(?<![\\w.-])(?:https?://)?(?:www\\.)?${dom.replace(/\./g, "\\.")}(?![\\w-])`, "gi");
    for (const m of text.matchAll(re)) push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }, "domain");
  }
  return hits.sort((a, b2) => a.start - b2.start);
}

function containing<T extends { start: number; end: number }>(list: T[], pos: number): T | undefined {
  return list.find((p) => pos >= p.start && pos < p.end + 1);
}

function sentimentFor(text: string, scopes: Array<{ start: number; end: number }>): { s: Sentiment; positive: boolean } {
  let pos = false;
  let neg = false;
  let hedge = false;
  for (const c of scopes) {
    const seg = text.slice(c.start, c.end);
    if (POSITIVE_RE.test(seg)) pos = true;
    if (NEGATIVE_RE.test(seg)) neg = true;
    if (HEDGE_RE.test(seg)) hedge = true;
  }
  if (neg && pos) return { s: "ambiguous", positive: pos };
  if (neg) return { s: "negative", positive: false };
  if (hedge) return { s: "ambiguous", positive: pos };
  if (pos) return { s: "positive", positive: true };
  return { s: "neutral", positive: false };
}

function citationsSupporting(
  citations: AivCitation[],
  scopes: Array<{ start: number; end: number }>,
  b: SubjectBusiness,
  excludeDomains: string[],
): string[] {
  const variants = [b.name, ...b.aliases].flatMap((n) => nameVariants(n));
  const urls = new Set<string>();
  for (const c of citations) {
    if (excludeDomains.some((d) => hostMatchesDomain(c.domain, d))) continue;
    const overlaps = c.answerSpans.some((sp) => scopes.some((s) => sp.start < s.end && sp.end > s.start));
    const about = [c.title ?? "", c.citedText ?? ""].some((t) => {
      const toks = tokenize(t);
      return variants.some((v) => findPhrase(toks, v).length > 0);
    });
    if (overlaps || about) urls.add(c.normalizedUrl);
  }
  return [...urls];
}

function classify(text: string, entities: EntityFinding[], providerLists: number): AnswerClass {
  if (!text.trim()) return "no_answer";
  const anyBusiness = entities.some((e) => e.mentioned);
  if (!anyBusiness && REFUSAL_RE.test(text)) return "refusal";
  if (anyBusiness || providerLists > 0) return "recommendations_present";
  return "no_recommendations";
}

/** Which ordered list (if any) is the recommendation list: first properly ordered list with ≥2 business leads. */
function recommendationList(lists: ParsedList[], leadIsBusiness: (lead: string, s: number, e: number) => boolean): number {
  return lists.findIndex(
    (l) => isProperlyOrdered(l) && l.items.filter((it) => leadIsBusiness(it.lead, it.leadStart, it.leadEnd)).length >= 2,
  );
}

export function extractAnswer(
  answerText: string,
  citations: AivCitation[],
  subject: ExtractionSubject,
): AivAnalysis {
  const text = answerText ?? "";
  const tokens = tokenize(text);
  const lists = parseLists(text);
  const ps: Passage[] = passages(text, lists);
  const known: SubjectBusiness[] = [subject.client, ...subject.competitors];
  const hitsByKey = new Map<string, Hit[]>();
  for (const b of known) hitsByKey.set(b.key, findBusiness(text, tokens, b));

  const inLeadOfKnown = (s: number, e: number) =>
    known.some((b) => (hitsByKey.get(b.key) ?? []).some((h) => h.start >= s && h.end <= e + 2));
  const leadIsBusiness = (lead: string, s: number, e: number) => inLeadOfKnown(s, e) || looksLikeBusinessName(lead);

  const recListIdx = recommendationList(lists, leadIsBusiness);
  const providerListIdx = new Set(
    lists
      .map((l, i) => ({ i, n: l.items.filter((it) => leadIsBusiness(it.lead, it.leadStart, it.leadEnd)).length }))
      .filter((x) => x.n >= 2 || (x.n >= 1 && lists[x.i].items.length === 1))
      .map((x) => x.i),
  );

  const clientStates = new Set(subject.client.cities.map((c) => stateCode(c.region)).filter(Boolean));
  const ownedDomains = subject.client.domains.map(normalizeDomain).filter(Boolean);

  const entities: EntityFinding[] = [];
  const claimedLeadItems = new Set<string>();

  for (const b of known) {
    const hits = hitsByKey.get(b.key) ?? [];
    const notes: string[] = [];
    const scopes: Array<{ start: number; end: number }> = [];
    let position: number | null = null;
    let inProviderList = false;
    let inLead = false;
    let locationConflict: string | undefined;
    let softLocationNote = false;

    for (const h of hits) {
      const p = containing(ps, h.start);
      if (!p) continue;
      if (p.kind === "list_item" && p.listIndex !== undefined && p.itemIndex !== undefined) {
        const item = lists[p.listIndex].items[p.itemIndex];
        const isLead = h.start >= item.leadStart && h.end <= item.leadEnd + 2;
        // Body mentions inside another business's item ("similar to X") are not a listing.
        if (isLead) {
          inLead = true;
          if (providerListIdx.has(p.listIndex)) inProviderList = true;
          claimedLeadItems.add(`${p.listIndex}:${p.itemIndex}`);
          if (p.listIndex === recListIdx && position === null && item.number !== null) position = item.number;
          scopes.push({ start: item.start, end: item.end });
        } else {
          const cl = clauses(text, p).find((c) => h.start >= c.start && h.start < c.end) ?? p;
          scopes.push(cl);
        }
      } else {
        const cl = clauses(text, p).find((c) => h.start >= c.start && h.start < c.end) ?? p;
        scopes.push(cl);
      }

      if (b.kind === "client") {
        const passage = p.kind === "list_item" ? { start: p.start, end: p.end } : p;
        const places = findPlaceMentions(text.slice(passage.start, passage.end));
        for (const pl of places) {
          const inArea =
            subject.client.cities.some((c) => sameCity(c.city, pl.city)) ||
            subject.client.neighborhoods.some((n) => sameCity(n, pl.city));
          if (inArea) continue;
          if (clientStates.size && !clientStates.has(pl.state)) {
            locationConflict = `Passage places this name in ${pl.city}, ${pl.state} — outside the client's state(s)`;
          } else {
            softLocationNote = true;
            notes.push(`Passage mentions ${pl.city}, ${pl.state}, which is not a configured service location`);
          }
        }
      }
    }

    const matchedBy = [...new Set(hits.map((h) => h.by))];
    const mentionedRaw = hits.length > 0;
    const ownedDomainCited =
      b.kind === "client" && citations.some((c) => ownedDomains.some((d) => hostMatchesDomain(c.domain, d)));
    const sent = sentimentFor(text, scopes);
    const conflict = Boolean(locationConflict);
    const mentioned = mentionedRaw && !conflict;
    const recommended =
      mentioned && (sent.s === "positive" || sent.s === "neutral") && (inProviderList || sent.positive);

    let confidence = 0;
    if (mentionedRaw) {
      confidence = matchedBy.includes("name") ? 0.95 : matchedBy.includes("domain") ? 0.9 : 0.85;
      if (softLocationNote) confidence -= 0.2;
      if (conflict) confidence = 0.2;
      if (!inLead && !inProviderList && sent.s === "neutral") confidence -= 0.05;
    }
    if (conflict) notes.push("Not counted as a client mention: likely a similarly named business elsewhere. Correct manually if wrong.");
    if (mentionedRaw && !inLead && lists.length && recListIdx >= 0) notes.push("Mentioned outside the ordered list items; no position assigned.");

    const thirdParty = mentionedRaw
      ? citationsSupporting(citations, scopes, b, b.kind === "client" ? ownedDomains : b.domains.map(normalizeDomain))
      : [];

    entities.push({
      entityKey: b.key,
      kind: b.kind,
      name: b.name,
      mentioned,
      recommended,
      sentiment: mentionedRaw ? sent.s : "neutral",
      position: mentioned ? position : null,
      matchedBy,
      spans: hits.map(({ start, end, text: t }) => ({ start, end, text: t })),
      confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
      locationConflict,
      ownedDomainCited,
      thirdPartyCitationUrls: thirdParty,
      notes,
    });
  }

  // Businesses named in list leads that are neither the client nor a known competitor.
  const discovered = new Map<string, EntityFinding>();
  lists.forEach((l, li) => {
    if (!providerListIdx.has(li)) return;
    l.items.forEach((it, ii) => {
      if (claimedLeadItems.has(`${li}:${ii}`)) return;
      if (!looksLikeBusinessName(it.lead)) return;
      const norm = normPhrase(it.lead).filter((t) => !GENERIC_WORDS.has(t) || t.length > 3);
      // Spacing variants ("Hello Cleaners" / "Hellocleaners") collapse to one key.
      const keyToks = normPhrase(it.lead);
      while (keyToks.length > 1 && LEGAL_SUFFIX_KEYS.has(keyToks[keyToks.length - 1])) keyToks.pop();
      const key = `discovered:${keyToks.join("")}`;
      if (!norm.length || discovered.has(key)) return;
      const scope = [{ start: it.start, end: it.end }];
      const sent = sentimentFor(text, scope);
      discovered.set(key, {
        entityKey: key,
        kind: "discovered",
        name: it.lead.replace(/[*_]+/g, "").replace(/[\s:;,.–—-]+$/, "").trim(),
        mentioned: true,
        recommended: sent.s === "positive" || sent.s === "neutral",
        sentiment: sent.s,
        position: li === recListIdx && it.number !== null ? it.number : null,
        matchedBy: ["name"],
        spans: [{ start: it.leadStart, end: it.leadEnd, text: text.slice(it.leadStart, it.leadEnd) }],
        confidence: 0.6,
        ownedDomainCited: false,
        thirdPartyCitationUrls: citations
          .filter((c) => c.answerSpans.some((sp) => sp.start < it.end && sp.end > it.start))
          .map((c) => c.normalizedUrl),
        notes: ["Discovered in the answer; not a configured competitor (unverified name)."],
      });
    });
  });

  const all = [...entities, ...discovered.values()];
  const answerClass = classify(text, all, providerListIdx.size);
  return {
    extractorVersion: EXTRACTOR_VERSION,
    analyzedAt: new Date().toISOString(),
    status: "analyzed",
    answerClass,
    orderedList: recListIdx >= 0,
    orderedListLength: recListIdx >= 0 ? lists[recListIdx].items.length : 0,
    entities: all,
  };
}

/** Wrap extraction so a malformed answer produces a recorded analysis failure, not a crash. */
export function safeExtract(
  answerText: unknown,
  citations: AivCitation[],
  subject: ExtractionSubject,
): AivAnalysis {
  try {
    if (typeof answerText !== "string") throw new Error("answer text is not a string");
    return extractAnswer(answerText, citations, subject);
  } catch (e) {
    return {
      extractorVersion: EXTRACTOR_VERSION,
      analyzedAt: new Date().toISOString(),
      status: "failed",
      error: e instanceof Error ? e.message : "extraction_failed",
      answerClass: "no_answer",
      orderedList: false,
      orderedListLength: 0,
      entities: [],
    };
  }
}
