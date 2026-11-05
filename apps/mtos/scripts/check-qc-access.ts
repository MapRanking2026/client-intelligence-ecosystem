/**
 * Who may do what in QC -- written mostly as negative checks.
 *
 * Pure checks: nothing is read from or written to Firestore.
 *
 * Positive permission checks are the easy half and they catch almost nothing: a rule that returns
 * true for everybody passes all of them. So most of this suite asserts what each role **cannot**
 * do, and in particular that an account manager cannot read a colleague's QC record. A score is a
 * personal performance review, and the way it leaks is a URL with somebody else's touch id in it.
 */
import type { Role } from "@/src/lib/contracts/mtos";
import {
  QC_SPECIALIST_TITLE,
  canActAsTouchOwner,
  canOpenQcQueue,
  canReadQcRecord,
  canScoreQc,
  canSeeAllQc,
} from "@/src/lib/contracts/qc-access";

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

const ROLES: Role[] = ["account_manager", "manager", "qa_reviewer", "tenant_admin"];

// ---------------------------------------------------------------------------
// Scoring: exactly one role
// ---------------------------------------------------------------------------

check("a QC reviewer can score", canScoreQc("qa_reviewer"));
check("an account manager cannot score", !canScoreQc("account_manager"));
// Both of these can read everything, which is exactly why they are checked here.
check("an admin cannot score", !canScoreQc("tenant_admin"));
check("a manager cannot score", !canScoreQc("manager"));
check(
  "exactly one role can score",
  ROLES.filter((role) => canScoreQc(role)).length === 1,
);

// ---------------------------------------------------------------------------
// Opening the queue: the reviewer plus oversight
// ---------------------------------------------------------------------------

check("a QC reviewer can open the queue", canOpenQcQueue("qa_reviewer"));
check("an admin can open the queue", canOpenQcQueue("tenant_admin"));
check("a manager can open the queue", canOpenQcQueue("manager"));
check("an account manager cannot open the queue", !canOpenQcQueue("account_manager"));
check(
  "three of the four roles can open it",
  ROLES.filter((role) => canOpenQcQueue(role)).length === 3,
);

// Watching and scoring are separate permissions, and this is the pair that proves it.
check(
  "an admin can watch without being able to score",
  canOpenQcQueue("tenant_admin") && !canScoreQc("tenant_admin"),
);
check(
  "seeing everything and opening the queue are the same permission",
  ROLES.every((role) => canSeeAllQc(role) === canOpenQcQueue(role)),
);

// ---------------------------------------------------------------------------
// Reading one record
// ---------------------------------------------------------------------------

check("an AM can read their own touch", canReadQcRecord("account_manager", "u1", "u1"));
// The one that matters most in this file.
check("an AM cannot read a colleague's touch", !canReadQcRecord("account_manager", "u1", "u2"));
check("a reviewer can read anyone's", canReadQcRecord("qa_reviewer", "sady", "u2"));
check("an admin can read anyone's", canReadQcRecord("tenant_admin", "boss", "u2"));
check("a manager can read anyone's", canReadQcRecord("manager", "lead", "u2"));

// An unattributed record must fail closed. Letting it through for whoever asked would turn a bad
// write into an open door.
check(
  "an AM cannot read a record with no AM on it",
  !canReadQcRecord("account_manager", "u1", undefined),
);
check(
  "nor one whose AM is an empty string",
  !canReadQcRecord("account_manager", "", ""),
);
check(
  "an admin can still read an unattributed record",
  canReadQcRecord("tenant_admin", "boss", undefined),
);

// ---------------------------------------------------------------------------
// Acting as the touch's owner: appeal, acknowledge, ask for a chat
// ---------------------------------------------------------------------------

check("the AM who ran the touch can act on it", canActAsTouchOwner("u1", "u1"));
check("another AM cannot", !canActAsTouchOwner("u2", "u1"));
// Deliberately role-blind: a reviewer appealing their own decision, or an admin marking someone
// else's score as reviewed, would put words in that AM's record.
check("a reviewer cannot act as the owner", !canActAsTouchOwner("sady", "u1"));
check("an admin cannot act as the owner", !canActAsTouchOwner("boss", "u1"));
check("nobody can act on a record with no owner", !canActAsTouchOwner("u1", undefined));
check("an empty id does not match an empty owner", !canActAsTouchOwner("", ""));

// ---------------------------------------------------------------------------
// The display title
// ---------------------------------------------------------------------------

check("the reviewer's shown title is QC Specialist", QC_SPECIALIST_TITLE === "QC Specialist");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - that every new QC route actually calls these, which the routes' own tests cover");
console.log("  - the Firestore rules, which are not touched by this work");
if (failed) process.exit(1);
