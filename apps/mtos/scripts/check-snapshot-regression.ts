/**
 * The snapshot regression guard, pinned against the payload that actually caused the outage.
 *
 * This suite exists because the first version of this guard was wrong in a way that was invisible
 * by inspection. It tested whether the incoming payload was empty, which reads as obviously
 * correct -- and the Google Business Profile payload that wiped the tenant's data every night was
 * `{accounts: [one], locations: [], locationsByClient: {}, performance: [], profileInsights: []}`,
 * which is not empty. It weighs 1. The guard written for that bug would have let it straight
 * through, and nothing would have told anybody.
 *
 * So the first case below is the real payload, by hand, from the live tenant on 8 November 2026.
 *
 *   npm run --silent check:snapshot-regression
 */
import { describeSnapshotRegression, keyWeight, payloadWeight } from "@/src/lib/contracts/snapshot-regression";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAILED: ${label}`);
  }
}

/** The GBP payload as stored on the live tenant while the feed was broken. */
const BROKEN_GBP = {
  accounts: [{ name: "accounts/123" }],
  locations: [],
  locationsByClient: {},
  performance: [],
  profileInsights: [],
};

/** The same shape as it looks when the connected account can see the listings. */
const HEALTHY_GBP = {
  accounts: [{ name: "accounts/123" }],
  locations: [{ name: "locations/a" }, { name: "locations/b" }],
  locationsByClient: { "client-1": ["locations/a"] },
  performance: [{ locationId: "a" }],
  profileInsights: [{ locationId: "a" }],
};

console.log("\nthe payload that caused the outage");
{
  const found = describeSnapshotRegression("Google Business Profile", BROKEN_GBP, HEALTHY_GBP);
  check("the broken payload is not mistaken for an empty one", payloadWeight(BROKEN_GBP) > 0);
  check("it is still reported as a regression", Boolean(found));
  check("it is saved rather than refused, because a key can legitimately empty", found?.refuse === false);
  check("the note names the locations that vanished", Boolean(found?.note.includes("locations")));
  check("the note names the performance figures too", Boolean(found?.note.includes("performance")));
  check("the note names the provider in words a person uses", Boolean(found?.note.startsWith("Google Business Profile")));
  check(
    "the note says the consequence out loud",
    Boolean(found?.note.includes("reads zero")),
  );
  check("the note points at the likely cause", Boolean(found?.note.includes("lost access")));
}

console.log("\na wholly empty run is refused");
{
  const found = describeSnapshotRegression("Google Business Profile", {}, HEALTHY_GBP);
  check("a regression is reported", Boolean(found));
  check("the write is refused", found?.refuse === true);
  check("the note counts what was kept", Boolean(found?.note.includes("record(s)")));
  check("the note says the old snapshot was kept", Boolean(found?.note.includes("kept")));

  const allKeysEmpty = describeSnapshotRegression(
    "Google Business Profile",
    { accounts: [], locations: [], performance: [] },
    HEALTHY_GBP,
  );
  check("every-key-empty is refused as well", allKeysEmpty?.refuse === true);

  for (const nothing of [undefined, null, "", 0]) {
    const result = describeSnapshotRegression("ClickUp", nothing, HEALTHY_GBP);
    check(`a payload of ${JSON.stringify(nothing)} is refused`, result?.refuse === true);
  }
}

console.log("\na healthy run is left alone");
{
  check(
    "no finding when the payload is unchanged",
    describeSnapshotRegression("Google Business Profile", HEALTHY_GBP, HEALTHY_GBP) === undefined,
  );
  check(
    "no finding when the payload grew",
    describeSnapshotRegression(
      "Google Business Profile",
      { ...HEALTHY_GBP, locations: [{ name: "a" }, { name: "b" }, { name: "c" }] },
      HEALTHY_GBP,
    ) === undefined,
  );
  check(
    "no finding when a count merely fell without reaching zero",
    describeSnapshotRegression(
      "Google Business Profile",
      { ...HEALTHY_GBP, locations: [{ name: "a" }] },
      HEALTHY_GBP,
    ) === undefined,
  );
  check(
    "a new key appearing is not a regression",
    describeSnapshotRegression(
      "Google Business Profile",
      { ...HEALTHY_GBP, reviews: [{ id: "r" }] },
      HEALTHY_GBP,
    ) === undefined,
  );
}

console.log("\nthe first run is always allowed to write");
{
  check(
    "nothing stored means no finding, even for an empty run",
    describeSnapshotRegression("ClickUp", {}, undefined) === undefined,
  );
  check(
    "a stored-but-empty snapshot is not worth protecting",
    describeSnapshotRegression("ClickUp", {}, { tasks: [], lists: {} }) === undefined,
  );
  check(
    "a first real run writes",
    describeSnapshotRegression("ClickUp", { tasks: [{ id: "1" }] }, {}) === undefined,
  );
}

console.log("\nweighing a payload");
{
  check("an array weighs its length", keyWeight([1, 2, 3]) === 3);
  check("an object weighs its key count", keyWeight({ a: 1, b: 2 }) === 2);
  check("an empty array weighs nothing", keyWeight([]) === 0);
  check("an empty object weighs nothing", keyWeight({}) === 0);
  check("null weighs nothing", keyWeight(null) === 0);
  check("undefined weighs nothing", keyWeight(undefined) === 0);
  check("an empty string weighs nothing", keyWeight("") === 0);
  check("a real string weighs one", keyWeight("agency") === 1);
  check("zero weighs one, because zero is a reading", keyWeight(0) === 1);
  check("false weighs one, because false is a reading", keyWeight(false) === 1);
  check("a non-object payload weighs nothing", payloadWeight("nonsense") === 0);
  check("the broken GBP payload weighs exactly one", payloadWeight(BROKEN_GBP) === 1);
  check("the healthy GBP payload weighs more", payloadWeight(HEALTHY_GBP) === 6);
}

console.log("\na per-user provider, which is where this can still happen");
{
  // Two account managers with different ClickUp access, writing to one tenant-level document.
  const fullRoster = { tasks: [{ id: "1" }, { id: "2" }], lists: { "list-a": "Clients" } };
  const noAccess = { tasks: [], lists: {} };
  const found = describeSnapshotRegression("ClickUp", noAccess, fullRoster);
  check("the second manager's empty run is refused", found?.refuse === true);
  check("the note is about ClickUp, not GBP", Boolean(found?.note.startsWith("ClickUp")));
}

console.log(
  [
    "",
    "Not covered by these checks: whether the sync actually calls this before writing (that is",
    "`saveIntegrationSnapshot`), whether the note survives into the stored sync job, whether a",
    "Google account can see a given location group, and whether making GBP a shared provider",
    "really does end the per-user overwrite race -- that one is only visible on the live tenant",
    "after a nightly run.",
    "",
    `${passed} passed, ${failed} failed`,
  ].join("\n"),
);

if (failed) {
  process.exit(1);
}
