import type { LeadCallRecordV1, SortDirection } from "@cie/contracts";

/**
 * Canonical Lead & Call ordering — shared by MTOS and SEOOS so both apps page
 * identically. Apply this server-side BEFORE pagination/cursor.
 *
 * Rules (docs/architecture/mtos-seoos-boundaries.md §2):
 * - Sort by normalized `occurredAt` (newest_first default / oldest_first).
 * - Records with a missing/invalid `occurredAt` always sort AFTER valid ones,
 *   regardless of direction, and surface as a "Date unavailable" state.
 * - Stable secondary sort by canonical record id (ascending) for determinism.
 */

/** Milliseconds since epoch, or `null` when the time is missing/invalid. */
export function normalizeOccurredAt(record: {
  occurredAt: string | null;
}): number | null {
  if (record.occurredAt == null) return null;
  const ms = Date.parse(record.occurredAt);
  return Number.isNaN(ms) ? null : ms;
}

export function compareLeadCallRecords(
  a: LeadCallRecordV1,
  b: LeadCallRecordV1,
  direction: SortDirection,
): number {
  const at = normalizeOccurredAt(a);
  const bt = normalizeOccurredAt(b);

  // Missing/invalid timestamps always sink to the bottom, both directions.
  if (at == null && bt == null) return tieBreak(a, b);
  if (at == null) return 1;
  if (bt == null) return -1;

  if (at !== bt) {
    return direction === "newest_first" ? bt - at : at - bt;
  }
  return tieBreak(a, b);
}

/** Deterministic secondary ordering by canonical id (ascending). */
function tieBreak(a: { id: string }, b: { id: string }): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Returns a new, sorted array; does not mutate the input. */
export function sortLeadCallRecords(
  records: readonly LeadCallRecordV1[],
  direction: SortDirection,
): LeadCallRecordV1[] {
  return [...records].sort((a, b) =>
    compareLeadCallRecords(a, b, direction),
  );
}
