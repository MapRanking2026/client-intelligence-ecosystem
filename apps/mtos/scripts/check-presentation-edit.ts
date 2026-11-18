/**
 * Pins what an account manager may change about a generated deck, and what survives the change.
 *
 * The deck is the client-facing artifact of the whole touch, so hand-editing it is the one place
 * where a convenience could quietly undo a guarantee. Five things are requirements:
 *
 *   1. An edit never widens what the client may see. The visibility filter runs on AM-typed text
 *      exactly as on generated text, and the editor warns BEFORE the call rather than letting a
 *      line vanish between the screen and the deck.
 *   2. A table stays rectangular. A ragged row is a broken slide, a misaligned .pptx column, and
 *      -- when the same text reaches ClickUp -- a 400 that rejects a whole page.
 *   3. Changing layout moves the AM's words instead of dropping them.
 *   4. Fields belonging to another layout do not travel invisibly, so switching away and back
 *      cannot resurrect an old table.
 *   5. Limits hold, because the touch is one Firestore document with a 1MB ceiling.
 *
 * Exercises the pure rules only. The transaction, the snapshot-on-first-edit and the reattached
 * rank capture live in presentation-edit-service and are listed at the end of the run.
 *
 * Run with: npm run check:presentation-edit
 */
import {
  EDIT_LIMITS,
  blankSlide,
  bodyFieldFor,
  clientVisibilityWarnings,
  duplicateSlide,
  editableSlide,
  insertSlide,
  moveSlide,
  normalizeSlide,
  relayoutSlide,
  removeSlide,
  slideIsHiddenFromClient,
  slidesDiffer,
} from "@/src/lib/contracts/presentation-edit";
import type { PresentationSlide } from "@/src/lib/mtos-data";

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

function scenario(name: string) {
  console.log(`\n${name}`);
}

scenario("What the client will not see is said out loud");
{
  const slide: PresentationSlide = {
    layout: "bullets",
    title: "This month",
    bullets: ["Calls up 32% month over month", "We'll fix the schema next week", "Reviews up to 4.8"],
  };
  const warnings = clientVisibilityWarnings(slide);
  check("a line of unfinished work is reported", warnings.some((warning) => warning.scope === "bullets"), JSON.stringify(warnings));
  check("the warning counts it", warnings.some((warning) => warning.detail.startsWith("1 bullet")), JSON.stringify(warnings));
  check(
    "a clean slide warns about nothing",
    clientVisibilityWarnings({ layout: "bullets", title: "This month", bullets: ["Calls up 32%"] }).length === 0,
  );
  check(
    "a named open commitment is caught",
    clientVisibilityWarnings({ layout: "bullets", title: "This month", bullets: ["Rebuild the services page"] }, [
      "Rebuild the services page",
    ]).length > 0,
  );
  check(
    "an internal section is flagged as invisible",
    slideIsHiddenFromClient({ layout: "bullets", sectionId: "7", title: "Internal", bullets: ["Anything"] }),
  );
  check(
    "a status list of unfinished items is flagged",
    clientVisibilityWarnings({
      layout: "status_list",
      title: "Work",
      items: [{ label: "Citations", status: "IN PROGRESS" }, { label: "Photos", status: "COMPLETED" }],
    }).some((warning) => warning.scope === "items"),
  );
}

scenario("A table stays rectangular");
{
  const ragged = normalizeSlide({
    layout: "table",
    title: "Keywords",
    table: { headers: ["Keyword", "Rank", "Change"], rows: [["plumber", "3"], ["drains", "11", "flat", "extra"]] },
  });
  const widths = (ragged.table?.rows || []).map((row) => row.length);
  check("every row matches the header count", widths.every((width) => width === 3), JSON.stringify(ragged.table));
  check("a short row is padded, not dropped", ragged.table?.rows[0]?.[0] === "plumber");
  check("a long row is trimmed to the header", ragged.table?.rows[1]?.length === 3);
  check(
    "an all-empty row is removed",
    normalizeSlide({ layout: "table", title: "T", table: { headers: ["A", "B"], rows: [["", ""], ["x", "y"]] } }).table?.rows
      .length === 1,
  );
}

scenario("Changing layout carries the words across");
{
  const bullets: PresentationSlide = { layout: "bullets", title: "Wins", bullets: ["Calls up", "Reviews up"] };
  const columns = relayoutSlide(bullets, "two_column");
  check("bullets become column items", (columns.columns || []).flatMap((column) => column.items).includes("Calls up"));
  check("the old body is gone", columns.bullets === undefined);
  const back = relayoutSlide(columns, "bullets");
  check("and come back as bullets", (back.bullets || []).includes("Calls up"), JSON.stringify(back.bullets));
  const items = relayoutSlide(bullets, "status_list");
  check("bullets become items", (items.items || []).some((item) => item.label === "Calls up"));
  const table = relayoutSlide(bullets, "table");
  check("and rows of a table", (table.table?.rows || []).some((row) => row[0] === "Calls up"));
  check(
    "a layout with no body for them keeps the title",
    relayoutSlide(bullets, "questions").title === "Wins",
  );
  check(
    "switching away and back does not resurrect the old table",
    relayoutSlide(relayoutSlide({ layout: "table", title: "T", table: { headers: ["A"], rows: [["1"]] } }, "bullets"), "table")
      .table?.rows.length === 1,
  );
}

scenario("Deck-level moves");
{
  const slides: PresentationSlide[] = [
    { layout: "cover", title: "One" },
    { layout: "bullets", title: "Two" },
    { layout: "closing", title: "Three" },
  ];
  check("a slide moves", moveSlide(slides, 0, 2).map((slide) => slide.title).join(",") === "Two,Three,One");
  check("an out-of-range move is ignored", moveSlide(slides, 0, 9) === slides);
  check("a slide is removed", removeSlide(slides, 1).length === 2);
  const duplicated = duplicateSlide(slides, 1);
  check("a duplicate lands directly after", duplicated[2].title === "Two (copy)");
  check(
    "and keeps its pointer at the generated slide",
    duplicateSlide([{ layout: "rank_comparison", title: "K", generatedIndex: 4 }], 0)[1].generatedIndex === 4,
  );
  check("a new slide is inserted where asked", insertSlide(slides, 1, "table")[1].layout === "table");
  check("a new slide of each layout has a body to type into", (["bullets", "stat_callouts", "two_column", "table", "status_list"] as const).every((layout) => {
    const slide = blankSlide(layout);
    const body = bodyFieldFor(layout);
    return body === "bullets" ? Boolean(slide.bullets) : body === "stats" ? Boolean(slide.stats) : body === "columns" ? Boolean(slide.columns) : body === "table" ? Boolean(slide.table) : Boolean(slide.items);
  }));
}

scenario("What may travel back from a browser");
{
  const slide: PresentationSlide = {
    layout: "rank_comparison",
    title: "emergency plumber",
    generatedIndex: 3,
    rankComparison: {
      keyword: "emergency plumber",
      businessId: "b",
      businessName: "Acme",
      address: "1 Main",
      current: { reportId: "r", grid: { keyword: "k", scanDate: "2026-11-01", gridSize: 5, pins: [], averageRankPosition: 4, top3Percent: 1, shareOfLocalVoicePercent: 1, topCompetitors: [] } },
      baselineLabel: "label",
      sameGrid: true,
    },
    edited: true,
    generatedSnapshot: { layout: "rank_comparison", title: "old" },
  };
  const editable = editableSlide(slide);
  check("the rank capture never travels", editable.rankComparison === undefined);
  check("nor the snapshot", editable.generatedSnapshot === undefined);
  check("nor the edited marker", editable.edited === undefined);
  check("the pointer at the generated slide stays", editable.generatedIndex === 3);
  check("an unchanged slide is not treated as edited", !slidesDiffer(slide, { ...slide, edited: false }));
  check("a retitled slide is", slidesDiffer(slide, { ...slide, title: "something else" }));
}

scenario("Limits hold");
{
  const long = "x".repeat(EDIT_LIMITS.title + 50);
  check("the title is capped", normalizeSlide({ layout: "bullets", title: long }).title.length === EDIT_LIMITS.title);
  check(
    "bullets are capped",
    (normalizeSlide({ layout: "bullets", title: "t", bullets: Array.from({ length: 60 }, (_, i) => `line ${i}`) }).bullets || [])
      .length === EDIT_LIMITS.bullets,
  );
  check("empty bullets are dropped", normalizeSlide({ layout: "bullets", title: "t", bullets: ["", "  "] }).bullets === undefined);
  check(
    "a neutral tone is not stored",
    normalizeSlide({ layout: "stat_callouts", title: "t", stats: [{ value: "1", caption: "c", tone: "neutral" }] }).stats?.[0]
      .tone === undefined,
  );
  check(
    "a meaningful tone is",
    normalizeSlide({ layout: "stat_callouts", title: "t", stats: [{ value: "1", caption: "c", tone: "good" }] }).stats?.[0].tone ===
      "good",
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(
  "\nNot covered here (needs Firestore):\n  - the save transaction and its regenerated-deck guard\n  - storing the generated snapshot on a slide's first edit\n  - reattaching the approved rank capture by generatedIndex",
);
if (failures) {
  process.exitCode = 1;
}
