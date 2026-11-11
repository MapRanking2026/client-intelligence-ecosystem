/**
 * Pins what a hand-made mapping is worth, which until 10 November 2026 was "nothing until a sync
 * happens to succeed".
 *
 * The owner pinned Belza Painting and Resurfacing's Business Profile listing on the client mapping
 * screen, saw it go green, saved it, re-ran the preparation, and the brief told him none of the 227
 * synced locations matched the client by name. Twice, on the same day, after a fix that honoured the
 * pin in the per-client refresh -- because the refresh applied the pin by WRITING it into the shared
 * snapshot at the end of a live Google read, and every reader read that write. An expired token, a
 * refused scope or a quota ceiling anywhere in that read returned `failed`, wrote nothing, and the
 * pin was gone.
 *
 * Four things here are requirements rather than behaviour that happens to work:
 *
 *   1. Resolution is pure and shared. Every reader -- the preparation, the lead reconciliation, the
 *      per-client refresh, the gap explainer -- resolves a client's mapping from the snapshot plus
 *      the client's pins, so a pin is in force for the next read whether or not anything has synced
 *      since. Nothing inherits another process's write.
 *   2. Pins are additive and pins lead. A pin adds a listing and never removes one that matched by
 *      name, and it comes first, because the per-client refresh is capped at four locations and the
 *      listing somebody asked for by hand must not be the one that falls off the end.
 *   3. A pin naming something nobody has synced is REPORTED, not invented and not silently dropped.
 *      Inventing a record puts an empty listing on a client's brief; dropping it quietly is how an
 *      AM ends up pinning the same listing three times.
 *   4. A pin beats the match it was meant to correct. For GoHighLevel that means the pin is tried
 *      before the stored match and the name match -- a pin that loses to the automatic match is no
 *      pin at all.
 *
 * Exercises the pure rules. What is NOT covered -- the Firestore writes and the live Google and Meta
 * calls -- is listed at the end of the run.
 *
 * Run with: npm run check:client-mappings
 */
import { namesLikelyMatch } from "@/src/lib/server/name-matching";
import { suggestMappingCandidates } from "@/src/lib/contracts/client-mappings";
import {
  gbpLocationId,
  pinMatchesGbpLocation,
  resolveAccountIds,
  resolveGbpMapping,
  resolveGhlLocationId,
  unresolvedPinNote,
} from "@/src/lib/contracts/client-mappings";

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

/** A slim Business Profile location, as the snapshot stores it. */
function location(id: string, title: string) {
  return { name: `accounts/9001/locations/${id}`, title, storeCode: "", websiteUri: "", accountName: "Map Ranking" };
}

const BELZA = location("777", "Belza Painting & Resurfacing");
const OTHER_A = location("111", "Acme Plumbing");
const OTHER_B = location("222", "Northside HVAC");
const DISCOVERED = [OTHER_A, BELZA, OTHER_B];

// ---------------------------------------------------------------------------
scenario("Reading a location's id");

check("the id is the last segment of the resource name", gbpLocationId(BELZA) === "777", gbpLocationId(BELZA));
check("a record with no name has no id", gbpLocationId({}) === "");
check("a bare id pin matches", pinMatchesGbpLocation(new Set(["777"]), BELZA));
check(
  "a full resource name pin matches too, for an AM who pasted one out of Google",
  pinMatchesGbpLocation(new Set(["accounts/9001/locations/777"]), BELZA),
);
check("an unrelated id does not match", !pinMatchesGbpLocation(new Set(["999"]), BELZA));

// ---------------------------------------------------------------------------
scenario("No pins: nothing changes");

const unpinned = resolveGbpMapping({ discovered: DISCOVERED, stored: [OTHER_A], pinnedIds: [] });
check("the stored mapping is returned as it is", unpinned.locations.length === 1 && unpinned.locations[0] === OTHER_A);
check("nothing is reported as pinned", unpinned.pinned.length === 0);
check("and nothing is unresolved", unpinned.unresolvedPins.length === 0);
check(
  "an empty string is not a pin",
  resolveGbpMapping({ discovered: DISCOVERED, stored: [], pinnedIds: ["", "  "] }).unresolvedPins.length === 0,
);

// ---------------------------------------------------------------------------
scenario("The Belza case: pinned, never matched by name, no sync since");

const belza = resolveGbpMapping({ discovered: DISCOVERED, stored: [], pinnedIds: ["777"] });
check("the pinned listing is resolved from what the sync discovered", belza.locations.length === 1);
check("and it is the right one", gbpLocationId(belza.locations[0]) === "777");
check("it is reported as pinned", belza.pinned.length === 1);
check("with nothing unresolved", belza.unresolvedPins.length === 0, belza.unresolvedPins.join(","));
check(
  "this is the whole fix: a pin resolves with an EMPTY stored mapping, so no sync or refresh has to have run",
  resolveGbpMapping({ discovered: DISCOVERED, stored: [], pinnedIds: ["777"] }).locations.length === 1,
);

// ---------------------------------------------------------------------------
scenario("Pins are additive, and pins lead");

const additive = resolveGbpMapping({ discovered: DISCOVERED, stored: [OTHER_A], pinnedIds: ["777"] });
check("the name match is kept", additive.locations.some((entry) => gbpLocationId(entry) === "111"));
check("the pin is added to it", additive.locations.some((entry) => gbpLocationId(entry) === "777"));
check("both are there", additive.locations.length === 2, String(additive.locations.length));
check(
  "the pin comes FIRST, so the refresh cap can never drop it",
  gbpLocationId(additive.locations[0]) === "777",
  gbpLocationId(additive.locations[0]),
);
check("the name match is reported separately from the pin", additive.autoMatched.length === 1);

const alreadyFolded = resolveGbpMapping({ discovered: DISCOVERED, stored: [BELZA, OTHER_A], pinnedIds: ["777"] });
check(
  "a pin a sync has already folded in is not listed twice",
  alreadyFolded.locations.length === 2,
  String(alreadyFolded.locations.length),
);
check("and still leads", gbpLocationId(alreadyFolded.locations[0]) === "777");
check("it is still reported as pinned, not as an automatic match", alreadyFolded.pinned.length === 1);
check(
  "a listing pinned AND matched by name is counted once",
  new Set(alreadyFolded.locations.map(gbpLocationId)).size === alreadyFolded.locations.length,
);

const twoPins = resolveGbpMapping({ discovered: DISCOVERED, stored: [], pinnedIds: ["777", "222"] });
check("two pins both resolve, for a two-branch client", twoPins.locations.length === 2);

// ---------------------------------------------------------------------------
scenario("A pin for something nobody has synced is reported, never invented");

const stale = resolveGbpMapping({ discovered: DISCOVERED, stored: [], pinnedIds: ["404"] });
check("no location record is invented for it", stale.locations.length === 0);
check("it is named, so the AM is told which pin is the problem", stale.unresolvedPins.join(",") === "404");
check(
  "and a real pin beside it still resolves",
  resolveGbpMapping({ discovered: DISCOVERED, stored: [], pinnedIds: ["404", "777"] }).locations.length === 1,
);
check(
  "a pin only present in the stored mapping is not called unresolved",
  resolveGbpMapping({ discovered: [], stored: [BELZA], pinnedIds: ["777"] }).unresolvedPins.length === 0,
);
check(
  "a pin present only in the stored mapping still resolves, so a shrunk snapshot cannot lose it",
  resolveGbpMapping({ discovered: [], stored: [BELZA], pinnedIds: ["777"] }).locations.length === 1,
);

const note = unresolvedPinNote({
  thing: "Business Profile listing",
  unresolvedPins: ["404"],
  syncLabel: "Business Profile",
});
check("the sentence names the pin", Boolean(note && note.includes("404")), note || "(none)");
check("and says what to do about it", Boolean(note && /run a Business Profile sync/i.test(note)), note || "(none)");
check(
  "and does not tell an AM to pin a listing, which is what they already did",
  Boolean(note && !/^Pin /i.test(note)),
  note || "(none)",
);
check(
  "no unresolved pins means no sentence at all",
  unresolvedPinNote({ thing: "x", unresolvedPins: [], syncLabel: "y" }) === undefined,
);
check(
  "two unresolved pins read as plural",
  (unresolvedPinNote({ thing: "listing", unresolvedPins: ["1", "2"], syncLabel: "Business Profile" }) || "").includes(
    "listings",
  ),
);

// ---------------------------------------------------------------------------
scenario("GoHighLevel: the pin beats the match it was meant to correct");

const index = [
  { id: "loc-a", name: "Belza Painting and Resurfacing LLC" },
  { id: "loc-b", name: "Belza Painting" },
  { id: "loc-c", name: "Acme Plumbing" },
];

const pinnedGhl = resolveGhlLocationId({
  pinnedIds: ["loc-b"],
  locationIndex: index,
  storedLocationId: "loc-a",
  nameMatchedId: "loc-a",
});
check("the pin wins over the stored match", pinnedGhl.locationId === "loc-b", pinnedGhl.locationId);
check("and the source says so, for the line the AM reads", pinnedGhl.source === "pinned");

const invisiblePin = resolveGhlLocationId({
  pinnedIds: ["loc-z"],
  locationIndex: index,
  storedLocationId: "loc-a",
});
check(
  "a pin this agency connection cannot see leaves the stored match standing rather than nothing",
  invisiblePin.locationId === "loc-a" && invisiblePin.source === "stored",
);
check("and the unreachable pin is reported", invisiblePin.unresolvedPins.join(",") === "loc-z");

check(
  "with no pin and no stored match, the name match is used",
  resolveGhlLocationId({ pinnedIds: [], locationIndex: index, nameMatchedId: "loc-c" }).source === "name",
);
check(
  "with nothing at all there is no sub-account, and it says so rather than guessing",
  resolveGhlLocationId({ pinnedIds: [], locationIndex: index }).source === "none",
);
check(
  "and no id is returned in that case",
  resolveGhlLocationId({ pinnedIds: [], locationIndex: index }).locationId === "",
);

// ---------------------------------------------------------------------------
scenario("Ad accounts: Google Ads, Local Services and Meta");

const ads = resolveAccountIds({
  availableIds: ["act-1", "act-2", "act-3"],
  autoMatchedIds: ["act-1"],
  pinnedIds: ["act-3"],
});
check("the pin leads", ads.ids[0] === "act-3", ads.ids.join(","));
check("the name match is kept behind it", ads.ids.includes("act-1"));
check("both are there", ads.ids.length === 2, ads.ids.join(","));
check(
  "a pin that is also the name match is counted once",
  resolveAccountIds({ availableIds: ["act-1"], autoMatchedIds: ["act-1"], pinnedIds: ["act-1"] }).ids.length === 1,
);
check(
  "a pin for an account this token cannot see is reported, not used",
  (() => {
    const resolved = resolveAccountIds({
      availableIds: ["act-1"],
      autoMatchedIds: ["act-1"],
      pinnedIds: ["act-9"],
    });
    return resolved.ids.join(",") === "act-1" && resolved.unresolvedPins.join(",") === "act-9";
  })(),
);
check(
  "no account anywhere gives an empty list rather than a guess",
  resolveAccountIds({ availableIds: [], autoMatchedIds: [], pinnedIds: [] }).ids.length === 0,
);

// ---------------------------------------------------------------------------
scenario("Matching a client to a vendor's name: & is the word and");

check(
  "the Belza case: & on one side, the word on the other",
  namesLikelyMatch("Belza Painting & Resurfacing", "Belza Painting and Resurfacing"),
);
check("and the other way round", namesLikelyMatch("Exact Rooter and Plumbing", "Exact Rooter & Plumbing"));
check("identical names still match", namesLikelyMatch("Arrow Waste", "Arrow Waste"));
check("a legal suffix is still noise", namesLikelyMatch("D & M Towing LLC", "D and M Towing"));
check(
  "extra words after the name are still a match",
  namesLikelyMatch("Quality Fence and Custom Outdoors", "Quality Fence & Custom Outdoors"),
);
check(
  "a city tacked onto the listing does not break it",
  namesLikelyMatch("Esmeralda's 2.0 Mexican Restaurant", "Esmeralda's 2.0 The Best Mexican Restaurant In Eureka"),
);

check(
  "a shared trade word is NOT a match -- half the book is a plumbing company",
  !namesLikelyMatch("Belza Painting", "Acme Painting"),
);
/*
  The identifying-word rule requires the leading word to match, so it alone would refuse a generic
  tail claiming a named business.

  The rule BEFORE it does not, and these two record that honestly rather than asserting a guard the
  function as a whole does not have: the older substring rule matches whenever one normalized name
  contains the other and the shorter is six characters or more, so "Painting Services" still finds
  "Belza Painting Services" through that path.

  It is a real hazard and it predates this work. On the live tenant it is why the two Eagle
  Transmission franchises -- "Colleyville - Eagle Transmission & Auto Repair" and "Parker - Eagle
  Transmission & Auto Repair" -- each claim both of the "Eagle Transmission & Auto Repair" listings:
  the listing's title is a substring of both client names. Measured there before this change:
  5 listings claimed by more than one client.

  Not tightened here on purpose. 93 of the 243 clients' matches come through that substring rule,
  and narrowing it the day before a round of calls would silently take listings away from clients
  that currently resolve. Pinning is the fix for a contested listing, and pinning now works.
*/
check(
  "the older substring rule still lets a generic tail match, which is a known hazard",
  namesLikelyMatch("Painting Services", "Belza Painting Services"),
);
check(
  "and lets a single long word match, for the same reason",
  namesLikelyMatch("Roofing", "Mighty Dog Roofing"),
);
check(
  "a short single word does not, because the substring rule needs six characters",
  !namesLikelyMatch("Roof", "Mighty Dog Roofing"),
);
check("an empty name matches nothing", !namesLikelyMatch("", "Belza Painting"));
check("and nothing matches an empty name", !namesLikelyMatch("Belza Painting", ""));
check(
  "two different businesses sharing two words do not match",
  !namesLikelyMatch("Northside Heating and Air", "Southside Heating and Air"),
);

// ---------------------------------------------------------------------------
scenario("Suggesting a pin, when nothing matched");

/*
  Every name below is a real pair from the live tenant on 10 November 2026, taken from the 141
  clients that had no Business Profile listing. The point of the ranking is that the good ones and
  the bad ones are both offered and are visibly different -- a suggestion is a shortlist entry, not
  a match, and the only thing that acts on it is a person clicking it.
*/
const LISTINGS = [
  { id: "l1", label: "Law Office of Roberto Alvarez, APC", detail: "" },
  { id: "l2", label: "Castro's Hardscape & Masonry", detail: "" },
  { id: "l3", label: "M M garage door services", detail: "" },
  { id: "l4", label: "Naturally Clean", detail: "" },
  { id: "l5", label: "HLI Tree Services", detail: "" },
  { id: "l6", label: "Belza Painting and Resurfacing", detail: "" },
];

const forAlvarez = suggestMappingCandidates({ clientName: "Roberto Alvarez Law", candidates: LISTINGS });
check("the right listing is offered", forAlvarez.some((entry) => entry.id === "l1"), forAlvarez.map((e) => e.label).join(" | "));
check("and it is first", forAlvarez[0]?.id === "l1", forAlvarez[0]?.label);
check("it is ranked as likely rather than weak", (forAlvarez[0]?.score ?? 0) >= 70, String(forAlvarez[0]?.score));
check("and it says why", (forAlvarez[0]?.why || "").length > 20, forAlvarez[0]?.why);

const forCastro = suggestMappingCandidates({ clientName: "Castro's Harscapes and Masonry", candidates: LISTINGS });
check(
  "a typo on our side still surfaces the listing",
  forCastro[0]?.id === "l2",
  forCastro.map((entry) => entry.label).join(" | "),
);

const forHli = suggestMappingCandidates({ clientName: "Hli Tree Sevices", candidates: LISTINGS });
check("a misspelt client name finds its listing", forHli[0]?.id === "l5", forHli[0]?.label);

/*
  The case that decides this is suggestions and not matching. Three different garage-door clients
  all had "M M garage door services" as their single closest candidate, so a rule that matched on
  this evidence would hand one client another company's reviews.
*/
const forGarage = suggestMappingCandidates({ clientName: "Master Pro Garage Door", candidates: LISTINGS });
check(
  "a trade-word-only overlap is NOT offered as likely",
  (forGarage[0]?.score ?? 0) < 70,
  `${forGarage[0]?.label} scored ${forGarage[0]?.score}`,
);
check(
  "the words that merely say what the business does carry no weight on their own",
  forGarage.every((entry) => entry.score < 45),
  forGarage.map((entry) => `${entry.label}:${entry.score}`).join(" | "),
);
check(
  "an unrelated business is not offered at all",
  !suggestMappingCandidates({ clientName: "Clean Group", candidates: LISTINGS }).some(
    (entry) => entry.id === "l4" && entry.score >= 45,
  ),
);

check(
  "something already matched is not suggested again",
  !suggestMappingCandidates({
    clientName: "Roberto Alvarez Law",
    candidates: LISTINGS,
    excludeIds: ["l1"],
  }).some((entry) => entry.id === "l1"),
);
check(
  "a pinned listing is not suggested again either",
  !suggestMappingCandidates({
    clientName: "Belza Painting & Resurfacing",
    candidates: LISTINGS,
    excludeIds: ["l6"],
  }).some((entry) => entry.id === "l6"),
);
check(
  "the Belza listing is the top suggestion when it is not yet pinned",
  suggestMappingCandidates({ clientName: "Belza Painting & Resurfacing", candidates: LISTINGS })[0]?.id === "l6",
);
check(
  "the list is capped so the screen stays a shortlist",
  suggestMappingCandidates({ clientName: "Belza Painting", candidates: LISTINGS, limit: 2 }).length <= 2,
);
check("an empty client name suggests nothing", suggestMappingCandidates({ clientName: "", candidates: LISTINGS }).length === 0);
check("no candidates suggests nothing", suggestMappingCandidates({ clientName: "Anything", candidates: [] }).length === 0);
check(
  "suggestions come back in descending order",
  (() => {
    const scores = suggestMappingCandidates({ clientName: "Belza Painting & Resurfacing", candidates: LISTINGS }).map(
      (entry) => entry.score,
    );
    return scores.every((score, index) => index === 0 || scores[index - 1] >= score);
  })(),
);

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures} of ${checks} checks passed.`);
console.log(
  [
    "",
    "Not covered here (needs Firestore, Google and Meta, so it is checked by hand against a real",
    "client):",
    "  - `refreshGbpInsightsForClient` writing the resolved mapping BEFORE it asks Google anything,",
    "    which is what stops a refused call from discarding a pin that was already saved",
    "  - `saveClientMappings` folding the pin into the shared snapshot on Save, so the pin is",
    "    visible to any future reader and not only to the ones that resolve",
    "  - the Meta Ads sync itself: `/me/adaccounts` paging, the `/insights` call, and leads being",
    "    summed across the three action types Meta reports a lead under",
    "  - that an account Meta refuses is stored as the refusal rather than as zero spend",
    "  - of the 141 clients on the live tenant with no Business Profile listing, 83 share no",
    "    distinguishing word with any unclaimed listing: their listing is not in the accounts MTOS",
    "    is connected to, which is a connection or a pin to add rather than a rule to loosen",
    "  - whether a suggestion is RIGHT. It is a shortlist entry; the only thing that acts on one is",
    "    an account manager clicking it",
  ].join("\n"),
);

if (failures > 0) {
  process.exitCode = 1;
}
