import type { BillingChangeType } from "@/src/lib/mtos-data";

/**
 * Every action from the call, as the ticket it is about to become.
 *
 * The AM approves a ticket on this screen and it is created in ClickUp exactly as approved, so
 * what is drafted here has to be the real form -- the same fields, the same department list, the
 * same required marks. A screen that collects four fields and leaves five for "later in ClickUp"
 * produces tickets nobody finishes, which is the failure this replaces.
 *
 * Three rules carry most of the weight:
 *
 *  - **A due date follows the priority, unless the call set one.** Urgent is today, High is
 *    tomorrow, Normal is three business days. But a date the client was given on the call beats
 *    any rule, and changing the priority must never quietly move it -- that date is a promise.
 *  - **An unknown owner is written as unknown.** Where no default is configured for a department
 *    the assignee reads "owner needed" and the ticket cannot be approved. Guessing a name creates
 *    work in somebody's queue that they never agreed to and may never see.
 *  - **A cancellation's five points must total five.** Not four, not six. The split is what the
 *    churn analysis is built from, and a row that does not add up silently skews it.
 */

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

/**
 * The departments exactly as the ClickUp form lists them, in the ClickUp form's order.
 *
 * Not alphabetised and not tidied. An AM reading this dropdown is matching it against the one
 * they use every day, and a different order is a different list as far as that goes.
 */
export const TICKET_DEPARTMENTS = [
  "Leadership",
  "Client Success",
  "Google Ads",
  "SEO",
  "Web Development",
  "Executive Assistant",
  "Meta Ads",
  "S.M Management",
  "Ops",
  "Sales",
  "Map Check-ins",
  "Marketing",
  "Finance",
  "White Label",
] as const;

export type TicketDepartmentName = (typeof TICKET_DEPARTMENTS)[number];

export function isTicketDepartment(value: unknown): value is TicketDepartmentName {
  return typeof value === "string" && (TICKET_DEPARTMENTS as readonly string[]).includes(value);
}

/**
 * The chip colour each department gets, from the app's own tokens.
 *
 * Grouped by the kind of work rather than given fourteen different colours: a wall of fourteen
 * hues tells the AM nothing, where "this is a delivery team, this is a money team" does.
 */
export function departmentTone(department: string): "info" | "good" | "watch" | "muted" {
  switch (department) {
    case "SEO":
    case "Web Development":
    case "Map Check-ins":
    case "S.M Management":
      return "info";
    case "Google Ads":
    case "Meta Ads":
    case "Marketing":
    case "Sales":
      return "good";
    case "Finance":
    case "Leadership":
    case "White Label":
      return "watch";
    default:
      return "muted";
  }
}

/** What the assignee reads when no default owner is configured for the department. */
export const OWNER_NEEDED = "owner needed";

/** The configured default owner per department. Absent means nobody has set one. */
export type DepartmentOwners = Partial<Record<TicketDepartmentName, string>>;

/**
 * The owner a department implies, or undefined when none is configured.
 *
 * Deliberately has no built-in defaults. A name hard-coded here would be wrong for every tenant
 * but one, and a wrong assignee is worse than a blank: the ticket leaves the AM's hands and lands
 * silently in a queue the named person is not watching.
 */
export function departmentOwner(
  department: string | undefined,
  owners: DepartmentOwners | undefined,
): string | undefined {
  if (!department || !isTicketDepartment(department)) return undefined;
  return owners?.[department]?.trim() || undefined;
}

// ---------------------------------------------------------------------------
// Priority and the due date it implies
// ---------------------------------------------------------------------------

export const TICKET_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type TicketPriorityName = (typeof TICKET_PRIORITIES)[number];

export const PRIORITY_LABEL: Record<TicketPriorityName, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export function isTicketPriority(value: unknown): value is TicketPriorityName {
  return typeof value === "string" && (TICKET_PRIORITIES as readonly string[]).includes(value);
}

/** Add business days to a date, skipping Saturday and Sunday. */
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from.getTime());
  let added = 0;
  while (added < days) {
    result.setUTCDate(result.getUTCDate() + 1);
    const weekday = result.getUTCDay();
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  return result;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The due date a priority implies: Urgent today, High the next business day, Normal three.
 *
 * Low has no rule and returns undefined -- a low-priority ticket with an invented deadline is a
 * deadline that will be missed, and missed deadlines stop meaning anything.
 */
export function dueDateForPriority(
  priority: TicketPriorityName | undefined,
  from: Date,
): string | undefined {
  switch (priority) {
    case "urgent":
      return isoDay(from);
    case "high":
      return isoDay(addBusinessDays(from, 1));
    case "normal":
      return isoDay(addBusinessDays(from, 3));
    default:
      return undefined;
  }
}

/**
 * The due date after a priority change.
 *
 * A date agreed on the call is never moved by it. That is the whole reason this is a function
 * rather than a line in an onChange handler: the AM told the client "Friday", and a dropdown
 * quietly rewriting that to tomorrow turns a kept promise into a broken one.
 */
export function dueDateAfterPriorityChange(
  priority: TicketPriorityName | undefined,
  current: { dueDate?: string; dueDateAgreedOnCall?: boolean },
  from: Date,
): string | undefined {
  if (current.dueDateAgreedOnCall && current.dueDate) return current.dueDate;
  return dueDateForPriority(priority, from) ?? current.dueDate;
}

// ---------------------------------------------------------------------------
// Tags, read live from the list
// ---------------------------------------------------------------------------

export interface ClickUpTag {
  name: string;
  /** The tag's own colour in ClickUp, so the chip looks like the one in the list. */
  background?: string;
  foreground?: string;
}

// ---------------------------------------------------------------------------
// The two forms
// ---------------------------------------------------------------------------

export type ItemDecision = "approved" | "denied" | "deleted";

export type TicketFormType = "ticket" | "billing";

/** The ClickUp New Ticket form, field for field. */
export interface TicketDraftForm {
  id: string;
  formType: "ticket";
  /** The action line this was drafted from, so the notes can carry its ticket link. */
  actionId?: string;
  taskName: string;
  businessName?: string;
  description: string;
  /** Local paths/urls of real uploads. Never invented. */
  attachments?: string[];
  timeEstimateMinutes?: number;
  department?: string;
  assignee?: string;
  priority?: TicketPriorityName;
  dueDate?: string;
  /** True when the date came from the call rather than from the priority rule. */
  dueDateAgreedOnCall?: boolean;
  tags?: string[];
  decision?: ItemDecision;
}

export const BILLING_CHANGE_TYPES: BillingChangeType[] = [
  "Upsell",
  "Downsell",
  "New Sale",
  "Pause",
  "Cancel",
  "Payment Failed",
];

/**
 * The five reasons a cancellation is attributed to, and the split that must total five.
 *
 * The labels are the churn analysis's own, so a row filed here lines up with every other row in
 * it. Renaming one here would quietly split a category in the analysis in two.
 */
export const CANCEL_SPLIT_CATEGORIES = [
  "Communication",
  "Expectations",
  "Gen. Business",
  "Product",
  "Onboarding",
] as const;

export type CancelSplitCategory = (typeof CANCEL_SPLIT_CATEGORIES)[number];
export type CancelSplit = Partial<Record<CancelSplitCategory, number>>;

export const CANCEL_SPLIT_TOTAL = 5;

export function cancelSplitTotal(split: CancelSplit | undefined): number {
  return CANCEL_SPLIT_CATEGORIES.reduce((sum, category) => sum + (split?.[category] || 0), 0);
}

/** The Billing Change form. A different form, not a ticket with extra fields. */
export interface BillingDraftForm {
  id: string;
  formType: "billing";
  actionId?: string;
  businessName?: string;
  changeType?: BillingChangeType;
  /** When the client asked for it (YYYY-MM-DD). */
  dateRequested?: string;
  dueDate?: string;
  assignee?: string;
  attachments?: string[];
  details: string;
  /** Only for a cancellation. */
  cancelSplit?: CancelSplit;
  decision?: ItemDecision;
}

export type FollowThroughItem = TicketDraftForm | BillingDraftForm;

/** The one owner every billing change defaults to, per the handoff. */
export const BILLING_DEFAULT_ASSIGNEE = "Carlos Camacho";

// ---------------------------------------------------------------------------
// What is missing
// ---------------------------------------------------------------------------

/**
 * The required fields a ticket is still missing, by the form's own names.
 *
 * Named as the form names them -- "Time Estimate", not "timeEstimateMinutes" -- because the AM is
 * going to go and fill them in on that form.
 */
export function ticketGaps(form: TicketDraftForm): string[] {
  const gaps: string[] = [];
  if (!form.taskName.trim()) gaps.push("Task Name");
  if (!form.description.trim()) gaps.push("Task Description");
  if (!form.timeEstimateMinutes) gaps.push("Time Estimate");
  if (!form.department?.trim()) gaps.push("Department");
  if (!form.assignee?.trim() || form.assignee.trim() === OWNER_NEEDED) gaps.push("Assignee");
  if (!form.priority) gaps.push("Priority");
  return gaps;
}

export function billingGaps(form: BillingDraftForm): string[] {
  const gaps: string[] = [];
  if (!form.changeType) gaps.push("Change type");
  if (!form.dateRequested?.trim()) gaps.push("Date it was Requested");
  if (!form.dueDate?.trim()) gaps.push("Due date");
  if (!form.assignee?.trim() || form.assignee.trim() === OWNER_NEEDED) gaps.push("Assignee");
  if (form.changeType === "Cancel") {
    const total = cancelSplitTotal(form.cancelSplit);
    if (total !== CANCEL_SPLIT_TOTAL) {
      gaps.push(`Cancellation split (totals ${total}, must total ${CANCEL_SPLIT_TOTAL})`);
    }
  }
  return gaps;
}

export function itemGaps(item: FollowThroughItem): string[] {
  return item.formType === "billing" ? billingGaps(item) : ticketGaps(item);
}

export function itemTitle(item: FollowThroughItem): string {
  return item.formType === "billing"
    ? `${item.changeType || "Billing change"}${item.businessName ? ` — ${item.businessName}` : ""}`
    : item.taskName;
}

// ---------------------------------------------------------------------------
// The chips on each row
// ---------------------------------------------------------------------------

export interface ItemChip {
  label: string;
  tone: "good" | "info" | "watch" | "risk" | "muted";
}

/** Minutes as the AM would say them: 45m, 2h, 1h 30m. */
export function formatEstimate(minutes: number | undefined): string {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * The chips along a row: what it is, where it goes, and what is wrong with it.
 *
 * Ordered so the two that change what the AM does -- the decision and the missing fields -- are
 * first and last, where the eye lands.
 */
export function itemChips(item: FollowThroughItem, options: { overLongAction?: boolean } = {}): ItemChip[] {
  const chips: ItemChip[] = [];

  chips.push(
    item.decision === "approved"
      ? { label: "Approved", tone: "good" }
      : item.decision === "denied"
        ? { label: "Denied", tone: "muted" }
        : item.decision === "deleted"
          ? { label: "Deleted", tone: "muted" }
          : { label: "Undecided", tone: "watch" },
  );

  chips.push(
    item.formType === "billing"
      ? { label: "Billing Change form", tone: "watch" }
      : { label: "New Ticket form", tone: "muted" },
  );

  if (item.formType === "ticket") {
    if (item.department) chips.push({ label: item.department, tone: departmentTone(item.department) });
    if (item.priority) {
      chips.push({
        label: PRIORITY_LABEL[item.priority],
        tone: item.priority === "urgent" ? "risk" : item.priority === "high" ? "watch" : "muted",
      });
    }
    const estimate = formatEstimate(item.timeEstimateMinutes);
    if (estimate) chips.push({ label: estimate, tone: "muted" });
  }

  if (item.assignee?.trim()) {
    chips.push({
      label: item.assignee.trim(),
      tone: item.assignee.trim() === OWNER_NEEDED ? "risk" : "muted",
    });
  }

  if (options.overLongAction) {
    chips.push({ label: "over 20 words", tone: "watch" });
  }

  const gaps = itemGaps(item);
  if (gaps.length) {
    chips.push({ label: `missing: ${gaps.join(", ")}`, tone: "risk" });
  }

  return chips;
}

// ---------------------------------------------------------------------------
// Whether the set of items is finished
// ---------------------------------------------------------------------------

/**
 * What is stopping these items being processed.
 *
 * Denying or deleting an item is a decision and clears it: only an approved item has to be
 * complete, because only an approved item becomes something real.
 */
export function itemBlockers(items: FollowThroughItem[]): string[] {
  const blockers: string[] = [];

  const undecided = items.filter((item) => !item.decision).length;
  if (undecided) {
    blockers.push(
      `Decide the remaining ${undecided === 1 ? "item" : `${undecided} items`} — approve, deny or delete each one.`,
    );
  }

  for (const item of items.filter((candidate) => candidate.decision === "approved")) {
    const gaps = itemGaps(item);
    if (gaps.length) {
      blockers.push(`“${itemTitle(item) || "An approved item"}” still needs ${gaps.join(", ")}.`);
    }
  }

  return blockers;
}

/** The items that will actually be created. */
export function approvedItems(items: FollowThroughItem[]): FollowThroughItem[] {
  return items.filter((item) => item.decision === "approved");
}
