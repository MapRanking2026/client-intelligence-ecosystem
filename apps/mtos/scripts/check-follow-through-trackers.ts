/**
 * The three tracker rows a touch updates, and what counts as a change to one.
 *
 * Pure checks: no ClickUp, no Firestore. The diff is the part worth pinning -- it is the only
 * thing standing between an AM and a silent overwrite of a live row that someone who was not on
 * the call relies on.
 */
import {
  CASE_STATUS_VALUES,
  COMMUNICATION_TYPES,
  HEALTH_TRACKER_FIELDS,
  HEALTH_VALUES,
  RISK_REGISTER_FIELDS,
  STAKEHOLDER_FIELDS,
  UPSELLING_VALUES,
  cardLabel,
  changeCount,
  diffRow,
  healthFromScore,
  renderValue,
  trackerBlockers,
  withDerivedRiskFields,
  type HealthTrackerRow,
  type TrackerCard,
} from "@/src/lib/contracts/follow-through-trackers";
import { healthFromNps } from "@/src/lib/contracts/post-meeting-review";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAILED: ${label}`);
}

// ---------------------------------------------------------------------------
// The Health field's mapping, and the disagreement it is part of
// ---------------------------------------------------------------------------

check("7 and above is Good", healthFromScore(7) === "Good" && healthFromScore(10) === "Good");
check("5 and 6 are Neutral", healthFromScore(5) === "Neutral" && healthFromScore(6) === "Neutral");
check("4 and below is Risk", healthFromScore(4) === "Risk" && healthFromScore(1) === "Risk");
check("no score sets nothing", healthFromScore(null) === undefined && healthFromScore(undefined) === undefined);

// Both mappings are in the codebase on purpose and they disagree. This check exists so the
// disagreement is visible in a run rather than discovered on a client's row a year from now.
check(
  "the handoff's mapping and the existing review's mapping still differ at 7 and at 8",
  healthFromScore(7) === "Good" && healthFromNps(7) === "Neutral" && healthFromScore(8) !== healthFromNps(8),
);
check("they agree at the top", healthFromScore(10) === healthFromNps(10));
check("and at the bottom", healthFromScore(3) === healthFromNps(3));

// ---------------------------------------------------------------------------
// The field lists
// ---------------------------------------------------------------------------

check("the Health Tracker row has sixteen fields", HEALTH_TRACKER_FIELDS.length === 16);
check("NPS is read-only on it", HEALTH_TRACKER_FIELDS.find((f) => f.key === "nps")?.kind === "readonly");
check("Services is a multi-select", HEALTH_TRACKER_FIELDS.find((f) => f.key === "services")?.kind === "multi");
check("Case Status offers the em dash as a real option", CASE_STATUS_VALUES[0] === "—");
check("Upselling keeps its exclamation mark", UPSELLING_VALUES.includes("Yes!"));
check("Communication Type has three values", COMMUNICATION_TYPES.length === 3);
check("Health has three values", HEALTH_VALUES.length === 3);

check("Risk Score is read-only", RISK_REGISTER_FIELDS.find((f) => f.key === "riskScore")?.kind === "readonly");
check(
  "the six threat fields are all on the register card",
  ["money", "responsiveness", "lifeChange", "technical", "otherAgency", "performance"].every((key) =>
    RISK_REGISTER_FIELDS.some((field) => field.key === key),
  ),
);
check(
  "Life Change offers 'maybe' and Other Agency offers 'kind of'",
  RISK_REGISTER_FIELDS.find((f) => f.key === "lifeChange")?.options?.includes("maybe") === true &&
    RISK_REGISTER_FIELDS.find((f) => f.key === "otherAgency")?.options?.includes("kind of") === true,
);
check("the stakeholder card has ten fields", STAKEHOLDER_FIELDS.length === 10);
check(
  "including the four communication preferences",
  STAKEHOLDER_FIELDS.find((f) => f.key === "communicationPreference")?.options?.length === 4,
);
check(
  "every field is labelled as ClickUp labels it",
  [...HEALTH_TRACKER_FIELDS, ...RISK_REGISTER_FIELDS, ...STAKEHOLDER_FIELDS].every(
    (field) => field.label.length > 0 && field.label[0] === field.label[0].toUpperCase(),
  ),
);

// ---------------------------------------------------------------------------
// Rendering a value for comparison
// ---------------------------------------------------------------------------

check("nothing renders as nothing", renderValue(undefined) === "" && renderValue(null) === "" && renderValue("") === "");
check("a number renders", renderValue(8) === "8");
check("zero renders rather than vanishing", renderValue(0) === "0");
check("a list renders joined", renderValue(["SEO", "Ads"]) === "Ads, SEO");
check("a list renders sorted, so reordering is not a change", renderValue(["Ads", "SEO"]) === renderValue(["SEO", "Ads"]));
check("blanks in a list are dropped", renderValue(["SEO", "  ", ""]) === "SEO");
check("surrounding space is not a change", renderValue("  Good  ") === "Good");

// ---------------------------------------------------------------------------
// The diff
// ---------------------------------------------------------------------------

const current: Partial<HealthTrackerRow> = {
  clientName: "Oakline Dental",
  health: "Good",
  mrr: "$2,400",
  services: ["SEO", "Map Check-ins"],
};
const next: Partial<HealthTrackerRow> = {
  clientName: "Oakline Dental",
  health: "Neutral",
  mrr: "$2,400",
  services: ["Map Check-ins", "SEO"],
  latestComment: "She raised the invoice timing.",
};

const diffs = diffRow(current, next, HEALTH_TRACKER_FIELDS);
const byKey = Object.fromEntries(diffs.map((diff) => [diff.key, diff]));

check("an unchanged field is not a change", !byKey.clientName.changed);
check("a changed field is", byKey.health.changed);
check("and carries what it was", byKey.health.was === "Good" && byKey.health.now === "Neutral");
check("a reordered list is not a change", !byKey.services.changed);
check("an identical value is not a change", !byKey.mrr.changed);

// Filling a blank is not overwriting an answer, and must not be reported as one.
check("filling an empty field is new, not changed", byKey.latestComment.isNew && !byKey.latestComment.changed);
check("an empty field that stays empty is neither", !byKey.email.changed && !byKey.email.isNew);

const counts = changeCount(diffs);
check("the counter counts changes", counts.changed === 1);
check("and additions separately", counts.added === 1);

const fromNothing = diffRow(undefined, next, HEALTH_TRACKER_FIELDS);
check("with no current row everything filled is new", changeCount(fromNothing).added === 5);
check("and nothing is a change", changeCount(fromNothing).changed === 0);

// ---------------------------------------------------------------------------
// Derived risk fields
// ---------------------------------------------------------------------------

const derived = withDerivedRiskFields({ money: "Yes", performance: "Yes", responsiveness: "No" });
check("the risk score is the count of Yes", derived.riskScore === 2);
check("an explicit No is answered, not a flag", derived.riskScore === 2);
check("the tier follows the count", derived.riskTier === "Medium");
check("no flags is Healthy", withDerivedRiskFields({}).riskTier === "Healthy");
check(
  "a screen-supplied score is overwritten rather than trusted",
  withDerivedRiskFields({ money: "Yes", riskScore: 6 }).riskScore === 1,
);

// ---------------------------------------------------------------------------
// What blocks the cards
// ---------------------------------------------------------------------------

const healthCard: TrackerCard = { id: "health", kind: "health", current, next };
const emptyCard: TrackerCard = { id: "health", kind: "health", current, next: current };

check("no cards block nothing", trackerBlockers([], {}).length === 0);
check(
  "an undecided card blocks",
  trackerBlockers([healthCard], { health: diffs })[0].includes("Decide the remaining tracker card"),
);
check("a denied card is decided", trackerBlockers([{ ...healthCard, decision: "denied" }], { health: diffs }).length === 0);
check(
  "an approved card with changes goes through",
  trackerBlockers([{ ...healthCard, decision: "approved" }], { health: diffs }).length === 0,
);

// Writing to a live row for no reason is the thing this stops.
const noChangeDiffs = diffRow(current, current, HEALTH_TRACKER_FIELDS);
const emptyBlockers = trackerBlockers([{ ...emptyCard, decision: "approved" }], { health: noChangeDiffs });
check("an approved card that changes nothing blocks", emptyBlockers.length === 1);
check("and says to deny it instead", emptyBlockers[0].includes("Deny it"));
check(
  "a brand-new row is allowed to be approved even when it looks empty",
  trackerBlockers([{ ...emptyCard, decision: "approved", isNewRow: true }], { health: noChangeDiffs }).length === 0,
);

check("the health card is named as the tracker names it", cardLabel(healthCard) === "Client Health Tracker row");
check("the register card too", cardLabel({ id: "r", kind: "risk", next: {} }) === "Risk Register row");
check(
  "a stakeholder card names the person",
  cardLabel({ id: "s", kind: "stakeholder", personName: "Mara", next: {} }) === "Stakeholder card for Mara",
);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - reading the current rows out of ClickUp, which is what `was` depends on");
console.log("  - writing any of them back, which step 6f does");
console.log("  - WHICH Health mapping is correct: this run only proves the two still disagree");
if (failed) process.exit(1);
