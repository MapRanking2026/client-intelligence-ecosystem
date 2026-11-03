/**
 * The rules behind ⌘K: what counts as a match, how matches are ranked, and how they are grouped.
 *
 * Kept pure and apart from the service that fetches, for one reason above the others: the ranking
 * is the whole experience. An AM types three letters of a client's name and the right row has to
 * be first, every time -- and that is a rule worth being able to test without a tenant, a token
 * or a network.
 *
 * Three decisions it is built on:
 *
 *  - **Every word in the query must match something.** "oak tempe" finds the client whose name is
 *    Oakline and whose location is Tempe, and nothing else. Scoring across words without requiring
 *    them all turns a two-word query into a longer list, which is the opposite of what a second
 *    word is for.
 *  - **Where a word matches decides the rank, not how often.** A name that starts with the query
 *    beats a name that merely contains it, which beats a match buried in a subtitle. Frequency
 *    ranking rewards long text, and long text here is a summary nobody searched for.
 *  - **Nothing is invented to fill the list.** A group with no match is absent. There is no
 *    "did you mean", because a wrong client is worse than no client.
 */

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/**
 * The order results are shown in, which is the order an AM looks for things in: the client, then
 * the call, then what came out of the call, then the app itself.
 */
export const SEARCH_GROUPS = [
  { id: "clients", label: "Clients" },
  { id: "touches", label: "Monthly Touches" },
  { id: "commitments", label: "Commitments" },
  { id: "opportunities", label: "Opportunities" },
  { id: "tickets", label: "Tickets" },
  { id: "brief", label: "Brief sections" },
  { id: "integrations", label: "Integrations" },
  { id: "pages", label: "Pages" },
] as const;

export type SearchGroupId = (typeof SEARCH_GROUPS)[number]["id"];

/** At most this many rows per group, so one big group cannot bury the other seven. */
export const GROUP_LIMIT = 5;

/** And at most this many in total, which is about one screen of the palette. */
export const TOTAL_LIMIT = 24;

/** Below this, a query is too short to rank usefully and the palette shows its default rows. */
export const MIN_QUERY_LENGTH = 2;

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Where in a row's text a match was found. Highlighted in the palette. */
export interface MatchRange {
  start: number;
  end: number;
}

export function searchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Every place the tokens appear in one string, merged where they overlap.
 *
 * Merged because "oak oakline" would otherwise mark the same letters twice and the highlighter
 * would emit nested spans over the same text.
 */
export function matchRanges(text: string, query: string): MatchRange[] {
  const haystack = text.toLowerCase();
  const found: MatchRange[] = [];

  for (const token of searchTokens(query)) {
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(token, from);
      if (at < 0) break;
      found.push({ start: at, end: at + token.length });
      from = at + token.length;
    }
  }

  found.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: MatchRange[] = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

/**
 * How well one token matches one string: 0 when it does not.
 *
 * The three tiers are the whole ranking. A token at the start of the text is what someone typing
 * a name means; a token at the start of any word in it is the second thing they mean; a token in
 * the middle of a word is a coincidence that should still be findable.
 */
function tokenScore(haystack: string, token: string): number {
  const at = haystack.indexOf(token);
  if (at < 0) return 0;
  if (at === 0) return 10;
  // A word boundary: the character before it is not a letter or a digit.
  if (!/[a-z0-9]/.test(haystack[at - 1])) return 6;
  return 2;
}

export interface SearchFields {
  /** The row's own name. Worth the most, because it is what people search by. */
  title: string;
  /** The line under it: an owner, a date, a stage. Worth less. */
  subtitle?: string;
  /** Anything else worth finding the row by and not worth showing: a location, an industry, an id. */
  keywords?: string[];
}

/**
 * The row's score, or 0 when any token of the query matches nothing in it.
 *
 * The all-tokens rule lives here rather than in the caller so that every group obeys it. The score
 * is the sum of each token's best field, which means a query whose words land in different fields
 * ("oak tempe") still ranks above one where only the title matched a single word.
 */
export function scoreFields(fields: SearchFields, query: string): number {
  const tokens = searchTokens(query);
  if (!tokens.length) return 0;

  const title = fields.title.toLowerCase();
  const subtitle = (fields.subtitle || "").toLowerCase();
  const keywords = (fields.keywords || []).filter(Boolean).join(" ").toLowerCase();

  let total = 0;
  for (const token of tokens) {
    const best = Math.max(
      tokenScore(title, token) * 3,
      tokenScore(subtitle, token),
      // Keywords are findable but never the reason a row outranks another on its own name.
      tokenScore(keywords, token),
    );
    if (best === 0) return 0;
    total += best;
  }

  // A shorter title that matched is more likely to be the thing: "Oakline Dental" over "Oakline
  // Dental Group of Greater Phoenix" when both match "oakline".
  return total + Math.max(0, 40 - fields.title.length) / 100;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface SearchHit {
  id: string;
  group: SearchGroupId;
  title: string;
  subtitle?: string;
  href: string;
  /** Short labels shown on the right of the row: a status, a stage, a date. */
  chips?: string[];
  score: number;
  titleRanges: MatchRange[];
  subtitleRanges?: MatchRange[];
}

export interface SearchGroupResult {
  id: SearchGroupId;
  label: string;
  hits: SearchHit[];
  /** How many were found beyond the ones shown, so the palette can say "and 7 more". */
  more: number;
}

/**
 * Sort, cap and group. Empty groups are dropped rather than shown empty.
 *
 * Capping per group before the total cap is deliberate: an AM with 200 clients searching "a" would
 * otherwise get 24 clients and nothing else, and the one thing they wanted might be a page.
 */
export function groupResults(hits: SearchHit[]): SearchGroupResult[] {
  const out: SearchGroupResult[] = [];
  let shown = 0;

  for (const group of SEARCH_GROUPS) {
    const matches = hits
      .filter((hit) => hit.group === group.id && hit.score > 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    if (!matches.length) continue;

    const room = Math.max(0, Math.min(GROUP_LIMIT, TOTAL_LIMIT - shown));
    if (!room) continue;
    const take = matches.slice(0, room);
    shown += take.length;
    out.push({ id: group.id, label: group.label, hits: take, more: matches.length - take.length });
  }

  return out;
}

export function totalHits(groups: SearchGroupResult[]): number {
  return groups.reduce((sum, group) => sum + group.hits.length, 0);
}

// ---------------------------------------------------------------------------
// The pages group
// ---------------------------------------------------------------------------

/**
 * The app's own screens, searchable by name and by what an AM would call them.
 *
 * The keywords are the words people actually type: "settings email signoff" should find
 * preferences, and "tickets" should not find this list at all because tickets are real rows.
 */
export const SEARCH_PAGES: { title: string; href: string; subtitle: string; keywords: string[] }[] = [
  { title: "Command Center", href: "/command-center", subtitle: "Your day across the whole book", keywords: ["home", "dashboard", "today"] },
  { title: "Clients", href: "/clients", subtitle: "Every client and their health", keywords: ["accounts", "roster", "book"] },
  { title: "Monthly Touches", href: "/monthly-touch", subtitle: "Prep, run and close the calls", keywords: ["calls", "meetings", "touch"] },
  { title: "Call Intelligence", href: "/calls", subtitle: "What was said, and what came of it", keywords: ["transcripts", "recordings"] },
  { title: "Commitments", href: "/commitments", subtitle: "What we promised and what is owed", keywords: ["promises", "follow-up", "overdue"] },
  { title: "Opportunities", href: "/opportunities", subtitle: "Growth in the pipeline", keywords: ["upsell", "pipeline", "growth"] },
  { title: "QA & Coaching", href: "/qa", subtitle: "How the calls are being run", keywords: ["quality", "scorecard", "coaching"] },
  { title: "Settings", href: "/settings", subtitle: "Administration", keywords: ["admin", "configuration"] },
  {
    title: "My profile & preferences",
    href: "/settings/preferences",
    subtitle: "Your name, clock, theme, sign-off and call defaults",
    keywords: ["profile", "preferences", "theme", "dark mode", "time zone", "signoff", "sign-off", "start page", "notifications"],
  },
  {
    title: "Integrations",
    href: "/settings/integrations",
    subtitle: "Connections and what MTOS may do for you",
    keywords: ["oauth", "permissions", "scopes", "connect", "reconnect", "clickup", "google", "intercom"],
  },
  { title: "Prompt Engine", href: "/settings/prompt-engine", subtitle: "The prompts behind every AI step", keywords: ["prompts", "ai", "model"] },
  { title: "Knowledge base", href: "/settings/knowledge", subtitle: "Playbooks and SOPs the AI reads", keywords: ["knowledge", "sop", "playbook", "docs"] },
  { title: "Report branding", href: "/settings/report-brand", subtitle: "Logo, colour and font on client reports", keywords: ["brand", "logo", "colour", "color", "font", "reports"] },
];
