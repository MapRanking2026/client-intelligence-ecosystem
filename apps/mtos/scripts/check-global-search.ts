/**
 * The ranking behind ⌘K: what matches, what wins, and what is grouped where.
 *
 * Pure checks: nothing is fetched. The ranking is the whole experience -- an AM types three
 * letters of a client's name and the right row has to be first -- so it is pinned here rather
 * than discovered on a live screen.
 */
import {
  GROUP_LIMIT,
  MIN_QUERY_LENGTH,
  SEARCH_GROUPS,
  SEARCH_PAGES,
  TOTAL_LIMIT,
  groupResults,
  matchRanges,
  scoreFields,
  searchTokens,
  totalHits,
  type SearchGroupId,
  type SearchHit,
} from "@/src/lib/contracts/global-search";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAILED: ${label}`);
}

function hit(group: SearchGroupId, title: string, score: number): SearchHit {
  return { id: `${group}:${title}`, group, title, href: "/", score, titleRanges: [] };
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

check("a query splits on whitespace", searchTokens("  oak   tempe ").join("|") === "oak|tempe");
check("and is lower-cased", searchTokens("OAK").join("") === "oak");
check("an empty query has no tokens", searchTokens("   ").length === 0);
check("two letters is enough to search", MIN_QUERY_LENGTH === 2);

// ---------------------------------------------------------------------------
// What matches
// ---------------------------------------------------------------------------

const oakline = { title: "Oakline Dental Group", subtitle: "Dentistry · Tempe, AZ", keywords: ["maria@oakline.com"] };

check("a prefix of the name matches", scoreFields(oakline, "oak") > 0);
check("a word inside the name matches", scoreFields(oakline, "dental") > 0);
check("the subtitle matches", scoreFields(oakline, "tempe") > 0);
check("a keyword matches", scoreFields(oakline, "maria") > 0);
check("something absent does not", scoreFields(oakline, "plumbing") === 0);
check("matching is case-insensitive", scoreFields(oakline, "OAKLINE") > 0);

// The all-tokens rule: a second word is there to narrow, so it must narrow.
check("both words must match somewhere", scoreFields(oakline, "oak tempe") > 0);
check("and one word missing means no match at all", scoreFields(oakline, "oak phoenix") === 0);
check(
  "a two-word match outranks a one-word match on the same row",
  scoreFields(oakline, "oak tempe") > scoreFields(oakline, "oak"),
);

// ---------------------------------------------------------------------------
// What wins
// ---------------------------------------------------------------------------

const starts = { title: "Oakline Dental" };
const contains = { title: "Great Oakline Partners" };
const midWord = { title: "Shoakline Services" };
const inSubtitle = { title: "Riverside Plumbing", subtitle: "Oakline Road" };

check("a name starting with the query beats one containing it", scoreFields(starts, "oakline") > scoreFields(contains, "oakline"));
check("a word boundary beats the middle of a word", scoreFields(contains, "oakline") > scoreFields(midWord, "oakline"));
check("the title beats the subtitle", scoreFields(starts, "oakline") > scoreFields(inSubtitle, "oakline"));
check(
  "a keyword never outranks a real name match",
  scoreFields({ title: "Oakline Dental" }, "oakline") >
    scoreFields({ title: "Riverside Plumbing", keywords: ["oakline"] }, "oakline"),
);
// Frequency ranking rewards long text, and long text here is a summary nobody searched for.
check(
  "a name mentioned twice does not beat a shorter name mentioned once",
  scoreFields({ title: "Oakline" }, "oakline") >=
    scoreFields({ title: "Oakline and Oakline Dental Partners of Greater Phoenix" }, "oakline"),
);
check(
  "a shorter title wins a tie",
  scoreFields({ title: "Oakline Dental" }, "oakline") > scoreFields({ title: "Oakline Dental Group of Tempe" }, "oakline"),
);

// ---------------------------------------------------------------------------
// Highlighting
// ---------------------------------------------------------------------------

check("the match is located", JSON.stringify(matchRanges("Oakline Dental", "dental")) === '[{"start":8,"end":14}]');
check("every occurrence is located", matchRanges("Oak oak OAK", "oak").length === 3);
check("both words are located", matchRanges("Oakline of Tempe", "oak tempe").length === 2);
// Without merging, the highlighter would emit nested spans over the same letters.
check(
  "overlapping matches are merged into one range",
  JSON.stringify(matchRanges("Oakline", "oak oakline")) === '[{"start":0,"end":7}]',
);
check("nothing to find is no ranges", matchRanges("Oakline", "zzz").length === 0);
check("an empty query highlights nothing", matchRanges("Oakline", "  ").length === 0);

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

check("there are eight groups", SEARCH_GROUPS.length === 8);
check(
  "in the order an AM looks for things",
  SEARCH_GROUPS.map((group) => group.id).join(",") ===
    "clients,touches,commitments,opportunities,tickets,brief,integrations,pages",
);
check("clients come first", SEARCH_GROUPS[0].id === "clients");
check("pages come last", SEARCH_GROUPS[SEARCH_GROUPS.length - 1].id === "pages");

const mixed = [hit("pages", "Clients", 5), hit("clients", "Oakline", 30), hit("clients", "Oakwood", 12)];
const grouped = groupResults(mixed);
check("groups come back in the contract's order, not the hits'", grouped[0].id === "clients");
check("and the best hit is first inside its group", grouped[0].hits[0].title === "Oakline");
check("an empty group is dropped rather than shown empty", grouped.every((group) => group.hits.length > 0));
check("a group with no hits is absent", !grouped.some((group) => group.id === "touches"));
check("nothing scoring zero is shown", groupResults([hit("clients", "Nope", 0)]).length === 0);

const many = Array.from({ length: 12 }, (_, index) => hit("clients", `Client ${index}`, 20 - index));
const capped = groupResults(many);
check("a group is capped", capped[0].hits.length === GROUP_LIMIT);
check("and says how many more there were", capped[0].more === 12 - GROUP_LIMIT);

// The reason the per-group cap comes before the total cap: 200 clients matching "a" must not
// bury the one page the AM was actually after.
const flood = [
  ...Array.from({ length: 50 }, (_, index) => hit("clients", `Client ${index}`, 50 - index)),
  hit("pages", "Preferences", 1),
];
const floodGroups = groupResults(flood);
check("a flood of one group cannot crowd out another", floodGroups.some((group) => group.id === "pages"));
check("the total stays within one screen", totalHits(floodGroups) <= TOTAL_LIMIT);

// ---------------------------------------------------------------------------
// The pages group
// ---------------------------------------------------------------------------

check("every nav page is searchable", ["/command-center", "/clients", "/monthly-touch", "/calls", "/commitments", "/opportunities", "/qa", "/settings"].every((href) => SEARCH_PAGES.some((page) => page.href === href)));
check("so are the settings screens", SEARCH_PAGES.filter((page) => page.href.startsWith("/settings/")).length === 5);
check("no page is listed twice", new Set(SEARCH_PAGES.map((page) => page.href)).size === SEARCH_PAGES.length);
check("every page says what it is", SEARCH_PAGES.every((page) => page.subtitle.length > 10));
// The words people actually type have to find the screen, not just its official name.
check("'dark mode' finds preferences", bestPage("dark mode") === "/settings/preferences");
check("'time zone' finds preferences", bestPage("time zone") === "/settings/preferences");
check("'permissions' finds integrations", bestPage("permissions") === "/settings/integrations");
check("'overdue' finds commitments", bestPage("overdue") === "/commitments");
check("'upsell' finds opportunities", bestPage("upsell") === "/opportunities");

function bestPage(query: string): string {
  let best = "";
  let top = 0;
  for (const page of SEARCH_PAGES) {
    const score = scoreFields({ title: page.title, subtitle: page.subtitle, keywords: page.keywords }, query);
    if (score > top) {
      top = score;
      best = page.href;
    }
  }
  return best;
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the Firestore reads the endpoint makes, which need a real tenant");
console.log("  - the keyboard behaviour of the palette, which only a browser shows");
if (failed) process.exit(1);
