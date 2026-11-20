/**
 * The tracker rows arrive filled in from what ClickUp already knows.
 *
 * The Health Tracker row came up asking the AM to type in the Start date, the Assignee and the
 * Account Manager every month, and proposing to overwrite the Client Name with the business name
 * -- "Yunella Women's Health" replacing "Eunjee Song". None of that was a missing column in
 * ClickUp. Two of the three field types were simply being read wrong:
 *
 *  - a date custom field comes back as epoch milliseconds, and `String(raw)` made it
 *    "1760918400000", which a date input shows as nothing at all;
 *  - a people field comes back as an array of user objects, and `String(raw)` made it
 *    "[object Object]".
 *
 * Both looked like empty columns, so the row proposed to fill them and the AM had to check every
 * one. These checks pin the reading, and pin that a column ClickUp already answers is left alone.
 *
 * Run with: npm run check:tracker-prefill
 */
import assert from "node:assert/strict";

import { fieldValueText, type ClickUpCustomField } from "@/src/lib/server/services/clickup-fields";
import {
  HEALTH_TRACKER_FIELDS,
  RISK_REGISTER_FIELDS,
  STAKEHOLDER_FIELDS,
  type TrackerField,
} from "@/src/lib/contracts/follow-through-trackers";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`FAILED: ${label}`);
  }
}

function field(type: string, options: { id: string; name: string }[] = []): ClickUpCustomField {
  return { id: "f1", name: "Field", type, options };
}

// ---------------------------------------------------------------------------
// Reading what ClickUp stores
// ---------------------------------------------------------------------------

const date = field("date");
check("a date comes back as a day, not as milliseconds", fieldValueText(date, "1760918400000") === "2025-10-20");
check("a numeric timestamp reads the same way", fieldValueText(date, 1760918400000) === "2025-10-20");
// Rendered in UTC on purpose: the stored value is a day, and a local zone can move it by one.
check("the day does not drift with the server's zone", fieldValueText(date, Date.UTC(2026, 9, 20)) === "2026-10-20");
check("an unset date is empty rather than 1970", fieldValueText(date, 0) === undefined);
check("so is a date ClickUp never answered", fieldValueText(date, null) === undefined);

const users = field("users");
check(
  "a people field reads as the person",
  fieldValueText(users, [{ id: 1, username: "Francisco Quintero", email: "f@example.test" }]) === "Francisco Quintero",
);
check(
  "two people read as both",
  fieldValueText(users, [{ id: 1, username: "Ana" }, { id: 2, username: "Carlos" }]) === "Ana, Carlos",
);
check("somebody with only an email reads as the email", fieldValueText(users, [{ id: 3, email: "x@example.test" }]) === "x@example.test");
check("an empty people field is empty", fieldValueText(users, []) === undefined);

const dropdown = field("drop_down", [
  { id: "o1", name: "Direct" },
  { id: "o2", name: "White Label" },
]);
check("a dropdown reads as its option", fieldValueText(dropdown, "o2") === "White Label");
check("an older dropdown storing an index still reads", fieldValueText(dropdown, 0) === "Direct");
check("plain text is left alone", fieldValueText(field("short_text"), " Active ") === "Active");
// The point of the whole exercise: nothing reaches the AM as a stringified object.
check("a shape nothing recognises is empty, never [object Object]", fieldValueText(field("short_text"), { a: 1 }) === undefined);

// ---------------------------------------------------------------------------
// The columns that carry a person are picked, not typed
// ---------------------------------------------------------------------------

function kindOf<T>(fields: TrackerField<T>[], key: string): string | undefined {
  return fields.find((candidate) => candidate.key === key)?.kind;
}

check("the Health Tracker's Assignee is a roster field", kindOf(HEALTH_TRACKER_FIELDS, "assignee") === "person");
check("so is its Account Manager", kindOf(HEALTH_TRACKER_FIELDS, "accountManager") === "person");
check("so is the Risk Register's Assignee", kindOf(RISK_REGISTER_FIELDS, "accountManager") === "person");
check("so is its Next Action Owner", kindOf(RISK_REGISTER_FIELDS, "nextActionOwner") === "person");
check("so is the Stakeholder Map's Assignee", kindOf(STAKEHOLDER_FIELDS, "assignee") === "person");
// Start date stays a date field: it is picked from a calendar, not from the roster.
check("the Start date is still a date", kindOf(HEALTH_TRACKER_FIELDS, "startDate") === "date");

// ---------------------------------------------------------------------------
// What the row proposes
// ---------------------------------------------------------------------------

/**
 * The precedence the service applies, restated here as the rule rather than re-run through
 * Firestore and ClickUp. Mirroring it keeps the intent pinned: the row wins, then the contact,
 * then the business -- and nothing is invented when all three are empty.
 */
function proposedClientName(row: { clientName?: string } | undefined, contact: string, business: string) {
  return row?.clientName?.trim() || contact.trim() || business;
}

assert.equal(
  proposedClientName({ clientName: "Eunjee Song" }, "Eunjee Song", "Yunella Women's Health"),
  "Eunjee Song",
);
check(
  "the name already in the tracker is not replaced by the business name",
  proposedClientName({ clientName: "Eunjee Song" }, "", "Yunella Women's Health") === "Eunjee Song",
);
check(
  "an empty column falls to the person we deal with",
  proposedClientName(undefined, "Eunjee Song", "Yunella Women's Health") === "Eunjee Song",
);
check(
  "and to the business only when there is no person",
  proposedClientName(undefined, "", "Yunella Women's Health") === "Yunella Women's Health",
);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - whether ClickUp's field names match what findField looks for on a given list");
console.log("  - the write back to ClickUp, which the processing step owns");
console.log("  - whether the roster the dropdown offers is the right list of people");
if (failed) process.exitCode = 1;
