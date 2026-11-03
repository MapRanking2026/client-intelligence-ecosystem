/**
 * The two ClickUp forms the follow-through fills in.
 *
 * Pure checks: no ClickUp call, no model, no Firestore. What they pin is the department list, the
 * due-date rules, the cancellation split and what counts as a finished item -- the four places
 * where being wrong creates a real ticket, on a real deadline, in somebody's real queue.
 */
import {
  BILLING_CHANGE_TYPES,
  BILLING_DEFAULT_ASSIGNEE,
  CANCEL_SPLIT_CATEGORIES,
  CANCEL_SPLIT_TOTAL,
  OWNER_NEEDED,
  PRIORITY_LABEL,
  TICKET_DEPARTMENTS,
  TICKET_PRIORITIES,
  addBusinessDays,
  approvedItems,
  billingGaps,
  cancelSplitTotal,
  departmentOwner,
  departmentTone,
  dueDateAfterPriorityChange,
  dueDateForPriority,
  formatEstimate,
  isTicketDepartment,
  isTicketPriority,
  itemBlockers,
  itemChips,
  itemTitle,
  ticketGaps,
  type BillingDraftForm,
  type TicketDraftForm,
} from "@/src/lib/contracts/follow-through-tickets";

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

function ticket(overrides: Partial<TicketDraftForm> = {}): TicketDraftForm {
  return {
    id: "t1",
    formType: "ticket",
    taskName: "Rebuild the Tempe service page",
    description: "She said it looks nothing like the rest of the site.",
    timeEstimateMinutes: 180,
    department: "Web Development",
    assignee: "Ana",
    priority: "normal",
    ...overrides,
  };
}

function billing(overrides: Partial<BillingDraftForm> = {}): BillingDraftForm {
  return {
    id: "b1",
    formType: "billing",
    changeType: "Upsell",
    dateRequested: "2026-11-02",
    dueDate: "2026-11-05",
    assignee: BILLING_DEFAULT_ASSIGNEE,
    details: "Adding Meta Ads from December.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The department list, exactly as ClickUp has it
// ---------------------------------------------------------------------------

check("there are fourteen departments", TICKET_DEPARTMENTS.length === 14);
check("Leadership is first", TICKET_DEPARTMENTS[0] === "Leadership");
check("White Label is last", TICKET_DEPARTMENTS[13] === "White Label");
check(
  "the list is the form's own order, not alphabetised",
  TICKET_DEPARTMENTS.join("|") ===
    "Leadership|Client Success|Google Ads|SEO|Web Development|Executive Assistant|Meta Ads|S.M Management|Ops|Sales|Map Check-ins|Marketing|Finance|White Label",
);
check("S.M Management keeps its spelling", TICKET_DEPARTMENTS.includes("S.M Management"));
check("Map Check-ins keeps its hyphen and case", TICKET_DEPARTMENTS.includes("Map Check-ins"));
check("a real department is recognised", isTicketDepartment("Google Ads"));
check("a near miss is not", !isTicketDepartment("Google ads"));
check("an old-workflow department is not one of these", !isTicketDepartment("Web Design"));

check("delivery teams share a tone", departmentTone("SEO") === departmentTone("Web Development"));
check("money teams are marked out", departmentTone("Finance") === "watch");
check("an unknown department is muted rather than mis-coloured", departmentTone("Nonsense") === "muted");

// ---------------------------------------------------------------------------
// Default owners
// ---------------------------------------------------------------------------

check("no mapping means no owner", departmentOwner("SEO", undefined) === undefined);
check("an empty mapping means no owner", departmentOwner("SEO", {}) === undefined);
check("a configured owner is used", departmentOwner("SEO", { SEO: "Pablo" }) === "Pablo");
check("whitespace is not an owner", departmentOwner("SEO", { SEO: "   " }) === undefined);
check("an unknown department has no owner", departmentOwner("Nonsense", { SEO: "Pablo" }) === undefined);
check("no department has no owner", departmentOwner(undefined, { SEO: "Pablo" }) === undefined);

// ---------------------------------------------------------------------------
// Priority, and the due date it implies
// ---------------------------------------------------------------------------

check("there are four priorities", TICKET_PRIORITIES.length === 4);
check("they are labelled for people", PRIORITY_LABEL.urgent === "Urgent" && PRIORITY_LABEL.low === "Low");
check("a real priority is recognised", isTicketPriority("high"));
check("a label is not a value", !isTicketPriority("High"));

// Monday 2 November 2026 is a Monday, so the weekend skipping is visible in these.
const monday = new Date("2026-11-02T12:00:00.000Z");
check("Urgent is due today", dueDateForPriority("urgent", monday) === "2026-11-02");
check("High is due the next business day", dueDateForPriority("high", monday) === "2026-11-03");
check("Normal is due in three business days", dueDateForPriority("normal", monday) === "2026-11-05");
check("Low gets no invented deadline", dueDateForPriority("low", monday) === undefined);
check("no priority gets no deadline", dueDateForPriority(undefined, monday) === undefined);

const thursday = new Date("2026-11-05T12:00:00.000Z");
check("three business days from Thursday clears the weekend", dueDateForPriority("normal", thursday) === "2026-11-10");
const friday = new Date("2026-11-06T12:00:00.000Z");
check("the next business day after Friday is Monday", dueDateForPriority("high", friday) === "2026-11-09");
const saturday = new Date("2026-11-07T12:00:00.000Z");
check("a Saturday start still lands on a weekday", addBusinessDays(saturday, 1).toISOString().slice(0, 10) === "2026-11-09");

// The rule that protects a promise made on the call.
check(
  "changing the priority moves a rule-derived date",
  dueDateAfterPriorityChange("urgent", { dueDate: "2026-11-05" }, monday) === "2026-11-02",
);
check(
  "changing the priority does NOT move a date agreed on the call",
  dueDateAfterPriorityChange("urgent", { dueDate: "2026-11-13", dueDateAgreedOnCall: true }, monday) ===
    "2026-11-13",
);
check(
  "dropping to Low keeps the existing date rather than clearing it",
  dueDateAfterPriorityChange("low", { dueDate: "2026-11-05" }, monday) === "2026-11-05",
);
check(
  "an agreed flag with no date falls back to the rule",
  dueDateAfterPriorityChange("high", { dueDateAgreedOnCall: true }, monday) === "2026-11-03",
);

// ---------------------------------------------------------------------------
// The cancellation split
// ---------------------------------------------------------------------------

check("there are five split categories", CANCEL_SPLIT_CATEGORIES.length === 5);
check(
  "with the churn analysis's own labels",
  CANCEL_SPLIT_CATEGORIES.join("|") === "Communication|Expectations|Gen. Business|Product|Onboarding",
);
check("an empty split totals zero", cancelSplitTotal(undefined) === 0);
check("a partial split totals what is in it", cancelSplitTotal({ Product: 3 }) === 3);
check(
  "a full split totals five",
  cancelSplitTotal({ Communication: 2, Expectations: 1, Product: 2 }) === CANCEL_SPLIT_TOTAL,
);

// ---------------------------------------------------------------------------
// What is missing from each form
// ---------------------------------------------------------------------------

check("a complete ticket is missing nothing", ticketGaps(ticket()).length === 0);
check("a nameless ticket is missing Task Name", ticketGaps(ticket({ taskName: "" }))[0] === "Task Name");
check("a ticket with no estimate says so", ticketGaps(ticket({ timeEstimateMinutes: 0 }))[0] === "Time Estimate");
check("a ticket with no department says so", ticketGaps(ticket({ department: "" }))[0] === "Department");
check("a ticket with no priority says so", ticketGaps(ticket({ priority: undefined }))[0] === "Priority");
check(
  "the gaps are named as the form names them",
  ticketGaps(ticket({ description: "" }))[0] === "Task Description",
);
// The point of OWNER_NEEDED: it is a placeholder, and must never pass as a filled field.
check("an unassigned ticket is missing its Assignee", ticketGaps(ticket({ assignee: "" }))[0] === "Assignee");
check(
  "'owner needed' does not count as an assignee",
  ticketGaps(ticket({ assignee: OWNER_NEEDED }))[0] === "Assignee",
);
check("the Business Name is not required", ticketGaps(ticket({ businessName: undefined })).length === 0);
check("an attachment is not required", ticketGaps(ticket({ attachments: [] })).length === 0);
check("a due date is not required on a ticket", ticketGaps(ticket({ dueDate: undefined })).length === 0);

check("there are six billing change types", BILLING_CHANGE_TYPES.length === 6);
check("a complete billing form is missing nothing", billingGaps(billing()).length === 0);
check("billing defaults to Carlos Camacho", BILLING_DEFAULT_ASSIGNEE === "Carlos Camacho");
check("a billing form with no type says so", billingGaps(billing({ changeType: undefined }))[0] === "Change type");
check(
  "a billing form needs the date it was requested",
  billingGaps(billing({ dateRequested: "" }))[0] === "Date it was Requested",
);
check("and a due date, unlike a ticket", billingGaps(billing({ dueDate: "" }))[0] === "Due date");

const cancelNoSplit = billingGaps(billing({ changeType: "Cancel" }));
check("a cancellation needs its split", cancelNoSplit.length === 1);
check("and the gap says what it totals and what it must", cancelNoSplit[0].includes("totals 0") && cancelNoSplit[0].includes("must total 5"));
check(
  "a split of four is still wrong",
  billingGaps(billing({ changeType: "Cancel", cancelSplit: { Product: 4 } })).length === 1,
);
check(
  "a split of six is also wrong",
  billingGaps(billing({ changeType: "Cancel", cancelSplit: { Product: 6 } })).length === 1,
);
check(
  "a split of exactly five is right",
  billingGaps(billing({ changeType: "Cancel", cancelSplit: { Communication: 2, Product: 3 } })).length === 0,
);
check(
  "a non-cancellation needs no split",
  billingGaps(billing({ changeType: "Pause" })).length === 0,
);

// ---------------------------------------------------------------------------
// Titles, estimates and chips
// ---------------------------------------------------------------------------

check("a ticket's title is its task name", itemTitle(ticket()) === "Rebuild the Tempe service page");
check(
  "a billing form's title says what kind of change it is",
  itemTitle(billing({ businessName: "Oakline Dental" })) === "Upsell — Oakline Dental",
);

check("under an hour reads in minutes", formatEstimate(45) === "45m");
check("a round hour reads in hours", formatEstimate(120) === "2h");
check("an awkward estimate reads in both", formatEstimate(90) === "1h 30m");
check("no estimate reads as nothing", formatEstimate(undefined) === "");

const chips = itemChips(ticket());
check("the decision is the first chip", chips[0].label === "Undecided");
check("an undecided item is marked for attention", chips[0].tone === "watch");
check("the form type is named", chips[1].label === "New Ticket form");
check("the department is a chip", chips.some((chip) => chip.label === "Web Development"));
check("so is the priority", chips.some((chip) => chip.label === "Normal"));
check("so is the estimate", chips.some((chip) => chip.label === "3h"));
check("so is the assignee", chips.some((chip) => chip.label === "Ana"));
check("a complete item has no missing chip", !chips.some((chip) => chip.label.startsWith("missing")));

const approvedChips = itemChips(ticket({ decision: "approved" }));
check("an approved item says so in green", approvedChips[0].label === "Approved" && approvedChips[0].tone === "good");

const brokenChips = itemChips(ticket({ assignee: OWNER_NEEDED, priority: undefined }));
check("an unowned assignee is chipped in red", brokenChips.some((chip) => chip.label === OWNER_NEEDED && chip.tone === "risk"));
check(
  "the missing chip is last and lists them",
  brokenChips[brokenChips.length - 1].label === "missing: Assignee, Priority",
);
check(
  "an over-long action is chipped as such",
  itemChips(ticket(), { overLongAction: true }).some((chip) => chip.label === "over 20 words"),
);
check(
  "a billing form is chipped as the other form",
  itemChips(billing())[1].label === "Billing Change form",
);

// ---------------------------------------------------------------------------
// Whether the set can be processed
// ---------------------------------------------------------------------------

check("no items block nothing", itemBlockers([]).length === 0);
check(
  "an undecided item blocks",
  itemBlockers([ticket()])[0].includes("Decide the remaining item"),
);
check(
  "several undecided items are counted",
  itemBlockers([ticket(), ticket({ id: "t2" })])[0].includes("2 items"),
);
check("a denied item is decided", itemBlockers([ticket({ decision: "denied" })]).length === 0);
check("a deleted item is decided", itemBlockers([ticket({ decision: "deleted" })]).length === 0);

// Only an approved item has to be complete -- that is the whole asymmetry.
check(
  "a denied item with every field missing blocks nothing",
  itemBlockers([ticket({ decision: "denied", taskName: "", description: "", assignee: "" })]).length === 0,
);
const incompleteApproved = itemBlockers([ticket({ decision: "approved", assignee: "" })]);
check("an approved item with a gap blocks", incompleteApproved.length === 1);
check("and the blocker names the ticket and the gap", incompleteApproved[0].includes("Rebuild the Tempe service page") && incompleteApproved[0].includes("Assignee"));
check(
  "an approved cancellation with a bad split blocks",
  itemBlockers([billing({ decision: "approved", changeType: "Cancel", cancelSplit: { Product: 4 } })]).length === 1,
);

check(
  "only approved items are the ones that get created",
  approvedItems([
    ticket({ decision: "approved" }),
    ticket({ id: "t2", decision: "denied" }),
    ticket({ id: "t3" }),
  ]).length === 1,
);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the live tag list read from the ClickUp list, and its colours");
console.log("  - the real member roster behind the assignee dropdown");
console.log("  - creating any of these in ClickUp, which step 6f does");
if (failed) process.exit(1);
