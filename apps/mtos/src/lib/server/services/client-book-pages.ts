/**
 * Where a touch's two pages live in the Client's Book, and how to find them.
 *
 * The hierarchy is the account managers' own, and it changed: the book holds ONE page per touch
 * under `Client Meetings Notes`, named `Pre-Monthly Touch Notes <date>`, and the post-call write-up
 * is a SUBPAGE of that page named `Post-Monthly Touch Notes <date>`. The post notes live inside the
 * pre notes from the same touch, never as a page of their own beside them.
 *
 * Two consequences the rest of the service depends on:
 *
 *  - The preparation step creates the pre page and nothing else. It no longer files an empty
 *    post-notes placeholder, because a placeholder makes every later post-meeting run look like a
 *    re-run of something that already exists.
 *  - The post-meeting step must find the pre page for that date. The AMs write these pages by hand
 *    with the date in whatever format they feel like, so the match is by name AND date across every
 *    format seen in real books. When nothing matches, or more than one page could, nothing is
 *    guessed: the caller is handed the candidates and asks.
 *
 * Kept free of ClickUp and Firestore so the naming and matching can be exercised directly.
 */

/** The names an account manager might have given this month's page. Lowercased, punctuation-loose. */
const PRE_NOTES_ALIASES = [
  "pre-monthly touch notes",
  "pre monthly touch notes",
  "premonthly touch notes",
  "pre-mt notes",
  "pre mt notes",
];

/** Pages MTOS itself wrote under the previous naming, before the pre/post hierarchy was settled. */
const LEGACY_TOUCH_ALIASES = ["monthly touch"];

export const POST_NOTES_PREFIX = "Post-Monthly Touch Notes";
export const PRE_NOTES_PREFIX = "Pre-Monthly Touch Notes";

export interface BookPage {
  id: string;
  name: string;
}

/**
 * The touch's date in the AM's zone, as `M/D/YYYY`.
 *
 * Deliberately the touch's own local date rather than a UTC one: a 5pm Pacific call is already
 * tomorrow in UTC and would file itself a day late, under a heading no one would look for.
 */
export function touchDateLabel(dateIso: string, timeZone = "America/Los_Angeles"): string {
  const date = new Date(dateIso);
  const when = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).format(when);
}

/** `Pre-Monthly Touch Notes 10/28/2026` — this touch's page under `Client Meetings Notes`. */
export function preNotesPageName(dateIso: string, timeZone?: string): string {
  return `${PRE_NOTES_PREFIX} ${touchDateLabel(dateIso, timeZone)}`;
}

/**
 * `Post-Monthly Touch Notes 10/28/2026` — the subpage, carrying the parent's own date format.
 *
 * Reading the format off the parent rather than re-deriving it is what keeps a hand-written
 * `Pre-Monthly Touch Notes Oct 28, 2026` from acquiring a child dated `10/28/2026`, which reads as
 * two different meetings sitting inside each other.
 */
export function postNotesPageName(parentPageName: string, dateIso: string, timeZone?: string): string {
  const fromParent = extractDateText(parentPageName);
  return `${POST_NOTES_PREFIX} ${fromParent || touchDateLabel(dateIso, timeZone)}`;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[()]/g, " ").replace(/\s+/g, " ");
}

/** The date portion of a page title, i.e. whatever follows the notes prefix. */
function extractDateText(pageName: string): string {
  const trimmed = pageName.trim().replace(/[()]/g, " ").trim();
  for (const alias of [...PRE_NOTES_ALIASES, ...LEGACY_TOUCH_ALIASES]) {
    const index = trimmed.toLowerCase().indexOf(alias);
    if (index >= 0) {
      return trimmed.slice(index + alias.length).replace(/^[\s:\u2013\u2014-]+/, "").trim();
    }
  }
  return "";
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/**
 * Every way a Map Ranking account manager has been seen to write one date in a page title.
 *
 * Generated from the date rather than parsed out of the title, because generating is exact: a
 * title either contains one of these strings or it does not, and no almost-date can slip through a
 * loose parser and nest this month's notes under last month's page.
 */
export function dateVariants(dateIso: string, timeZone = "America/Los_Angeles"): string[] {
  const date = new Date(dateIso);
  const when = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(when);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const year = get("year");
  const month = Number(get("month"));
  const day = Number(get("day"));
  const monthName = MONTH_NAMES[month - 1] || "";
  const shortMonth = monthName.slice(0, 3);
  const pad = (value: number) => String(value).padStart(2, "0");
  const shortYear = year.slice(-2);

  return [
    `${year}-${pad(month)}-${pad(day)}`,
    `${month}/${day}/${year}`,
    `${pad(month)}/${pad(day)}/${year}`,
    `${month}/${day}/${shortYear}`,
    `${pad(month)}/${pad(day)}/${shortYear}`,
    `${month}-${day}-${year}`,
    `${shortMonth} ${day}, ${year}`,
    `${shortMonth} ${day} ${year}`,
    `${shortMonth} ${day}`,
    `${monthName} ${day}, ${year}`,
    `${monthName} ${day} ${year}`,
    `${monthName} ${day}`,
    `${day} ${monthName} ${year}`,
  ].map((variant) => variant.toLowerCase());
}

/** True when this page title names this touch's date in any of the formats the team uses. */
export function pageNamesDate(pageName: string, dateIso: string, timeZone?: string): boolean {
  const haystack = normalize(pageName);
  return dateVariants(dateIso, timeZone).some((variant) => haystack.includes(variant));
}

function hasAlias(pageName: string, aliases: string[]): boolean {
  const haystack = normalize(pageName);
  return aliases.some((alias) => haystack.includes(alias));
}

export type PreNotesMatch =
  | { kind: "found"; page: BookPage }
  | { kind: "ambiguous"; candidates: BookPage[] }
  | { kind: "none"; legacyCandidates: BookPage[] };

/**
 * This touch's `Pre-Monthly Touch Notes` page among everything in the book.
 *
 * Returns the three outcomes separately on purpose. `found` is the only one the post-meeting step
 * may write under; `ambiguous` and `none` both mean the account manager has to say which page, and
 * the caller must not fall back to a top-level page or invent one. `legacyCandidates` carries the
 * older `Monthly Touch (date)` pages for the same day so the AM is shown the page they probably
 * mean instead of being told nothing exists.
 */
export function findPreNotesPage(pages: BookPage[], dateIso: string, timeZone?: string): PreNotesMatch {
  const dated = pages.filter((page) => pageNamesDate(page.name, dateIso, timeZone));
  const matches = dated.filter((page) => hasAlias(page.name, PRE_NOTES_ALIASES));
  if (matches.length === 1) {
    return { kind: "found", page: matches[0] };
  }
  if (matches.length > 1) {
    return { kind: "ambiguous", candidates: matches };
  }
  return { kind: "none", legacyCandidates: dated.filter((page) => hasAlias(page.name, LEGACY_TOUCH_ALIASES)) };
}

/** An existing `Post-Monthly Touch Notes` page among the children of the pre-notes page. */
export function findPostNotesPage(children: BookPage[]): BookPage | undefined {
  return children.find((page) => normalize(page.name).startsWith("post-monthly touch notes") || normalize(page.name).startsWith("post monthly touch notes"));
}
