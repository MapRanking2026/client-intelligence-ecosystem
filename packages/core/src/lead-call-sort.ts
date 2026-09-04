import type { LeadCallRecordV1, SortDirection } from "@cie/contracts";

/**
 * Canonical Lead & Call ordering — shared by MTOS and SEOOS so both apps page
 * identically. Apply this server-side BEFORE pagination/cursor.
 *
 * Rules (docs/architecture/mtos-seoos-boundaries.md §2):
 * - Sort by a normalized event time (newest_first default / oldest_first).
 * - Records with a missing/invalid time always sort AFTER valid ones,
 *   regardless of direction, and surface as a "Date unavailable" state.
 * - Stable secondary sort by canonical record id (ascending) for determinism.
 *
 * The comparator reads only `{ id, occurredAt }`, so any app record type can be
 * ordered by projecting to that key — MTOS `VerifiedLead`, the canonical
 * `LeadCallRecordV1`, or anything else.
 */

/** The minimal projection the canonical ordering needs. */
export interface OccurredAtKey {
  id: string;
  /** ISO-8601 event time, or null when missing/unknown. */
  occurredAt: string | null;
}

/** Milliseconds since epoch, or `null` when the time is missing/invalid. */
export function normalizeOccurredAt(occurredAt: string | null): number | null {
  if (occurredAt == null) return null;
  const ms = Date.parse(occurredAt);
  return Number.isNaN(ms) ? null : ms;
}

export function compareByOccurredAt(
  a: OccurredAtKey,
  b: OccurredAtKey,
  direction: SortDirection,
): number {
  const at = normalizeOccurredAt(a.occurredAt);
  const bt = normalizeOccurredAt(b.occurredAt);

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

/**
 * Order any list by the canonical rule via a key projection. Returns a new
 * array; does not mutate the input.
 */
export function orderByOccurredAt<T>(
  items: readonly T[],
  direction: SortDirection,
  selectKey: (item: T) => OccurredAtKey,
): T[] {
  return [...items].sort((a, b) =>
    compareByOccurredAt(selectKey(a), selectKey(b), direction),
  );
}

/** Canonical ordering for `LeadCallRecordV1` values (identity projection). */
export function sortLeadCallRecords(
  records: readonly LeadCallRecordV1[],
  direction: SortDirection,
): LeadCallRecordV1[] {
  return orderByOccurredAt(records, direction, (r) => ({
    id: r.id,
    occurredAt: r.occurredAt,
  }));
}
