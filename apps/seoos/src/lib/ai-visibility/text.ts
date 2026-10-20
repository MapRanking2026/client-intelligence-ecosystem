/**
 * Token-level text utilities for business detection. Matching is done on whole
 * tokens (never raw substrings) with offsets preserved back to the original
 * answer text so every finding can show the exact supporting span.
 */

export interface Token {
  norm: string;
  start: number;
  end: number;
}

export function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Normalize one token: lowercase, no diacritics, possessive 's removed. */
export function normToken(raw: string): string {
  let t = stripDiacritics(raw).toLowerCase().replace(/[’']/g, "'");
  if (t === "&" || t === "+") return "and";
  t = t.replace(/'s$/, "").replace(/'/g, "");
  return t;
}

const TOKEN_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|&|\+/gu;

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    const norm = normToken(m[0]);
    if (!norm) continue;
    out.push({ norm, start, end: start + m[0].length });
  }
  return out;
}

export function normPhrase(s: string): string[] {
  return tokenize(s).map((t) => t.norm);
}

/** Legal-entity suffixes that are optional when matching a business name. */
const LEGAL_SUFFIXES = new Set(["llc", "inc", "corp", "corporation", "ltd", "pllc", "pc", "co", "lp", "llp"]);

/**
 * Words that cannot identify a business on their own. An alias made only of
 * these (e.g. "Cleaning Services", "Best Plumbing") would match competitors and
 * is rejected by the matcher and flagged at onboarding.
 */
export const GENERIC_WORDS = new Set([
  "the", "and", "of", "a", "an", "in", "at", "by", "for", "to", "my", "your", "our",
  "best", "top", "local", "pro", "pros", "professional", "professionals", "expert", "experts",
  "quality", "premier", "elite", "reliable", "affordable", "trusted", "fast", "first", "choice",
  "service", "services", "company", "companies", "co", "group", "solutions", "team", "home", "house",
  "cleaning", "cleaners", "clean", "maid", "maids", "janitorial", "commercial", "residential",
  "plumbing", "plumber", "plumbers", "painting", "painters", "painter", "hvac", "heating", "cooling",
  "air", "conditioning", "garage", "door", "doors", "repair", "repairs", "installation",
  "restoration", "water", "fire", "mold", "damage", "roofing", "roofer", "roofers", "electric",
  "electrical", "electrician", "law", "legal", "lawyer", "lawyers", "attorney", "attorneys", "firm",
  "office", "offices", "auto", "glass", "windshield", "contractors", "contractor", "construction",
  "llc", "inc", "usa", "us", "america", "american", "national", "city", "county", "metro",
  "north", "south", "east", "west", "central", "area",
]);

export function isGenericPhrase(tokens: string[]): boolean {
  const meaningful = tokens.filter((t) => !LEGAL_SUFFIXES.has(t));
  return meaningful.length === 0 || meaningful.every((t) => GENERIC_WORDS.has(t));
}

/**
 * Token sequences that identify a business name: the name as given, without
 * legal suffixes, and without a leading "the". Generic-only variants and very
 * short single tokens are dropped to avoid false positives.
 */
export function nameVariants(name: string): string[][] {
  const base = normPhrase(name);
  if (!base.length) return [];
  const variants: string[][] = [base];
  const noSuffix = [...base];
  while (noSuffix.length > 1 && LEGAL_SUFFIXES.has(noSuffix[noSuffix.length - 1])) noSuffix.pop();
  variants.push(noSuffix);
  if (noSuffix[0] === "the" && noSuffix.length > 1) variants.push(noSuffix.slice(1));
  const seen = new Set<string>();
  return variants.filter((v) => {
    const key = v.join(" ");
    if (seen.has(key)) return false;
    seen.add(key);
    if (isGenericPhrase(v)) return false;
    if (v.length === 1 && v[0].length < 4) return false;
    return true;
  });
}

/** Find all whole-token occurrences of `phrase` in `tokens`. */
export function findPhrase(tokens: Token[], phrase: string[]): Array<{ start: number; end: number; ti: number }> {
  const hits: Array<{ start: number; end: number; ti: number }> = [];
  if (!phrase.length) return hits;
  outer: for (let i = 0; i + phrase.length <= tokens.length; i += 1) {
    for (let j = 0; j < phrase.length; j += 1) {
      if (tokens[i + j].norm !== phrase[j]) continue outer;
    }
    hits.push({ start: tokens[i].start, end: tokens[i + phrase.length - 1].end, ti: i });
  }
  return hits;
}

export const US_STATES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado",
  CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho",
  IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana",
  ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota",
  MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada",
  NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina",
  ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas",
  UT: "utah", VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia",
  WI: "wisconsin", WY: "wyoming", DC: "district of columbia",
};

const STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name, code]),
);

/** Resolve "TN" / "Tennessee" / "tn" → "TN"; unknown → "". */
export function stateCode(raw: string | undefined): string {
  if (!raw) return "";
  const t = raw.trim();
  if (US_STATES[t.toUpperCase()]) return t.toUpperCase();
  return STATE_NAME_TO_CODE[stripDiacritics(t).toLowerCase()] ?? "";
}

const STATE_ALT = [
  ...Object.keys(US_STATES),
  ...Object.values(US_STATES).map((n) => n.replace(/\b\w/g, (c) => c.toUpperCase())),
]
  .sort((a, b) => b.length - a.length)
  .map((s) => s.replace(/ /g, "\\s+"))
  .join("|");

/** "City, ST" / "City, State" mentions, e.g. "Smyrna, TN". */
const CITY_STATE_RE = new RegExp(
  `\\b([A-Z][\\p{L}.'-]+(?:\\s+[A-Z][\\p{L}.'-]+){0,3}),\\s*(${STATE_ALT})\\b`,
  "gu",
);

export interface PlaceMention {
  city: string;
  state: string;
  start: number;
  end: number;
}

export function findPlaceMentions(text: string): PlaceMention[] {
  const out: PlaceMention[] = [];
  for (const m of text.matchAll(CITY_STATE_RE)) {
    const code = stateCode(m[2].replace(/\s+/g, " "));
    if (!code) continue;
    const start = m.index ?? 0;
    out.push({ city: m[1].trim(), state: code, start, end: start + m[0].length });
  }
  return out;
}

export function sameCity(a: string, b: string): boolean {
  return normPhrase(a).join(" ") === normPhrase(b).join(" ");
}
