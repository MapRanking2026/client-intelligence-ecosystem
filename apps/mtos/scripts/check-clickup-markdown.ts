/**
 * Pins the markdown repair that stands between a model-written brief and the Client's Book.
 *
 * ClickUp rejects a whole page over one table row whose column count does not match its header
 * (400 "Invalid table structure"), which is exactly how an approved brief for a real client failed
 * to file on 18 November 2026. Four things here are requirements rather than incidental behaviour:
 *
 *   1. Every row of every table comes out at the header's width. That is the condition ClickUp
 *      actually checks, so it is checked directly rather than through the shape of the output.
 *   2. No text is dropped. A long row is long because the model wrote an unescaped `|` in its own
 *      prose; both halves of that sentence are content the AM reads on the call.
 *   3. Fenced code blocks are left alone. A pipe inside a fence is code, and "repairing" it would
 *      corrupt the one kind of block whose exact characters matter.
 *   4. The flattened fallback keeps every value with its column name, because it is what the AM
 *      gets to read when ClickUp refuses the grid anyway.
 *
 * Run with: npm run check:clickup-markdown
 */
import {
  flattenMarkdownTables,
  isTableStructureError,
  normalizeMarkdownTables,
} from "@/src/lib/server/services/clickup-markdown";

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

/** Every table row's cell count, which is the thing ClickUp refuses the page over. */
function tableWidths(markdown: string): number[][] {
  const widths: number[][] = [];
  let current: number[] | null = null;
  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("|")) {
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).length;
      if (!current) {
        current = [];
        widths.push(current);
      }
      current.push(cells);
      continue;
    }
    current = null;
  }
  return widths;
}

function everyRowMatches(markdown: string): boolean {
  return tableWidths(markdown).every((table) => table.every((width) => width === table[0]));
}

scenario("A row with a stray pipe — the 18 November failure");
{
  const broken = [
    "| Keyword | Rank | Note |",
    "| --- | --- | --- |",
    "| plumber phoenix | 3 | up from 7 | strongest grid |",
    "| drain cleaning | 11 | flat |",
  ].join("\n");
  const fixed = normalizeMarkdownTables(broken);
  check("every row matches the header width", everyRowMatches(fixed), fixed);
  check("the surplus text is kept, not dropped", fixed.includes("strongest grid"), fixed);
  check("the folded pipe is escaped", fixed.includes("\\|"), fixed);
}

scenario("A row short of cells");
{
  const short = ["| Service | Leads |", "| --- | --- |", "| Drain |", "| HVAC | 12 |"].join("\n");
  const fixed = normalizeMarkdownTables(short);
  check("short rows are padded", everyRowMatches(fixed), fixed);
  check("the value that was there survives", fixed.includes("Drain"), fixed);
}

scenario("A separator that disagrees with the header");
{
  const odd = ["| A | B | C |", "| --- | :---: |", "| 1 | 2 | 3 |"].join("\n");
  const fixed = normalizeMarkdownTables(odd);
  check("the separator is rebuilt to the header width", everyRowMatches(fixed), fixed);
  check("alignment the model asked for is kept", fixed.includes(":---:"), fixed);
}

scenario("Tables that are already well formed");
{
  const good = ["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n");
  check("a valid table still has matching rows", everyRowMatches(normalizeMarkdownTables(good)));
  check("prose with a pipe in it is not a table", normalizeMarkdownTables("a | b").trim() === "a | b");
}

scenario("Fenced code is not a table");
{
  const fenced = ["```", "| not | a | table", "```"].join("\n");
  check("the fence is returned unchanged", normalizeMarkdownTables(fenced) === fenced, normalizeMarkdownTables(fenced));
  check("flattening leaves the fence alone", flattenMarkdownTables(fenced) === fenced);
}

scenario("The fallback after ClickUp refuses anyway");
{
  const table = ["| Keyword | Rank |", "| --- | --- |", "| plumber | 3 |", "| drains | 11 |"].join("\n");
  const flat = flattenMarkdownTables(table);
  check("no pipes are left to reject", !flat.includes("|"), flat);
  check("every value keeps its column name", flat.includes("**Keyword:** plumber") && flat.includes("**Rank:** 3"), flat);
  check("every row survives", flat.includes("drains") && flat.includes("11"), flat);
}

scenario("Recognizing ClickUp's own refusal");
{
  check(
    "the 400 that started this is matched",
    isTableStructureError(
      "Invalid Request: Invalid table structure: Table rows have mismatched column counts. Please ensure all rows in your table have the same number of columns.",
    ),
  );
  check("an unrelated refusal is not", !isTableStructureError("Team not authorized"));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  process.exitCode = 1;
}
