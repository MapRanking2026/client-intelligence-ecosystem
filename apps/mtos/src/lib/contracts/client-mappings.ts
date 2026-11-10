/**
 * What an account manager pinned to a client by hand, and how every part of MTOS reads it.
 *
 * Automatic name matching cannot win every time, and the failures are mundane: "Belza Painting and
 * Resurfacing" in MTOS against "Belza Painting & Resurfacing" on the listing, a listing whose title
 * carries a city the client's name does not, a sub-account named after the owner, an ad account
 * named after the holding company. The client mapping screen is where the AM settles it, and a pin
 * made there is an instruction, not a hint.
 *
 * ## Why this is its own module
 *
 * Until 10 November 2026 a pin was applied in two places -- the tenant-wide sync, and (from that
 * morning) the per-client refresh that runs at the start of a preparation. Both of them applied it
 * by WRITING `locationsByClient[clientId]` into the provider snapshot, and everything that reads a
 * client's listings read that stored map. So the pin's effect depended on one of those two writes
 * having succeeded:
 *
 *   - the tenant-wide sync walks 227 locations and runs at night;
 *   - the per-client refresh needs a live Google token and a successful API call, and it is
 *     deliberately non-fatal in the preparation -- a refused call leaves the stored snapshot alone
 *     and the preparation carries on.
 *
 * Which means a refused call, an expired token, a quota ceiling or a missing scope silently threw
 * the pin away, and the brief went back to saying "the sync reached 227 locations, but none of them
 * matches this client by name. Pin the right listing on this client's integration mapping" -- to an
 * AM who had pinned it, watched it go green, and re-run the preparation. That was reported twice in
 * one day for the same client.
 *
 * So resolution lives here instead, as pure functions over the snapshot and the client's pins, and
 * every reader resolves rather than inheriting someone else's write. A pin is then in force for the
 * next read, by every screen and every service, whether or not any sync or refresh has run since --
 * which is what the mapping screen has always implied and now actually does.
 *
 * No Firestore, no Google, no React, so the rules are exercised directly by
 * `scripts/check-client-mappings.ts`.
 */

type JsonRecord = Record<string, unknown>;

/**
 * A Business Profile location's bare id, from its `accounts/x/locations/y` resource name.
 *
 * The last path segment, because the snapshot stores the resource name and the mapping screen,
 * the performance rows and the pins all key off the id alone.
 */
export function gbpLocationId(location: JsonRecord): string {
  return String(location.name || "").split("/").filter(Boolean).pop() || "";
}

/**
 * Whether a set of pinned ids names this location.
 *
 * Both forms are accepted: the bare id, which is what the mapping screen stores, and the full
 * resource name, which is what an AM gets if they paste one out of Google's own interface.
 */
export function pinMatchesGbpLocation(pins: Set<string>, location: JsonRecord): boolean {
  const fullName = String(location.name || "");
  const id = gbpLocationId(location);
  return (Boolean(id) && pins.has(id)) || (Boolean(fullName) && pins.has(fullName));
}

export interface ResolvedGbpMapping {
  /** Every location this client should be read as having: pinned first, then auto-matched. */
  locations: JsonRecord[];
  /** The pinned locations that were found in the snapshot. */
  pinned: JsonRecord[];
  /** Locations matched by name that were not also pinned. */
  autoMatched: JsonRecord[];
  /**
   * Pinned ids no sync has ever discovered.
   *
   * Kept and reported rather than silently dropped: it is the difference between "your pin is
   * wrong" and "we lost your pin", and only the first of those is the AM's problem to fix.
   */
  unresolvedPins: string[];
}

/**
 * This client's Business Profile locations, resolved from the snapshot and the client's pins.
 *
 * Three rules, each of them a bug that was reported:
 *
 * **Pins are additive.** A pin adds a listing; it never removes the ones that matched by name. An
 * AM pinning a second location for a two-branch client must not lose the first.
 *
 * **Pins lead.** The per-client refresh is capped at four locations, and the one listing somebody
 * asked for by hand must never be the one that falls off the end of that cap.
 *
 * **A pin for a listing nobody has synced is reported, not invented.** Constructing a location
 * record for it would put an empty listing on the brief, which reads as a client with no Google
 * presence rather than as a snapshot that needs a sync.
 */
export function resolveGbpMapping(options: {
  /** Every location the last sync discovered: `payload.locations`. */
  discovered: JsonRecord[];
  /** What the last sync or refresh computed for this client: `payload.locationsByClient[clientId]`. */
  stored: JsonRecord[];
  /** The ids on the client record: `integrationMappings.googleBusinessProfile`. */
  pinnedIds: string[];
}): ResolvedGbpMapping {
  const pins = new Set(options.pinnedIds.map((id) => String(id || "").trim()).filter(Boolean));
  const stored = options.stored.filter((location) => gbpLocationId(location));
  const storedIds = new Set(stored.map(gbpLocationId));

  if (!pins.size) {
    return { locations: stored, pinned: [], autoMatched: stored, unresolvedPins: [] };
  }

  /*
    Resolved against what the snapshot has discovered, and against what is already stored for this
    client. The second half matters: a pin that a sync has already folded into `locationsByClient`
    is still a pin, and looking only at `discovered` would list it twice.
  */
  const discoveredPinned = options.discovered.filter((location) => pinMatchesGbpLocation(pins, location));
  const storedPinned = stored.filter((location) => pinMatchesGbpLocation(pins, location));

  const pinned: JsonRecord[] = [];
  const seen = new Set<string>();
  // The stored copy of a pinned listing is preferred: it is the one a refresh has resolved account
  // ids onto, and the discovered copy may predate that work.
  for (const location of [...storedPinned, ...discoveredPinned]) {
    const id = gbpLocationId(location);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    pinned.push(location);
  }

  const autoMatched = stored.filter((location) => !seen.has(gbpLocationId(location)));

  const resolvedIds = new Set([
    ...options.discovered.map(gbpLocationId),
    ...options.discovered.map((location) => String(location.name || "")),
    ...storedIds,
    ...stored.map((location) => String(location.name || "")),
  ]);
  const unresolvedPins = [...pins].filter((id) => !resolvedIds.has(id));

  return { locations: [...pinned, ...autoMatched], pinned, autoMatched, unresolvedPins };
}

/**
 * The GoHighLevel sub-account to read for this client.
 *
 * The pin is tried FIRST, ahead of the stored match and the name match: an AM pins a sub-account
 * precisely when the automatic one is wrong, and a pin that loses to the match it was meant to
 * correct is no pin at all. A pin naming a sub-account this agency connection cannot see is
 * ignored, which leaves the stored or name match standing rather than leaving nothing.
 */
export function resolveGhlLocationId(options: {
  pinnedIds: string[];
  /** `payload.locationIndex`: every sub-account the agency connection can see. */
  locationIndex: JsonRecord[];
  storedLocationId?: string;
  nameMatchedId?: string;
}): { locationId: string; source: "pinned" | "stored" | "name" | "none"; unresolvedPins: string[] } {
  const visible = new Set(options.locationIndex.map((entry) => String(entry.id || "")).filter(Boolean));
  const pins = options.pinnedIds.map((id) => String(id || "").trim()).filter(Boolean);
  const pinned = pins.find((id) => visible.has(id));
  const unresolvedPins = pins.filter((id) => !visible.has(id));

  if (pinned) return { locationId: pinned, source: "pinned", unresolvedPins };
  if (options.storedLocationId) {
    return { locationId: options.storedLocationId, source: "stored", unresolvedPins };
  }
  if (options.nameMatchedId) return { locationId: options.nameMatchedId, source: "name", unresolvedPins };
  return { locationId: "", source: "none", unresolvedPins };
}

/**
 * The ad or services accounts to read for this client, for the providers keyed by a flat id:
 * Google Ads, Local Services and Meta Ads.
 *
 * Same two rules as the Business Profile resolver -- pins are additive and pins lead -- over a list
 * of ids rather than a list of records, because those three snapshots store one row per account
 * keyed by its id.
 */
export function resolveAccountIds(options: {
  /** Every account id the connection can see. */
  availableIds: string[];
  /** The ids matched automatically, by name. */
  autoMatchedIds: string[];
  pinnedIds: string[];
}): { ids: string[]; pinned: string[]; unresolvedPins: string[] } {
  const available = new Set(options.availableIds.map((id) => String(id || "").trim()).filter(Boolean));
  const pins = options.pinnedIds.map((id) => String(id || "").trim()).filter(Boolean);
  const pinned = pins.filter((id) => available.has(id));
  const unresolvedPins = pins.filter((id) => !available.has(id));

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of [...pinned, ...options.autoMatchedIds.map((value) => String(value || "").trim())]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { ids, pinned, unresolvedPins };
}

/**
 * The sentence an AM reads when a pin cannot be resolved.
 *
 * Written here so the mapping screen, the preparation's source summary and the brief all say the
 * same thing about the same state. It names the provider's own words for the thing being pinned,
 * because "location" means a Business Profile listing, a GoHighLevel sub-account and an ad account
 * in three different places and the AM is looking at one of them.
 */
export function unresolvedPinNote(options: {
  thing: string;
  unresolvedPins: string[];
  syncLabel: string;
}): string | undefined {
  if (!options.unresolvedPins.length) return undefined;
  const count = options.unresolvedPins.length;
  return `${count} pinned ${options.thing}${count === 1 ? "" : "s"} (${options.unresolvedPins.join(", ")}) ${
    count === 1 ? "is" : "are"
  } not in the stored ${options.syncLabel} snapshot, so ${count === 1 ? "it" : "they"} could not be read. Run a ${options.syncLabel} sync, then re-pin from the list on the mapping screen.`;
}
