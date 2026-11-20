/**
 * What a page filed in the Client's Book is allowed to say about the tool that wrote it.
 *
 * A Client's Book page is Map Ranking's record of the account. It is read by whoever opens the
 * client in ClickUp, and some of them have never heard of MTOS -- so a brief that says "Not
 * available in MTOS" has told them nothing except that some system they do not use is missing
 * something. The fact worth recording is that the figure is not available.
 *
 * Applied at the write, not at each place the words are chosen. Half of what lands on these pages
 * is written by a model against a prompt nobody here edits, so a rule enforced only where this
 * codebase builds a sentence is a rule that holds for the sentences we wrote and nothing else.
 */

/** The tool's own names, as they turn up in generated prose. */
const PRODUCT = /\bMTOS\b/g;

/**
 * Take the tool's name out of a page.
 *
 * Three passes, because "MTOS" turns up in three grammatical shapes and a single replacement
 * would leave the others reading badly:
 *
 *  - "available in MTOS" is a prepositional phrase whose only job is to name the system. It goes
 *    entirely: "Not available in MTOS." becomes "Not available."
 *  - "MTOS's record" is possessive, and the account's own record is ours.
 *  - anything left is the subject of a sentence -- "MTOS has no record of this" -- where the
 *    honest substitution is the agency whose book this is.
 */
export function withoutProductName(markdown: string): string {
  return (markdown || "")
    .replace(/\s*\b(?:in|on|from|into|within|through|inside)\s+MTOS\b/gi, "")
    .replace(/\bMTOS['’]s\b/g, "our")
    .replace(PRODUCT, "Map Ranking")
    // The phrase removal can leave a doubled space mid-sentence.
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1");
}

/** True when a page still names the tool. The checks ask this; so can a caller. */
export function namesProduct(markdown: string): boolean {
  return /\bMTOS\b/i.test(markdown || "");
}

/**
 * The reporting window every filed page is written against.
 *
 * A monthly touch reviews a month. Evidence older than that belongs to a touch that already
 * happened, and a brief that reaches back to last spring for a scan is comparing the account to
 * a version of itself nobody is discussing.
 */
export const EVIDENCE_WINDOW_DAYS = 30;

/** The one sentence the prompts carry, so the model is asked for this before it is enforced. */
export const EVIDENCE_WINDOW_RULE =
  `Use only evidence from the ${EVIDENCE_WINDOW_DAYS} days before this touch. Do not reach further back for a ` +
  "scan, a report or a figure, and never compare this month against a period outside that window unless the " +
  "source itself names the comparison period. Where there is nothing recent, say the window is empty rather " +
  "than filling it with an older record.";

/** The one sentence that keeps the tool's name off the page. */
export const NO_PRODUCT_NAME_RULE =
  "Never name the internal tooling in what you write. Say \"not available\" or \"no record\", never \"not available in MTOS\".";

/** Whether a record falls inside the window, measured from when the page is being written. */
export function withinWindow(value: unknown, asOf: number, days = EVIDENCE_WINDOW_DAYS): boolean {
  const when = Date.parse(String(value ?? ""));
  if (Number.isNaN(when)) return false;
  // A record dated after the page is being written is kept: a scheduled post or a period that
  // runs to the end of the month is not stale, it is simply ahead of today.
  return when >= asOf - days * 86_400_000;
}
