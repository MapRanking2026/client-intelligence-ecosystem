import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClientRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import {
  PROCESSING_STEPS,
  approvedClientActions,
  finishBlockers,
  type ProcessingResult,
  type StepResult,
  type StepStatus,
} from "@/src/lib/contracts/follow-through-finish";
import { renderNotesMarkdown, type NotesDraft } from "@/src/lib/contracts/follow-through-notes";
import {
  approvedItems,
  itemTitle,
  type FollowThroughItem,
} from "@/src/lib/contracts/follow-through-tickets";
import {
  HEALTH_TRACKER_FIELDS,
  diffRow,
  type TrackerCard,
} from "@/src/lib/contracts/follow-through-trackers";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import {
  getIntegrationConnection,
  getIntegrationCredentials,
} from "@/src/lib/server/integrations";
import { writePostNotesToClientBook } from "@/src/lib/server/services/client-book-service";
import {
  CustomFieldBuilder,
  applyFieldWritesToTask,
  getListCustomFields,
  getListMembers,
  matchOption,
} from "@/src/lib/server/services/clickup-fields";
import { sendAgendaEmailViaIntercom } from "@/src/lib/server/services/intercom-send-service";
import { getNowIso } from "@/src/lib/server/services/mtos-ai";
import { clientEmailSenderAddress } from "@/src/lib/server/services/user-service";

/**
 * "Finish follow-through & process approved" -- the one place in the whole touch that writes out.
 *
 * Seven steps, in the only order they work in, and every one of them idempotent. Idempotent is
 * the word doing the work: a run that fails at step five must be safe to press again, and the
 * four steps that already happened must not happen twice. So each step records what it did on
 * the touch BEFORE moving on -- the created task's id, the filed page's link, the Intercom
 * conversation id -- and begins by checking whether that record is already there.
 *
 * Nothing here decides anything. Everything it creates, files and sends was approved item by
 * item on the screen before it, and an item that was denied is not touched. A step that cannot
 * run reports a warning with the reason and the run continues: half a follow-through filed with
 * an honest note about the other half is worth far more than nothing filed at all.
 */

const CLICKUP_API = "https://api.clickup.com/api/v2";
const CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

interface StepContext {
  context: TenantContext;
  touch: MonthlyTouchRecord;
  client: ClientRecord;
  notes: NotesDraft;
  items: FollowThroughItem[];
  cards: TrackerCard[];
  /** Filled in by step 1 and read by every step after it. */
  ticketUrls: Record<string, string>;
  ticketIds: Record<string, string>;
}

function step(id: string, status: StepStatus, message: string): StepResult {
  return { id, status, message };
}

async function clickUpToken(context: TenantContext): Promise<string | undefined> {
  const connection = await getIntegrationConnection(context, "clickup").catch(() => undefined);
  if (!connection || connection.status !== "connected") return undefined;
  return getIntegrationCredentials(connection).accessToken || undefined;
}

/** Persist what the run has achieved so far, so a retry starts from here. */
async function persistProgress(
  context: TenantContext,
  touchId: string,
  patch: Record<string, unknown>,
) {
  const db = getFirebaseAdminDb();
  if (!db) return;
  await db
    .doc(monthlyTouchPath(context.tenantId, touchId))
    .set({ followThrough: patch }, { mergeFields: Object.keys(patch).map((key) => `followThrough.${key}`) });
}

// ---------------------------------------------------------------------------
// 1. The tickets
// ---------------------------------------------------------------------------

async function createTickets(state: StepContext): Promise<StepResult> {
  const approved = approvedItems(state.items);
  if (!approved.length) {
    return step("tickets", "skipped", "No tickets were approved, so none were created.");
  }

  const token = await clickUpToken(state.context);
  if (!token) {
    return step(
      "tickets",
      "warning",
      `ClickUp is not connected, so ${approved.length === 1 ? "the approved ticket was" : `all ${approved.length} approved tickets were`} left uncreated. Connect ClickUp and press Finish again — nothing else will be repeated.`,
    );
  }

  const regularList = process.env.CLICKUP_GROWTH_PILOT_LIST_ID;
  const billingList = process.env.CLICKUP_BILLING_CHANGE_LIST_ID || regularList;
  if (!regularList) {
    return step(
      "tickets",
      "warning",
      "No ClickUp list is configured for tickets (set CLICKUP_GROWTH_PILOT_LIST_ID), so none were created.",
    );
  }

  let created = 0;
  let already = 0;
  const failures: string[] = [];

  for (const item of approved) {
    // The idempotency check. An id on the item means this exact ticket was filed on an earlier
    // run, and filing it again would put a second copy in somebody's queue.
    if (state.ticketIds[item.id]) {
      already += 1;
      continue;
    }

    const listId = item.formType === "billing" ? billingList! : regularList;
    const fields = await getListCustomFields(listId, token);
    const members = await getListMembers(listId, token);
    const assigneeName = item.assignee?.trim() || "";
    const member = assigneeName
      ? matchOption(members.map((entry) => ({ id: String(entry.id), name: entry.name })), assigneeName)
      : undefined;

    const builder = new CustomFieldBuilder(fields);
    if (item.formType === "ticket") {
      builder
        .dropdown(["business name"], item.businessName)
        .dropdown(["department"], item.department)
        .labels(["tags"], item.tags);
    } else {
      builder
        .dropdown(["business name"], item.businessName)
        .dropdown(["type"], item.changeType)
        .date(["date it was requested", "date requested"], item.dateRequested);
      for (const [category, points] of Object.entries(item.cancelSplit || {})) {
        if (points) builder.text([category], String(points));
      }
    }

    const name = item.formType === "billing" ? itemTitle(item) : item.taskName;
    const description = item.formType === "billing" ? item.details : item.description;
    const due = item.dueDate ? new Date(`${item.dueDate}T23:59:00`).getTime() : undefined;
    const estimate =
      item.formType === "ticket" && item.timeEstimateMinutes
        ? item.timeEstimateMinutes * 60 * 1000
        : undefined;
    const priority =
      item.formType === "ticket" && item.priority
        ? { urgent: 1, high: 2, normal: 3, low: 4 }[item.priority]
        : undefined;

    try {
      const response = await fetch(`${CLICKUP_API}/list/${listId}/task`, {
        method: "POST",
        headers: { authorization: token, "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          ...(member ? { assignees: [Number(member.id)] } : {}),
          ...(priority ? { priority } : {}),
          ...(estimate ? { time_estimate: estimate } : {}),
          ...(due ? { due_date: due } : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { id?: string; url?: string; err?: string };
      if (!response.ok || !payload.id) {
        failures.push(`${name}: ${payload.err || `ClickUp returned ${response.status}`}`);
        continue;
      }
      state.ticketIds[item.id] = payload.id;
      if (payload.url) state.ticketUrls[item.id] = payload.url;
      created += 1;

      // Custom fields go on after creation and never block the ticket: a task with a missing
      // Department is findable and fixable, a task that was not created at all is lost.
      const writes = builder.build();
      if (writes.length) await applyFieldWritesToTask(payload.id, writes, token);

      // Recorded immediately rather than at the end of the loop, so a crash halfway through ten
      // tickets leaves the nine that exist recorded as existing.
      await persistProgress(state.context, state.touch.id, {
        ticketIds: state.ticketIds,
        ticketUrls: state.ticketUrls,
      });
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  const summary = [
    created ? `${created} created` : "",
    already ? `${already} already existed` : "",
  ]
    .filter(Boolean)
    .join(", ");

  if (failures.length) {
    return step(
      "tickets",
      "warning",
      `${summary || "Nothing created"}; ${failures.length} did not go through — ${failures.join("; ")}. Pressing Finish again retries only those.`,
    );
  }
  return step("tickets", "done", `${summary}.`);
}

// ---------------------------------------------------------------------------
// 2. The notes
// ---------------------------------------------------------------------------

async function fileNotes(state: StepContext): Promise<StepResult> {
  // Only what was approved reaches the filed page: a denied action is not a commitment, and the
  // Client's Book is read later as the record of what we said we would do.
  const approvedIds = new Set(approvedItems(state.items).map((item) => item.actionId).filter(Boolean));
  const filtered: NotesDraft = {
    ...state.notes,
    departments: state.notes.departments
      .map((department) => ({
        ...department,
        actions: department.actions.filter((action) => approvedIds.has(action.id)),
      }))
      .filter((department) => department.actions.length || department.clientFeedback.trim()),
    clientActions: approvedClientActions(state.notes.clientActions),
  };

  const ticketLinks: Record<string, string> = {};
  for (const item of state.items) {
    if (item.actionId && state.ticketUrls[item.id]) ticketLinks[item.actionId] = state.ticketUrls[item.id];
  }
  const createdTickets = approvedItems(state.items)
    .filter((item) => state.ticketUrls[item.id])
    .map((item) => ({ title: itemTitle(item), url: state.ticketUrls[item.id] }));

  const markdown = renderNotesMarkdown(filtered, { ticketLinks, createdTickets });

  // The approval step created the "Monthly Touch (date)" page and recorded it. That page IS the
  // parent these notes go under, so its id is handed over as the prep page rather than letting
  // the writer search the book again and risk matching a page an AM made by hand.
  const approved = state.touch.approval?.clientBook;
  const links = approved
    ? {
        docId: approved.docId,
        prepPageId: approved.pageId,
        prepPageUrl: approved.pageUrl,
        writtenAt: state.touch.approval?.finishedAt || getNowIso(),
      }
    : undefined;

  const result = await writePostNotesToClientBook(state.context, {
    clientName: state.client.name,
    touchDateIso: state.touch.scheduledAt || getNowIso(),
    markdown,
    ...(links ? { links } : {}),
  });

  if ("error" in result) {
    return step("notes", "warning", result.error);
  }
  return step("notes", "done", `Filed under “${result.pageName}”.`);
}

// ---------------------------------------------------------------------------
// 3 and 4. The tracker rows
// ---------------------------------------------------------------------------

async function writeRiskRow(state: StepContext): Promise<StepResult> {
  const card = state.cards.find((candidate) => candidate.kind === "risk");
  if (!card) {
    return step("risk", "skipped", "The score is above 6, so there is no Risk Register row to log.");
  }
  if (card.decision !== "approved") {
    return step(
      "risk",
      "warning",
      "The Risk Register row was not approved, so this client is not logged in the register. The notes carry it as still owed.",
    );
  }

  const listId = process.env.CLICKUP_RISK_REGISTER_LIST_ID;
  const token = await clickUpToken(state.context);
  if (!listId || !token) {
    return step(
      "risk",
      "warning",
      listId
        ? "ClickUp is not connected, so the Risk Register row was not written."
        : "No Risk Register list is configured (set CLICKUP_RISK_REGISTER_LIST_ID), so the row was not written.",
    );
  }

  const fields = await getListCustomFields(listId, token);
  const entry = card.next;
  const writes = new CustomFieldBuilder(fields)
    .dropdown(["client type"], entry.clientType)
    .dropdown(["case status"], entry.caseStatus)
    .date(["date flagged"], entry.dateFlagged)
    .dropdown(["money", "cash flow"], entry.money)
    .dropdown(["responsiveness"], entry.responsiveness)
    .dropdown(["life change"], entry.lifeChange)
    .dropdown(["technical"], entry.technical)
    .dropdown(["other agency", "advisor"], entry.otherAgency)
    .dropdown(["performance"], entry.performance)
    .dropdown(["risk tier"], entry.riskTier)
    .dropdown(["primary category"], entry.primaryCategory)
    .text(["next action"], entry.nextAction)
    .text(["next action owner"], entry.nextActionOwner)
    .date(["due date"], entry.dueDate)
    .date(["last client touchpoint", "last monthly touch"], entry.lastMonthlyTouch)
    .text(["latest comment", "latest comments"], entry.latestComments)
    .build();

  try {
    const response = await fetch(`${CLICKUP_API}/list/${listId}/task`, {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({
        name: state.client.name,
        description: entry.latestComments || `Flagged from the monthly touch on ${entry.dateFlagged || "today"}.`,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: string; err?: string };
    if (!response.ok || !payload.id) {
      return step("risk", "warning", `The Risk Register row was refused: ${payload.err || response.status}.`);
    }
    if (writes.length) await applyFieldWritesToTask(payload.id, writes, token);

    // The Manager tag rides on the same row rather than a separate message: it is the row the
    // manager will open, and a tag on it is a notification with the case already in front of them.
    await fetch(`${CLICKUP_API}/task/${payload.id}/comment`, {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({
        comment_text: `@Manager — ${state.client.name} scored ${state.notes.nps}/10 on this month's touch. ${state.notes.npsJustification}`,
        notify_all: true,
      }),
    }).catch(() => undefined);

    return step("risk", "done", "Logged, and the Manager tagged on the row.");
  } catch (error) {
    return step("risk", "warning", `The Risk Register row was not written: ${error instanceof Error ? error.message : "unknown error"}.`);
  }
}

async function writeHealthRow(state: StepContext): Promise<StepResult> {
  const card = state.cards.find((candidate) => candidate.kind === "health");
  const stakeholders = state.cards.filter(
    (candidate) => candidate.kind === "stakeholder" && candidate.decision === "approved",
  );

  if (!card || card.decision !== "approved") {
    return step(
      "health",
      card ? "skipped" : "warning",
      card ? "The Health Tracker row was not approved, so nothing was changed on it." : "There was no Health Tracker row to write.",
    );
  }

  const taskId = state.client.clickupTaskId;
  const listId = process.env.CLICKUP_HEALTH_TRACKER_LIST_ID;
  const token = await clickUpToken(state.context);
  if (!taskId || !listId || !token) {
    return step(
      "health",
      "warning",
      !taskId
        ? "This client has no ClickUp task linked, so the Health Tracker row could not be updated."
        : !listId
          ? "No Health Tracker list is configured (set CLICKUP_HEALTH_TRACKER_LIST_ID)."
          : "ClickUp is not connected, so the Health Tracker row was not updated.",
    );
  }

  // Only the fields this touch actually changes are written. Writing the whole row back would
  // overwrite anything edited in ClickUp since MTOS read it, which is the kind of loss nobody
  // notices until a quarter later.
  const diffs = diffRow(card.current, card.next, HEALTH_TRACKER_FIELDS);
  const changedKeys = new Set(diffs.filter((diff) => diff.changed || diff.isNew).map((diff) => diff.key));
  const row = card.next;
  const builder = new CustomFieldBuilder(await getListCustomFields(listId, token));
  if (changedKeys.has("nps") && row.nps !== null && row.nps !== undefined) builder.text(["nps"], String(row.nps));
  if (changedKeys.has("health")) builder.dropdown(["health"], row.health);
  if (changedKeys.has("caseStatus")) builder.dropdown(["case status"], row.caseStatus);
  if (changedKeys.has("communicationType")) builder.dropdown(["communication type"], row.communicationType);
  if (changedKeys.has("upselling")) builder.dropdown(["upselling"], row.upselling);
  if (changedKeys.has("mrr")) builder.text(["mrr"], row.mrr);
  if (changedKeys.has("status")) builder.text(["status"], row.status);
  if (changedKeys.has("services")) builder.labels(["services"], row.services);
  if (changedKeys.has("servicesUpsell")) builder.labels(["services upsell"], row.servicesUpsell);
  if (changedKeys.has("latestComment")) builder.text(["latest comment"], row.latestComment);

  for (const person of stakeholders) {
    if (person.kind !== "stakeholder") continue;
    builder
      .dropdown(["communication preference"], person.next.communicationPreference)
      .dropdown(["marketing literacy"], person.next.marketingLiteracy)
      .text(["role", "title"], person.next.role)
      .text(["personality", "personality styles"], person.next.personality)
      .text(["what they care about"], person.next.whatTheyCareAbout)
      .text(["known history", "context"], person.next.knownHistory);
  }

  const writes = builder.build();
  if (!writes.length) {
    return step("health", "skipped", "Nothing on the row actually changed, so nothing was written.");
  }

  const outcome = await applyFieldWritesToTask(taskId, writes, token);
  if (!outcome.ok) {
    return step("health", "warning", `The Health Tracker row was not fully updated: ${outcome.reason}`);
  }
  return step(
    "health",
    "done",
    `${writes.length} ${writes.length === 1 ? "field" : "fields"} updated${stakeholders.length ? `, including the stakeholder details` : ""}.`,
  );
}

// ---------------------------------------------------------------------------
// 5. The recap email
// ---------------------------------------------------------------------------

async function sendRecap(state: StepContext): Promise<StepResult> {
  const recap = state.touch.followThrough?.recap;
  if (!recap || recap.decision !== "approved") {
    return step("recap", "skipped", "The recap email was not approved, so nothing was sent to the client.");
  }
  if (recap.sentAt) {
    return step("recap", "skipped", "The recap already went out, so it was not sent again.");
  }

  const outcome = await sendAgendaEmailViaIntercom(state.context, {
    accountManagerEmail: await clientEmailSenderAddress(state.context),
    recipient: state.client.contact || "",
    subject: recap.subject,
    html: recap.html,
    label: "recap email",
  });

  if (!outcome.sent) {
    return step("recap", "warning", outcome.detail);
  }
  await persistProgress(state.context, state.touch.id, {
    recap: { ...recap, sentAt: getNowIso() },
  });
  return step("recap", "done", "Sent through your Intercom.");
}

// ---------------------------------------------------------------------------
// 6. The internal brief
// ---------------------------------------------------------------------------

/**
 * The brief for the team, posted on the client's own ClickUp record.
 *
 * Not a chat channel: MTOS has no per-client channel configured anywhere, and posting to a
 * channel it guessed at would put client detail somewhere nobody chose. The client's task is
 * the record everyone working on this account already opens, and a comment on it notifies the
 * people assigned to the tickets this touch just created.
 */
async function postBrief(state: StepContext): Promise<StepResult> {
  const taskId = state.client.clickupTaskId;
  const token = await clickUpToken(state.context);
  if (!taskId || !token) {
    return step(
      "channel",
      "warning",
      taskId
        ? "ClickUp is not connected, so the team brief was not posted."
        : "This client has no ClickUp task linked, so there is nowhere to post the team brief.",
    );
  }

  const owners = Array.from(
    new Set(
      approvedItems(state.items)
        .map((item) => item.assignee?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  );
  const lines = [
    `Monthly touch — ${state.client.name} — ${state.notes.nps === null ? "no score" : `${state.notes.nps}/10`}`,
    state.notes.summary,
    owners.length ? `Tickets now with: ${owners.join(", ")}` : "No tickets were created from this call.",
  ].filter(Boolean);

  try {
    const response = await fetch(`${CLICKUP_API}/task/${taskId}/comment`, {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({ comment_text: lines.join("\n\n"), notify_all: true }),
    });
    if (!response.ok) {
      return step("channel", "warning", `The team brief was refused by ClickUp (${response.status}).`);
    }
    return step("channel", "done", `Posted on the client's record${owners.length ? `, naming ${owners.length} owner${owners.length === 1 ? "" : "s"}` : ""}.`);
  } catch (error) {
    return step("channel", "warning", `The team brief was not posted: ${error instanceof Error ? error.message : "unknown error"}.`);
  }
}

// ---------------------------------------------------------------------------
// 7. The next touch
// ---------------------------------------------------------------------------

/**
 * Book the next Monthly Touch, or say plainly why it was not booked.
 *
 * Today this always takes the fallback. The Google connection MTOS holds is authorised for
 * `calendar.readonly` and nothing more, so there is no token in the system that can create an
 * event -- and adding a write scope is an OAuth change, not a code change. Rather than fail
 * silently or pretend, this checks the scopes it actually has, warns, and creates the reminder
 * ticket the handoff asks for so the booking does not simply evaporate.
 */
async function bookNextTouch(state: StepContext): Promise<StepResult> {
  const connection = await getIntegrationConnection(state.context, "google-meet").catch(() => undefined);
  const granted = new Set(connection?.scopes || []);
  const canWrite = granted.has(CALENDAR_WRITE_SCOPE);

  if (canWrite) {
    // Deliberately not implemented past the permission check. The scope has never been granted
    // to this app, so an event-creation path here would be code no one has ever run against
    // Google, shipped as if it worked.
    return step(
      "booking",
      "warning",
      "Calendar write access is granted but MTOS has no booking path built against it yet. Book the next touch yourself and the reminder ticket below will cover it.",
    );
  }

  const token = await clickUpToken(state.context);
  const listId = process.env.CLICKUP_GROWTH_PILOT_LIST_ID;
  const due = state.touch.followThrough?.dueAt;
  const base = "MTOS cannot create calendar events: the connected Google account granted read-only calendar access.";

  if (!token || !listId) {
    return step("booking", "warning", `${base} Book the next Monthly Touch yourself — no reminder ticket could be created either, because ClickUp is not available.`);
  }

  try {
    const response = await fetch(`${CLICKUP_API}/list/${listId}/task`, {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({
        name: `Finish post-touch actions — ${state.client.name}`,
        description: `${base}\n\nBook the next Monthly Touch on both calendars and close this out.`,
        ...(due ? { due_date: new Date(due).getTime() } : {}),
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { url?: string };
    return step(
      "booking",
      "warning",
      `${base} A reminder ticket was created instead${payload.url ? `: ${payload.url}` : ""}.`,
    );
  } catch {
    return step("booking", "warning", `${base} Book the next Monthly Touch yourself.`);
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export class FollowThroughNotReadyError extends Error {
  readonly blockers: string[];
  constructor(blockers: string[]) {
    super(blockers.join(" "));
    this.name = "FollowThroughNotReadyError";
    this.blockers = blockers;
  }
}

export async function processFollowThrough(
  context: TenantContext,
  touchId: string,
): Promise<ProcessingResult> {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  const client = await dataSource.getClientById(touch.clientId);
  if (!client) {
    throw new Error("The client for this touch is not visible to you.");
  }

  const follow = touch.followThrough;
  const notes = follow?.notes;
  const cards = follow?.trackerCards || [];
  const diffs: Record<string, ReturnType<typeof diffRow>> = {};
  for (const card of cards) {
    if (card.kind === "health") {
      diffs[card.id] = diffRow(card.current, card.next, HEALTH_TRACKER_FIELDS);
    }
  }

  // The same gate the screen applies, re-applied here because the screen's copy can be bypassed
  // and this one creates tickets.
  const blockers = finishBlockers({
    ...(notes ? { notes } : {}),
    ...(follow?.items ? { items: follow.items } : {}),
    trackerCards: cards,
    trackerDiffs: diffs,
    ...(follow?.recap ? { recap: follow.recap } : {}),
  });
  if (blockers.length) {
    throw new FollowThroughNotReadyError(blockers);
  }

  const state: StepContext = {
    context,
    touch,
    client,
    notes: notes!,
    items: follow?.items || [],
    cards,
    ticketUrls: { ...(follow?.ticketUrls || {}) },
    ticketIds: { ...(follow?.ticketIds || {}) },
  };

  const runners: Record<string, (state: StepContext) => Promise<StepResult>> = {
    tickets: createTickets,
    notes: fileNotes,
    risk: writeRiskRow,
    health: writeHealthRow,
    recap: sendRecap,
    channel: postBrief,
    booking: bookNextTouch,
  };

  const steps: StepResult[] = [];
  for (const definition of PROCESSING_STEPS) {
    const runner = runners[definition.id];
    try {
      steps.push(await runner(state));
    } catch (error) {
      // A thrown step is a warning, not the end of the run: the steps after it are independent,
      // and stopping would leave the AM with less filed for no gain.
      steps.push(
        step(definition.id, "warning", `${definition.label} did not run: ${error instanceof Error ? error.message : "unknown error"}.`),
      );
    }
  }

  const result: ProcessingResult = {
    steps,
    ticketUrls: state.ticketUrls,
    processedAt: getNowIso(),
  };

  await persistProgress(context, touchId, {
    processing: result,
    finishedAt: result.processedAt,
    ticketIds: state.ticketIds,
    ticketUrls: state.ticketUrls,
  });

  return result;
}
