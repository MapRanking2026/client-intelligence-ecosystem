import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ActionLine, PendingItem } from "@/src/lib/contracts/follow-through-notes";
import { actionWordCount, pendingMarker } from "@/src/lib/contracts/follow-through-notes";
import {
  BILLING_DEFAULT_ASSIGNEE,
  OWNER_NEEDED,
  TICKET_DEPARTMENTS,
  type BillingDraftForm,
  type ClickUpTag,
  type DepartmentOwners,
  type FollowThroughItem,
  type TicketDepartmentName,
  type TicketDraftForm,
  departmentOwner,
  dueDateForPriority,
} from "@/src/lib/contracts/follow-through-tickets";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath, tenantSettingsPath } from "@/src/lib/server/firebase/collections";
import { withQuotaFallback } from "@/src/lib/server/firebase/quota";
import {
  getIntegrationConnection,
  getIntegrationCredentials,
} from "@/src/lib/server/integrations";

/**
 * Turning the notes' action lines into the ClickUp forms they will be filed as.
 *
 * Built once and then owned by the AM. Re-deriving the list every time the notes changed would
 * throw away the department, owner and estimate they set, so a rebuild is an explicit action and
 * items the AM has already decided on are left alone by it.
 *
 * Nothing here writes to ClickUp. It reads the live tag list and the roster so the AM picks real
 * values, and it stores the drafts on the touch. Creating the tasks is step 6f, after approval.
 */

const CLICKUP_API = "https://api.clickup.com/api/v2";

/** What the action's team was called, matched against the fourteen real departments. */
function matchDepartment(team: string | undefined): TicketDepartmentName | undefined {
  const value = (team || "").trim().toLowerCase();
  if (!value) return undefined;
  const exact = TICKET_DEPARTMENTS.find((department) => department.toLowerCase() === value);
  if (exact) return exact;
  // A near miss is matched, a guess is not: "web dev" finds Web Development, "marketing stuff"
  // does not become Marketing, because a wrongly routed ticket is worse than an unrouted one.
  const compact = value.replace(/[^a-z]/g, "");
  return TICKET_DEPARTMENTS.find((department) => {
    const target = department.toLowerCase().replace(/[^a-z]/g, "");
    return target === compact || target.startsWith(compact) || compact.startsWith(target);
  });
}

/** Only a date MTOS can read without guessing. Anything else stays the AM's words. */
function parseIsoDay(value: string | undefined): string | undefined {
  const trimmed = (value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

/** True when this action is about money rather than work, and belongs on the other form. */
function looksLikeBilling(action: ActionLine): boolean {
  const text = `${action.what} ${action.team}`.toLowerCase();
  return /\b(upsell|downsell|cancel|cancellation|pause|refund|invoice|billing|price|pricing|payment|charge|mrr|downgrade|upgrade)\b/.test(
    text,
  );
}

/** The per-department default owners this tenant has configured. Empty until someone sets them. */
export async function readDepartmentOwners(context: TenantContext): Promise<DepartmentOwners> {
  const db = getFirebaseAdminDb();
  if (!db) return {};
  return withQuotaFallback("the department owner mapping", {}, async () => {
    const snapshot = await db.doc(tenantSettingsPath(context.tenantId, "departmentOwners")).get();
    if (!snapshot.exists) return {};
    const data = snapshot.data() as Record<string, unknown> | undefined;
    const owners: DepartmentOwners = {};
    for (const department of TICKET_DEPARTMENTS) {
      const value = data?.[department];
      if (typeof value === "string" && value.trim()) owners[department] = value.trim();
    }
    return owners;
  });
}

export interface TagsResult {
  tags: ClickUpTag[];
  /** Why there are none, when there are none. Shown rather than swallowed. */
  reason?: string;
}

/**
 * The live tag list, read from the space the tickets list belongs to.
 *
 * Read rather than hardcoded, per the handoff. ClickUp keeps tags on the space, not the list, so
 * this resolves the list's space first -- the extra round trip is the price of the tags being the
 * ones that actually exist, with the colours they actually have.
 */
export async function listTicketTags(context: TenantContext): Promise<TagsResult> {
  const listId = process.env.CLICKUP_GROWTH_PILOT_LIST_ID;
  if (!listId) {
    return { tags: [], reason: "No ClickUp list is configured for tickets yet (set CLICKUP_GROWTH_PILOT_LIST_ID)." };
  }

  const connection = await getIntegrationConnection(context, "clickup");
  if (!connection || connection.status !== "connected") {
    return { tags: [], reason: "ClickUp isn't connected for this workspace yet. Connect it from Settings." };
  }
  const credentials = getIntegrationCredentials(connection);
  if (!credentials.accessToken) {
    return { tags: [], reason: "The stored ClickUp connection is missing an access token. Reconnect ClickUp." };
  }

  const headers = { authorization: credentials.accessToken };
  try {
    const listResponse = await fetch(`${CLICKUP_API}/list/${listId}`, { headers });
    if (!listResponse.ok) {
      return { tags: [], reason: `ClickUp would not return the tickets list (${listResponse.status}).` };
    }
    const spaceId = ((await listResponse.json()) as { space?: { id?: string } }).space?.id;
    if (!spaceId) {
      return { tags: [], reason: "The tickets list did not say which space it belongs to, so its tags cannot be read." };
    }

    const tagResponse = await fetch(`${CLICKUP_API}/space/${spaceId}/tag`, { headers });
    if (!tagResponse.ok) {
      return { tags: [], reason: `ClickUp would not return the space's tags (${tagResponse.status}).` };
    }
    const payload = (await tagResponse.json()) as {
      tags?: { name?: string; tag_bg?: string; tag_fg?: string }[];
    };
    return {
      tags: (payload.tags || [])
        .filter((tag) => tag.name?.trim())
        .map((tag) => ({
          name: tag.name!.trim(),
          ...(tag.tag_bg ? { background: tag.tag_bg } : {}),
          ...(tag.tag_fg ? { foreground: tag.tag_fg } : {}),
        })),
    };
  } catch (error) {
    return {
      tags: [],
      reason: `The tag list could not be read: ${error instanceof Error ? error.message : "unknown error"}.`,
    };
  }
}

/** One ticket form, pre-filled from one action line. */
function ticketFromAction(
  action: ActionLine,
  department: string,
  clientFeedback: string,
  options: { businessName: string; owners: DepartmentOwners; today: Date },
): TicketDraftForm {
  const matched = matchDepartment(action.team) || matchDepartment(department);
  const owner = departmentOwner(matched, options.owners);
  const agreed = parseIsoDay(action.due);

  // The due date the client was given beats the priority rule, and when it was said in words
  // rather than as a date it goes into the description so the promise is still visible.
  const agreedInWords = !agreed && action.due.trim() ? action.due.trim() : "";

  const description = [
    action.what.trim(),
    clientFeedback.trim() ? `Client feedback: ${clientFeedback.trim()}` : "",
    agreedInWords ? `Agreed on the call: ${agreedInWords}` : "",
    action.carryOver ? "Carry-over from a previous touch." : "",
    action.dependsOn?.trim() ? `Blocked until: ${action.dependsOn.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    id: `ticket-${action.id}`,
    formType: "ticket",
    actionId: action.id,
    taskName: action.what.trim(),
    businessName: options.businessName,
    description,
    ...(matched ? { department: matched } : {}),
    assignee: owner || OWNER_NEEDED,
    priority: "normal",
    ...(agreed
      ? { dueDate: agreed, dueDateAgreedOnCall: true }
      : { ...(dueDateForPriority("normal", options.today) ? { dueDate: dueDateForPriority("normal", options.today)! } : {}) }),
  };
}

function billingFromAction(
  action: ActionLine,
  options: { businessName: string; touchDate: string; today: Date },
): BillingDraftForm {
  return {
    id: `billing-${action.id}`,
    formType: "billing",
    actionId: action.id,
    businessName: options.businessName,
    dateRequested: options.touchDate,
    ...(parseIsoDay(action.due)
      ? { dueDate: parseIsoDay(action.due)! }
      : { ...(dueDateForPriority("normal", options.today) ? { dueDate: dueDateForPriority("normal", options.today)! } : {}) }),
    assignee: BILLING_DEFAULT_ASSIGNEE,
    details: [action.what.trim(), action.due.trim() ? `Agreed on the call: ${action.due.trim()}` : ""]
      .filter(Boolean)
      .join("\n\n"),
    // The change type is deliberately left unset. Reading "cancel" in a sentence is not the same
    // as the client cancelling, and filing the wrong one of these moves real money.
  };
}

/**
 * A pending item as the draft ticket the handoff calls for.
 *
 * It carries the `[PENDING - ...]` marker in its own name rather than only in the notes, because
 * the ticket is what somebody sees in their queue -- and a ticket that looks ready to start when
 * the information it needs has not arrived is how work gets begun twice.
 */
function ticketFromPending(
  item: PendingItem,
  options: { businessName: string; owners: DepartmentOwners; today: Date },
): TicketDraftForm {
  const department = matchDepartment(item.team);
  const owner = departmentOwner(department, options.owners) || item.owner;
  return {
    id: `pending-${item.id}`,
    formType: "ticket",
    // Keyed on the pending item so a rebuild finds the AM's edited version rather than making
    // a second ticket for the same missing thing.
    actionId: item.id,
    taskName: `${pendingMarker(item)} ${item.missing.trim()}`.trim(),
    businessName: options.businessName,
    description: [
      `Waiting on: ${item.waitingOn === "Client" ? "the client" : "AM review"}.`,
      item.from.trim() ? `From: ${item.from.trim()}` : "",
      `Chase on: ${item.reminderDate.trim() || "no date set"}.`,
      "Do not start the work until this arrives.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    ...(department ? { department } : {}),
    assignee: owner?.trim() || OWNER_NEEDED,
    priority: "low",
    ...(parseIsoDay(item.reminderDate) ? { dueDate: parseIsoDay(item.reminderDate)! } : {}),
  };
}

export interface BuildItemsResult {
  items: FollowThroughItem[];
  /** The action ids whose `what` is over the twenty-word budget, for the row chips. */
  overLongActionIds: string[];
  note?: string;
}

/**
 * Build the ticket list from the notes.
 *
 * Items the AM has already decided on are kept exactly as they are; only actions with no item
 * yet get a new form. That makes this safe to run again after the notes change.
 */
export async function buildFollowThroughItems(
  context: TenantContext,
  touchId: string,
): Promise<BuildItemsResult> {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  const notes = touch.followThrough?.notes;
  if (!notes) {
    throw new Error("Draft the notes before building the tickets.");
  }
  const client = await dataSource.getClientById(touch.clientId);
  const businessName = client?.name || "";
  const owners = await readDepartmentOwners(context);
  const today = new Date();
  const touchDate = (touch.scheduledAt || today.toISOString()).slice(0, 10);

  const existing = touch.followThrough?.items || [];
  const byActionId = new Map(existing.filter((item) => item.actionId).map((item) => [item.actionId!, item]));

  const items: FollowThroughItem[] = [];
  const overLongActionIds: string[] = [];

  for (const department of notes.departments) {
    for (const action of department.actions) {
      if (actionWordCount(action) > 20) overLongActionIds.push(action.id);

      const kept = byActionId.get(action.id);
      if (kept) {
        items.push(kept);
        continue;
      }
      items.push(
        looksLikeBilling(action)
          ? billingFromAction(action, { businessName, touchDate, today })
          : ticketFromAction(action, department.department, department.clientFeedback, {
              businessName,
              owners,
              today,
            }),
      );
    }
  }

  for (const item of notes.pending) {
    const kept = byActionId.get(item.id);
    items.push(kept || ticketFromPending(item, { businessName, owners, today }));
  }

  // Items the AM added by hand have no action line behind them, so they survive every rebuild.
  for (const item of existing) {
    if (!item.actionId) items.push(item);
  }

  const unowned = items.filter(
    (item) => item.formType === "ticket" && item.assignee === OWNER_NEEDED,
  ).length;

  return {
    items,
    overLongActionIds,
    ...(unowned
      ? {
          note: `${unowned === 1 ? "One ticket has" : `${unowned} tickets have`} no owner, because no default is configured for ${unowned === 1 ? "its department" : "their departments"}. Pick someone — an approved ticket cannot be filed without one.`,
        }
      : {}),
  };
}

/** Store the items as the AM left them. */
export async function saveFollowThroughItems(
  context: TenantContext,
  touchId: string,
  items: FollowThroughItem[],
): Promise<FollowThroughItem[]> {
  const db = getFirebaseAdminDb();
  if (db) {
    await db
      .doc(monthlyTouchPath(context.tenantId, touchId))
      .set({ followThrough: { items } }, { mergeFields: ["followThrough.items"] });
  }
  return items;
}
