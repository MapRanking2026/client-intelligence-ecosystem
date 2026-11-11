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
 * Words that carry no identity, so two names differing only by these are the same name.
 *
 * Deliberately a copy of the list in `server/name-matching` rather than an import: this module is
 * a contract and is read by client components, and `server/name-matching` is server-side. The two
 * lists are small, and `check:client-mappings` exercises both behaviours against the same examples.
 */
const IDENTITY_FREE_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "co",
  "corp",
  "dba",
  "for",
  "in",
  "inc",
  "llc",
  "ltd",
  "of",
  "on",
  "the",
  "to",
  "usa",
  "with",
]);

/**
 * A business name as its identifying words.
 *
 * `&` is read as the word `and` and then dropped with the other words that carry no identity.
 *
 * Accents are folded first, and that is a correctness fix rather than tidiness: stripping
 * non-ASCII straight away turned "Éden 3D Québec" into the words "den" and "bec", so a Québec
 * client was being compared on the wrong end of its own name -- and the suggestion ranking proudly
 * reported that the two shared "den and bec, which almost nothing else here uses". Map Ranking's
 * book has French and Spanish names in it, and they have to fold to the same letters the vendor's
 * listing folds to.
 */
function identityWords(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !IDENTITY_FREE_WORDS.has(word));
}

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

// ---------------------------------------------------------------------------
// Suggesting a pin
// ---------------------------------------------------------------------------

/**
 * Words that say what a business does rather than which business it is.
 *
 * Used ONLY to rank suggestions, never to decide a match. That distinction is the whole safety
 * argument for this list existing: half of Map Ranking's book is a "Plumbing" or a "Roofing", so a
 * rule that matched on a shared trade word would hand one client another client's numbers. A
 * suggestion that shares only a trade word is ranked near the bottom and says so, and a human
 * either clicks it or does not.
 */
const TRADE_WORDS = new Set([
  "air",
  "clean",
  "cleaning",
  "company",
  "construction",
  "contracting",
  "contractors",
  "cooling",
  "door",
  "doors",
  "electric",
  "electrical",
  "garage",
  "group",
  "heating",
  "hvac",
  "landscaping",
  "law",
  "painting",
  "plumbing",
  "pro",
  "pros",
  "remodeling",
  "repair",
  "restoration",
  "roofing",
  "service",
  "services",
  "solutions",
]);

/** The words that say WHICH business this is: no conjunctions, no legal suffix, no trade. */
function distinguishingWords(value: string): string[] {
  return identityWords(value).filter((word) => !TRADE_WORDS.has(word) && word.length > 2);
}

export interface MappingSuggestion {
  id: string;
  label: string;
  detail: string;
  /** 0-100. Only a human acts on it, so the number is a sort order and an honesty signal. */
  score: number;
  /** Why this is being suggested, in the AM's words, so a bad suggestion is visibly bad. */
  why: string;
}

/**
 * Candidates worth offering an account manager as a pin, best first.
 *
 * ## Why suggestions rather than more matching
 *
 * Measured on the live tenant, 10 November 2026: 141 of 243 clients had no Business Profile
 * listing, and 102 of the 227 synced listings were claimed by nobody. It is tempting to read that
 * as a matching problem and loosen the rule until the two sets meet. Doing it on the real data
 * showed what that costs: "M M garage door services" became the single best candidate for three
 * different garage-door clients, and "Clean Group" for "Naturally Clean". A wrong listing on a
 * brief is worse than no listing -- the AM walks into a call and presents another company's
 * reviews -- so the matcher stays conservative and the guessing is moved to where a human sees it
 * before it counts.
 *
 * Of those 141, around fifteen have a findable listing in the snapshot under a name no rule should
 * match automatically ("Roberto Alvarez Law" against "Law Office of Roberto Alvarez, APC",
 * "Castro's Harscapes and Masonry" against "Castro's Hardscape & Masonry" -- a typo on our side).
 * Those are one click each once they are offered. The other 83 share no distinguishing word with
 * any unclaimed listing, which is not a naming problem: their listing is not in the accounts MTOS
 * is connected to, and nothing here can invent it.
 *
 * Nothing in this function can change what a brief reports. It orders a list.
 */
export function suggestMappingCandidates(options: {
  clientName: string;
  candidates: { id: string; label: string; detail: string }[];
  /** Already matched automatically or already pinned, so not worth suggesting again. */
  excludeIds?: string[];
  limit?: number;
}): MappingSuggestion[] {
  const exclude = new Set((options.excludeIds || []).filter(Boolean));
  const clientWords = distinguishingWords(options.clientName);
  const clientNormalized = identityWords(options.clientName).join(" ");
  if (!clientNormalized) return [];

  /*
    How many of the candidates use each word, so a word can be weighed rather than counted.

    The trade-word list below cannot keep up on its own: it had "roofing" and "plumbing" and not
    "garage", and the first run against the live tenant duly labelled "M M garage door services" a
    likely match for "Master Pro Garage Door". A hand-maintained list of what every trade calls
    itself is a list that is always one tenant behind.

    The candidate list is its own corpus and answers the question directly: a word that appears in
    one or two of the 227 listings identifies a business, and a word that appears in nine does not,
    whatever anybody thinks the word means. It also adapts per tenant for free -- a book full of
    plumbers devalues "plumbing" without anybody editing a list.
  */
  const wordFrequency = new Map<string, number>();
  for (const candidate of options.candidates) {
    for (const word of new Set(identityWords(candidate.label))) {
      wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
    }
  }
  /** A word few listings use: evidence that two names are the same business. */
  const identifies = (word: string) => (wordFrequency.get(word) || 0) <= 2;

  const scored: MappingSuggestion[] = [];
  for (const candidate of options.candidates) {
    if (!candidate.id || exclude.has(candidate.id)) continue;

    const candidateWords = distinguishingWords(candidate.label);
    const candidateNormalized = identityWords(candidate.label).join(" ");
    if (!candidateNormalized) continue;

    let score = 0;
    let why = "";

    if (candidateNormalized === clientNormalized) {
      score = 100;
      why = "The names are the same once punctuation and “and” are set aside.";
    } else if (clientWords.length && candidateWords.length) {
      /*
        Both names have to contribute a word that identifies a business, and they have to share one.

        This is the guard, and it is the difference between a shortlist and a liability. Without it
        "Master Pro Garage Door" and "M M garage door services" share every word either of them has
        left -- garage, door -- and the second became the single best candidate for three different
        garage-door clients on the live tenant. Trade words say what a business does; two businesses
        doing the same thing is not evidence that they are the same business.

        A candidate with no identifying word of its own is therefore never offered at all, however
        many trade words it shares.
      */
      const [shorter, longer] =
        clientWords.length <= candidateWords.length ? [clientWords, candidateWords] : [candidateWords, clientWords];
      const longerWords = new Set(longer);
      const shared = shorter.filter((word) => longerWords.has(word));
      const identifying = shared.filter(identifies);
      const whole = shared.length === shorter.length;

      if (identifying.length >= 2) {
        score = 85;
        why = `Shares ${identifying.join(" and ")}, which almost nothing else here uses.`;
      } else if (identifying.length === 1 && whole) {
        score = 70;
        why = `Shares “${identifying[0]}”, which almost nothing else here uses, and every other distinguishing word of the shorter name.`;
      } else if (identifying.length === 1) {
        score = 50;
        why = `Shares “${identifying[0]}”, which almost nothing else here uses, but the rest of the name differs.`;
      } else if (shared.length >= 2) {
        score = 30;
        why = `Shares ${shared.join(", ")} — words a lot of these names use, so check it.`;
      }
    }

    if (score >= 30) {
      scored.push({ id: candidate.id, label: candidate.label, detail: candidate.detail, score, why });
    }
  }

  return scored
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .slice(0, options.limit ?? 5);
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
