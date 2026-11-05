/**
 * One date label for every QC screen, and the day-shift bug it exists to stop.
 *
 * A touch's `date` is a calendar day: `"2026-07-03"`. `new Date("2026-07-03")` parses that as
 * midnight **UTC**, and `Intl.DateTimeFormat` then renders it in the viewer's zone -- so for
 * anyone west of UTC it comes out as 2 July. Every account manager and reviewer at this company is
 * in the Americas, which means the naive version of this function was showing the wrong day on
 * every row of the queue, the scoring screen, the AM's history and their chart.
 *
 * Measured on 2026-11-05 in America/Tijuana: `"2026-04-03"` rendered as "Apr 2, 2026".
 *
 * The fix is to format a date-only value in UTC, where it was never a time of day to begin with. A
 * full timestamp -- `scoredAt`, `submittedAt`, anything with a `T` in it -- is a real instant and
 * is still rendered in the viewer's own zone, which is what they want for "scored Jul 12".
 *
 * This matters more than a cosmetic off-by-one. These labels appear beside a score, in an appeal,
 * and in "sent Jul 10" on a record two people are disagreeing about. A date that does not match
 * the calendar invite is a reason to doubt everything next to it.
 */

/** A bare calendar day, with no time and no zone. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Jul 3, 2026", or "no date" when there is nothing readable.
 *
 * Never throws and never renders "Invalid Date": an unreadable value says so in words, because a
 * screen that shows "Invalid Date" beside somebody's score looks broken in a way that makes the
 * score itself untrustworthy.
 */
export function qcDateLabel(iso: string | undefined): string {
  if (!iso) return "no date";
  const trimmed = iso.trim();
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return "no date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    // Only for a calendar day. A timestamp stays in the reader's own zone.
    ...(DATE_ONLY.test(trimmed) ? { timeZone: "UTC" } : {}),
  }).format(date);
}
