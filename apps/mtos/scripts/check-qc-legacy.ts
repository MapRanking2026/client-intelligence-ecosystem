/**
 * Legacy A-F reviews, and the roles the sign-up form offers.
 *
 * Pure checks: nothing is read from or written to Firestore.
 *
 * Two rules, and they are both about not misleading somebody.
 *
 * **An old grade is never read as a new score.** The 7-category A-F review and the 17-point QC
 * rubric do not measure the same thing, there is no honest arithmetic between them, and the one
 * failure that matters is a "B" from 2026 appearing on an AM's trend line as though QC had put it
 * there. So every surface that shows an old grade says which instrument produced it, and nothing
 * here converts one scale to the other.
 *
 * **A touch gets one instrument, not two.** The same call graded twice, by two systems, with two
 * different people entitled to argue about the result, is worse than either alone.
 */
import {
  LEGACY_QA_EXPLAINER,
  LEGACY_QA_TAG,
  canRunLegacyQa,
  hasLegacyQa,
  hasQc,
  legacyGradeLabel,
  legacyQaBlockedReason,
  legacyRowLabel,
  legacyStatusLabel,
} from "@/src/lib/contracts/qc-legacy";
import {
  SIGNUP_ROLES,
  SIGNUP_ROLE_VALUES,
  isSignupRole,
  signupCodeEnvVar,
  signupRoleLabel,
} from "@/src/lib/contracts/signup-roles";
import { QC_SPECIALIST_TITLE } from "@/src/lib/contracts/qc-access";
import type { QaReview } from "@/src/lib/mtos-data";

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

function review(partial: Partial<QaReview> = {}): QaReview {
  return {
    status: "approved",
    scorecard: [],
    overallGrade: "B",
    summary: "The call went well.",
    generatedAt: "2026-06-05T10:00:00.000Z",
    ...partial,
  } as QaReview;
}

// ---------------------------------------------------------------------------
// Which instrument graded this touch
// ---------------------------------------------------------------------------

check("a touch with an old review has one", hasLegacyQa({ qaReview: review() }));
check("a touch with no review has none", !hasLegacyQa({}));
check("an absent touch has none", !hasLegacyQa(undefined));
check("a touch in QC is detected", hasQc({ qc: { status: "scored" } }));
check("a touch not in QC is not", !hasQc({}));

// ---------------------------------------------------------------------------
// One instrument per touch
// ---------------------------------------------------------------------------

check("a touch outside QC can still be graded A-F", canRunLegacyQa({}));
check("a touch in QC cannot", !canRunLegacyQa({ qc: { status: "ready" } }));
// Even at the very start of QC. The point is that it is in the new flow at all.
check("a touch only just handed over cannot", !canRunLegacyQa({ qc: { status: "ready" } }));
check("a scored touch cannot", !canRunLegacyQa({ qc: { status: "scored" } }));

check("no reason is given when it is allowed", legacyQaBlockedReason({}) === undefined);
const reason = legacyQaBlockedReason({ qc: { status: "scored" } }) || "";
check("the reason is a sentence, not a flag", reason.length > 30);
// "Disabled" with no reason is the thing people file bugs about.
check("the reason names the rubric", reason.includes("17-point"));

// ---------------------------------------------------------------------------
// How an old grade is shown
// ---------------------------------------------------------------------------

check("the tag is one string everywhere", LEGACY_QA_TAG === "Legacy QA");
check("the explainer says it is not in QC averages", LEGACY_QA_EXPLAINER.includes("not part of QC averages"));

check("a grade is shown as stored", legacyGradeLabel(review({ overallGrade: "C" })) === "C");
// The new rubric has no F. Rewriting an old grade to fit a scale it was not given on would be
// falsifying a record.
check("an F is kept, not rewritten", legacyGradeLabel(review({ overallGrade: "F" })) === "F");
check("no review is a dash", legacyGradeLabel(undefined) === "—");
check(
  "a review with no grade is a dash, not blank",
  legacyGradeLabel(review({ overallGrade: undefined as unknown as "B" })) === "—",
);

check("a stored status is said in words", legacyStatusLabel(review({ status: "pending_victor_approval" })) === "Waiting on approval");
check("approved reads as approved", legacyStatusLabel(review({ status: "approved" })) === "Approved");
check("changes requested reads plainly", legacyStatusLabel(review({ status: "changes_requested" })) === "Changes requested");
check("no review reads as not reviewed", legacyStatusLabel(undefined) === "Not reviewed");
check("not started reads as not reviewed", legacyStatusLabel(review({ status: "not_started" })) === "Not reviewed");

const rowLabel = legacyRowLabel(review({ overallGrade: "B", status: "approved" }));
// A row reading "B · Approved" beside one reading "84 (B)" is exactly the confusion to prevent.
check("a row always says it is legacy", rowLabel.startsWith(LEGACY_QA_TAG));
check("a row carries the grade", rowLabel.includes("B"));
check("a row carries the status", rowLabel.includes("Approved"));

// ---------------------------------------------------------------------------
// The sign-up roles
// ---------------------------------------------------------------------------

check("three roles are offered", SIGNUP_ROLES.length === 3);
check(
  "exactly the three the owner asked for",
  SIGNUP_ROLE_VALUES.join() === "account_manager,qa_reviewer,tenant_admin",
);
// A form whose first option is the most powerful one invites a careless click.
check("the least powerful role is first", SIGNUP_ROLES[0].role === "account_manager");
check("admin is last", SIGNUP_ROLES[2].role === "tenant_admin");
check("manager is no longer offered", !SIGNUP_ROLE_VALUES.includes("manager"));

check("the AM option is labelled plainly", signupRoleLabel("account_manager") === "Account Manager");
// The label comes from the QC contract so the form and the queue header cannot disagree.
check("the reviewer is called the QC Specialist", signupRoleLabel("qa_reviewer") === QC_SPECIALIST_TITLE);
check("the admin option is labelled Admin", signupRoleLabel("tenant_admin") === "Admin");
check("every option has a hint", SIGNUP_ROLES.every((option) => option.hint.length > 20));

check("a listed role is accepted", isSignupRole("qa_reviewer"));
check("a role that is not offered is refused", !isSignupRole("manager"));
check("a made-up role is refused", !isSignupRole("superuser"));

check("admin uses the admin code", signupCodeEnvVar("tenant_admin") === "adminSignupCode");
check("the AM uses the manager code", signupCodeEnvVar("account_manager") === "managerSignupCode");
check("the reviewer uses the manager code", signupCodeEnvVar("qa_reviewer") === "managerSignupCode");
// A role with no entry returns undefined, which the route reads as "no code configured" -- the
// same as a blank variable, rather than silently granting it.
check("a role not offered has no code mapping", signupCodeEnvVar("manager") === undefined);
check(
  "every offered role has a code variable",
  SIGNUP_ROLES.every((option) => Boolean(signupCodeEnvVar(option.role))),
);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - whether an invite code is actually SET in any environment; an unset code means");
console.log("    that role is ungated, which is this deployment's existing behaviour");
console.log("  - the server refusal in `generateQaReview`, which needs a database");
console.log("  - how the tag looks on each of the four screens that show it");
if (failed) process.exit(1);
