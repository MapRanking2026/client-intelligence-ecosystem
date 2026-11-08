/**
 * Whether a sync's result is worse than the snapshot it is about to replace.
 *
 * ## The failure this exists to catch
 *
 * Integration snapshots are tenant-level: one document per provider, written with `.set()` and no
 * merge. Until 8 November 2026 Google Business Profile was a per-user provider, and the nightly job
 * syncs per-user providers once per user, each under their own token. Three people had GBP
 * connected, so three Google accounts took turns overwriting the same document and the last to run
 * won. One of them could see a GBP account holding no locations -- what a personal Google account
 * that is not a member of the agency's location group returns -- so every night it replaced the
 * agency's real listings with an empty set, and every brief, scorecard and GBP panel downstream
 * read blank.
 *
 * Measured on the live tenant, 8 November 2026: `accounts: 1, locations: 0, locationsByClient: 0,
 * performance: 0, profileInsights: 0`, with three users holding valid `business.manage` tokens.
 * Authentication was never the problem.
 *
 * Making GBP a shared provider removes that particular race. This is the general form of the
 * lesson, because the same shape is still open to every other per-user provider: two account
 * managers with different ClickUp or Google Ads access write to one document each night too.
 *
 * ## Why a whole-payload emptiness test was not enough
 *
 * The real GBP payload weighs 1, not 0 -- `accounts` still held an entry. A test for "nothing at
 * all" would have sailed straight past the exact bug it was written for. What actually happened is
 * narrower and more telling: individual keys that had held records went to zero while the document
 * as a whole still looked populated.
 *
 * So there are two findings, with deliberately different consequences:
 *
 *  - **Everything is empty and something was stored before** -> refuse the write. There is no
 *    reading of a completely empty result that makes it better than what it would replace.
 *  - **Some key collapsed from records to none** -> write it, but say so. A key going to zero is
 *    sometimes true (no reviews posted this month), so refusing would freeze a provider on stale
 *    figures forever. Announcing it puts a human in the loop, which is the right place for a
 *    judgement this module cannot make.
 *
 * Stale figures that announce themselves beat correct-looking zeroes nobody questions. That is the
 * whole principle here, and it is the same one the briefs follow when they print a dash rather than
 * a nought.
 */

/** What a comparison found, or `undefined` when nothing looks wrong. */
export interface SnapshotRegression {
  /** Prose for the sync job summary the settings page shows. Not a code. */
  note: string;
  /** True when the write must not happen at all. */
  refuse: boolean;
}

/** How many entries one payload key holds. */
export function keyWeight(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (value && typeof value === "object") {
    return Object.keys(value as object).length;
  }
  return value === undefined || value === null || value === "" ? 0 : 1;
}

/** Entries one level down: array lengths, object key counts, and non-empty scalars. */
export function payloadWeight(payload: unknown): number {
  if (!payload || typeof payload !== "object") {
    return 0;
  }
  let weight = 0;
  for (const value of Object.values(payload as Record<string, unknown>)) {
    weight += keyWeight(value);
  }
  return weight;
}

/**
 * Compare the incoming payload against the stored one.
 *
 * `providerName` is the display name, because the note is read by a person who thinks in
 * "Google Business Profile", not `google-business-profile`.
 */
export function describeSnapshotRegression(
  providerName: string,
  next: unknown,
  stored: unknown,
): SnapshotRegression | undefined {
  const storedWeight = payloadWeight(stored);
  // Nothing worth protecting yet: a first run has to be allowed to write.
  if (storedWeight === 0) {
    return undefined;
  }

  if (payloadWeight(next) === 0) {
    return {
      refuse: true,
      note: `${providerName} returned nothing this run, so the previous snapshot (${storedWeight} record(s)) was kept rather than overwritten with an empty one. Check the connected account can still see the data before trusting the older figures.`,
    };
  }

  if (!next || typeof next !== "object" || !stored || typeof stored !== "object") {
    return undefined;
  }
  const nextRecord = next as Record<string, unknown>;
  const storedRecord = stored as Record<string, unknown>;
  const emptied = Object.keys(storedRecord).filter(
    (key) => keyWeight(storedRecord[key]) > 0 && keyWeight(nextRecord[key]) === 0,
  );
  if (!emptied.length) {
    return undefined;
  }

  return {
    refuse: false,
    note: `${providerName} returned no ${emptied.join(", no ")} this run, where the previous snapshot had some. The connected account may have lost access to them. This run was saved as-is, so anything reading those figures now reads zero.`,
  };
}
