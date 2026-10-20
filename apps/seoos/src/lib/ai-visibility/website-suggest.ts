import { findPlaceMentions, normPhrase, stateCode } from "./text";

/**
 * Suggest business details from a fetched public page. Output is SUGGESTIONS
 * only (status "suggested", with the evidence text and source URL) — a user must
 * approve each item before it is used for measurement. The page is untrusted:
 * it is parsed with plain string/regex logic and never sent to a model.
 */

export interface Suggestion {
  value: string;
  evidence: string;
}

export interface LocationSuggestion {
  city: string;
  region: string;
  evidence: string;
}

export interface WebsiteSuggestions {
  sourceUrl: string;
  names: Suggestion[];
  services: Suggestion[];
  locations: LocationSuggestion[];
  address?: Suggestion;
  phone?: Suggestion;
  notes: string[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

const NAV_SKIP =
  /^(home|about|about us|contact|contact us|blog|news|reviews|testimonials|gallery|faq|faqs|careers|jobs|login|log in|sign in|book|book now|get a quote|free quote|quote|call|menu|privacy|terms|sitemap|services|our services|locations|areas we serve|service areas|team|our team|pricing|specials|coupons|financing|shop|cart|español|english|read more|learn more)$/i;

const SERVICE_HINT =
  /\b(cleaning|clean|repair|installation|install|replacement|painting|plumbing|drain|water heater|hvac|ac|furnace|heating|cooling|garage door|restoration|mold|roof|roofing|remodel|lawyer|attorney|law|injury|divorce|estate|windshield|glass|pest|landscap|lawn|moving|carpet|window|pressure washing|maintenance|inspection|emergency)\b/i;

function uniq<T extends { value: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = normPhrase(x.value).join(" ");
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim()) as unknown;
      const stack = asArray(parsed);
      while (stack.length) {
        const node = stack.shift();
        if (!node || typeof node !== "object") continue;
        const o = node as Record<string, unknown>;
        if (Array.isArray(o["@graph"])) stack.push(...(o["@graph"] as unknown[]));
        out.push(o);
      }
    } catch {
      // Malformed JSON-LD on the site — ignore.
    }
  }
  return out;
}

const BUSINESS_TYPES = /LocalBusiness|Organization|Service|Business|Plumber|Painter|HVAC|Electrician|Roofing|Attorney|Legal|Contractor|Store|Dentist|Cleaning|Locksmith|MovingCompany|AutoRepair/i;

export function suggestFromHtml(html: string, sourceUrl: string): WebsiteSuggestions {
  const res: WebsiteSuggestions = { sourceUrl, names: [], services: [], locations: [], notes: [] };
  const clean = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  // 1) Structured data (most reliable).
  for (const o of jsonLdBlocks(html)) {
    const types = asArray(o["@type"]).map(String).join(" ");
    if (!BUSINESS_TYPES.test(types)) continue;
    if (typeof o.name === "string") res.names.push({ value: o.name.trim(), evidence: `JSON-LD ${types} name` });
    for (const alt of asArray(o.alternateName)) if (typeof alt === "string") res.names.push({ value: alt.trim(), evidence: "JSON-LD alternateName" });
    const addr = asArray(o.address)[0] as Record<string, unknown> | undefined;
    if (addr && typeof addr === "object") {
      const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode].filter((x) => typeof x === "string" && x);
      // Only a street address published by the business counts as a public address.
      if (typeof addr.streetAddress === "string" && addr.streetAddress.trim() && parts.length >= 3) {
        res.address = { value: parts.join(", "), evidence: "JSON-LD address (streetAddress published on site)" };
      }
      if (typeof addr.addressLocality === "string") {
        res.locations.push({ city: addr.addressLocality, region: String(addr.addressRegion ?? ""), evidence: "JSON-LD address locality" });
      }
    }
    for (const area of asArray(o.areaServed)) {
      const name = typeof area === "string" ? area : typeof area === "object" && area ? (area as Record<string, unknown>).name : undefined;
      if (typeof name === "string" && name.trim()) {
        const m = name.match(/^([^,]+),\s*([A-Za-z .]+)$/);
        res.locations.push({ city: (m ? m[1] : name).trim(), region: m ? stateCode(m[2]) || m[2].trim() : "", evidence: `JSON-LD areaServed: ${name}` });
      }
    }
    if (typeof o.telephone === "string") res.phone = { value: o.telephone, evidence: "JSON-LD telephone" };
    for (const offer of asArray((o.hasOfferCatalog as Record<string, unknown> | undefined)?.itemListElement)) {
      const item = (offer as Record<string, unknown>)?.itemOffered as Record<string, unknown> | undefined;
      if (item && typeof item.name === "string") res.services.push({ value: item.name, evidence: "JSON-LD offer catalog" });
    }
  }

  // 2) Title / site name.
  const og = clean.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (og) res.names.push({ value: decodeEntities(og[1]).trim(), evidence: "og:site_name" });
  const title = clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    const t = stripTags(title[1]);
    const brand = t.split(/\s[|–—-]\s/).map((s) => s.trim()).filter(Boolean);
    if (brand.length > 1) res.names.push({ value: brand[brand.length - 1], evidence: `<title>: ${t.slice(0, 120)}` });
  }

  // 3) Services from navigation links and headings.
  const navs = [...clean.matchAll(/<nav[\s\S]*?<\/nav>/gi)].map((m) => m[0]).join(" ") || clean;
  for (const m of navs.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)) {
    const txt = stripTags(m[1]);
    if (!txt || txt.length > 50 || NAV_SKIP.test(txt) || txt.split(" ").length > 5) continue;
    if (SERVICE_HINT.test(txt)) res.services.push({ value: txt, evidence: `Navigation link: "${txt}"` });
  }
  for (const m of clean.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const txt = stripTags(m[1]);
    if (txt && txt.length <= 60 && txt.split(" ").length <= 6 && SERVICE_HINT.test(txt) && !/\?$/.test(txt)) {
      res.services.push({ value: txt.replace(/\s+in\s+[A-Z][\w\s,]+$/, "").trim(), evidence: `Heading: "${txt}"` });
    }
  }

  // 4) Locations from visible text ("City, ST" and "serving …").
  const text = stripTags(clean);
  for (const p of findPlaceMentions(text).slice(0, 40)) {
    res.locations.push({ city: p.city.replace(/^(in|serving|near|and)\s+/i, ""), region: p.state, evidence: text.slice(Math.max(0, p.start - 40), p.end + 20) });
  }

  res.names = uniq(res.names).slice(0, 5);
  res.services = uniq(res.services).slice(0, 25);
  const seenLoc = new Set<string>();
  res.locations = res.locations
    .filter((l) => l.city.length >= 2 && l.city.length <= 40)
    .filter((l) => {
      const k = `${normPhrase(l.city).join(" ")}|${stateCode(l.region) || l.region}`;
      if (seenLoc.has(k)) return false;
      seenLoc.add(k);
      return true;
    })
    .slice(0, 25);
  if (!res.names.length && !res.services.length && !res.locations.length) res.notes.push("No structured business details found on this page.");
  res.notes.push("Suggestions are unverified. Review and approve each item; nothing is used for measurement until approved.");
  return res;
}
