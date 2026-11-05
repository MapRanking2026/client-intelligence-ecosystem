/**
 * The QC rubric: the invariants that must survive the real rubric replacing the placeholders.
 *
 * Pure checks: nothing is read from or written to Firestore.
 *
 * This suite exists for one moment that has not happened yet. When Jessica's 17-point rubric
 * arrives, somebody will paste new names and descriptions into `qc-rubric.ts`, and these checks are
 * what stands between that edit and a silent change to how every score is computed. The three that
 * matter most: there are still 17 criteria, they are still numbered 1-17 with no gaps, and the two
 * scored KPIs still sit at positions 1 and 17 -- because the stored `crit` array is positional and
 * a shifted criterion would re-label every score ever taken.
 */
import {
  QC_CRITERION_COUNT,
  QC_GROUPS,
  QC_POST_TOUCH_CRITERION,
  QC_PREP_CRITERION,
  QC_RUBRIC,
  QC_RUBRIC_VERSION,
  criteriaInGroup,
  criterionByNumber,
} from "@/src/lib/contracts/qc-rubric";

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
// Shape: the part the real rubric must not break
// ---------------------------------------------------------------------------

check("there are seventeen criteria", QC_RUBRIC.length === 17);
check("the count constant agrees", QC_CRITERION_COUNT === QC_RUBRIC.length);
check(
  "they are numbered 1 to 17 in order, with no gaps",
  QC_RUBRIC.every((criterion, index) => criterion.n === index + 1),
);
check("every criterion has a name", QC_RUBRIC.every((criterion) => criterion.name.trim().length > 0));
check(
  "every criterion has a description",
  QC_RUBRIC.every((criterion) => criterion.description.trim().length > 0),
);
check(
  "no two criteria share a name",
  new Set(QC_RUBRIC.map((criterion) => criterion.name)).size === QC_RUBRIC.length,
);

// ---------------------------------------------------------------------------
// The KPIs are positional. A shifted criterion silently changes what a KPI measures.
// ---------------------------------------------------------------------------

check("the prep KPI is criterion 1", QC_PREP_CRITERION === 1);
check("the post-touch KPI is criterion 17", QC_POST_TOUCH_CRITERION === 17);
check(
  "criterion 1 is labelled the prep KPI",
  criterionByNumber(QC_PREP_CRITERION)?.kpi === "Prep KPI",
);
check(
  "criterion 17 is labelled the post-touch KPI",
  criterionByNumber(QC_POST_TOUCH_CRITERION)?.kpi === "Post-touch KPI",
);
check(
  "exactly three criteria carry a KPI label",
  QC_RUBRIC.filter((criterion) => criterion.kpi).length === 3,
);
check(
  "the goal KPI label sits on exactly one criterion",
  QC_RUBRIC.filter((criterion) => criterion.kpi === "Goal KPI").length === 1,
);

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

check("there are six groups", QC_GROUPS.length === 6);
check(
  "the groups are in the handoff's order",
  QC_GROUPS.join(" · ") ===
    "Before the call · Opening · The conversation · Outcomes · Close · After the call",
);
check(
  "every criterion belongs to a known group",
  QC_RUBRIC.every((criterion) => QC_GROUPS.includes(criterion.group)),
);
check(
  "every group has at least one criterion",
  QC_GROUPS.every((group) => criteriaInGroup(group).length > 0),
);
check(
  "the groups partition the rubric with nothing left over",
  QC_GROUPS.reduce((total, group) => total + criteriaInGroup(group).length, 0) === QC_RUBRIC.length,
);
// A criterion out of group order would make the scoring screen render the same group twice.
check(
  "criteria are ordered so each group is contiguous",
  QC_GROUPS.every((group) => {
    const numbers = criteriaInGroup(group).map((criterion) => criterion.n);
    return numbers.every((n, index) => index === 0 || n === numbers[index - 1] + 1);
  }),
);
check(
  "the groups themselves appear in rubric order",
  QC_RUBRIC.map((criterion) => QC_GROUPS.indexOf(criterion.group)).every(
    (position, index, all) => index === 0 || position >= all[index - 1],
  ),
);

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

check("a criterion can be found by its number", criterionByNumber(9)?.n === 9);
// Undefined rather than a throw: an old record scored under a longer rubric must still render.
check("an unknown number returns undefined", criterionByNumber(99) === undefined);
check("zero is not a criterion", criterionByNumber(0) === undefined);

// ---------------------------------------------------------------------------
// The version
// ---------------------------------------------------------------------------

check("the rubric version is set", QC_RUBRIC_VERSION.trim().length > 0);
// Named so nobody mistakes the current wording for Jessica's rubric. When the real one lands this
// check is the reminder to bump the version in the same commit.
check(
  "the version says these are placeholders",
  QC_RUBRIC_VERSION.includes("placeholder"),
);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - whether the wording matches Jessica's rubric, which has not arrived yet");
console.log("  - how the groups look on the scoring screen, which is a screen to open");
if (failed) process.exit(1);
