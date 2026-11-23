import { readBookedNextMeeting } from "@/src/lib/server/services/next-touch-booking-service";
import { resolveRecapRecipient } from "@/src/lib/server/services/recap-recipient";
import { blockedTaskTitles } from "@/src/lib/contracts/client-content";
import { loomReady } from "@/src/lib/contracts/no-show";
import { FieldValue } from "firebase-admin/firestore";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClientRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import {
  PROCESSING_STEPS,
  approvedClientActions,
  reviewedClientActions,
  finishBlockers,
  processingOutcome,
  type ProcessingResult,
  type StepResult,
  type StepStatus,
} from "@/src/lib/contracts/follow-through-finish";
import { renderNotesMarkdown, type NotesDraft, type TicketAction } from "@/src/lib/contracts/follow-through-notes";
import {
  approvedItems,
  itemTitle,
  type FollowThroughItem,
  type TicketAttachment,
} from "@/src/lib/contracts/follow-through-tickets";
import {
  HEALTH_TRACKER_FIELDS,
  diffRow,
  trackerCardDiffs,
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
import { sendClientEmail } from "@/src/lib/server/services/client-email-service";
import { getNowIso } from "@/src/lib/server/services/mtos-ai";
import { hasPermission } from "@/src/lib/server/services/integration-permissions-service";
import { handTouchToQc } from "@/src/lib/server/services/qc-handoff-service";

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

/**
 * The files the AM attached, put on the ticket once it exists.
 *
 * ClickUp takes an attachment as multipart form data on the task, so this cannot ride along in the
 * create call and has to follow it. Like the custom fields, a failure here never fails the ticket:
 * a task missing its screenshot is one somebody can still work, and a task that was never created
 * is lost. The reasons come back so the step can say what did not make it.
 *
 * Only ever reached on the run that created the task -- an item with a recorded id is skipped well
 * before this -- so pressing Finish again cannot upload the same file twice.
 */
async function uploadItemAttachments(
  taskId: string,
  files: TicketAttachment[],
  token: string,
): Promise<string[]> {
  const problems: string[] = [];
  for (const file of files) {
    try {
      const comma = file.dataUrl.indexOf(",");
      if (comma < 0) {
        problems.push(`${file.name}: the file was not readable`);
        continue;
      }
      const bytes = Buffer.from(file.dataUrl.slice(comma + 1), "base64");
      const body = new FormData();
      body.append(
        "attachment",
        new Blob([new Uint8Array(bytes)], { type: file.mimeType || "application/octet-stream" }),
        file.name,
      );
      // No content-type header on purpose: fetch sets it with the multipart boundary, and setting
      // it by hand omits the boundary, which ClickUp rejects.
      const response = await fetch(`${CLICKUP_API}/task/${taskId}/attachment`, {
        method: "POST",
        headers: { authorization: token },
        body,
      });
      if (!response.ok) {
        problems.push(`${file.name}: ClickUp returned ${response.status}`);
      }
    } catch (error) {
      problems.push(`${file.name}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return problems;
}

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
  const attachmentProblems: string[] = [];

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

      // The attached files, for the same reason and with the same rule: after the task, never
      // blocking it.
      const files = item.attachmentFiles || [];
      if (files.length) {
        attachmentProblems.push(...(await uploadItemAttachments(payload.id, files, token)));
      }

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
    attachmentProblems.length
      ? `${attachmentProblems.length === 1 ? "one attachment" : `${attachmentProblems.length} attachments`} did not upload (${attachmentProblems.join("; ")})`
      : "",
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
    clientActions: approvedClientActions(state.notes.clientActions, state.items),
  };

  // Section 3 is the approved tickets themselves, in the form the AM approved them in. The
  // pending ones are left out of it: they already have section 6, and a ticket nobody may start
  // yet is not an action item -- listing it in both places reads as two commitments.
  const pendingIds = new Set(state.notes.pending.map((item) => item.id));
  const ticketActions: TicketAction[] = approvedItems(state.items)
    .filter((item) => !(item.actionId && pendingIds.has(item.actionId)))
    .map((item) => {
      const url = state.ticketUrls[item.id];
      return {
        // A billing change is filed on its own form rather than to a delivery team, so it is
        // grouped as what it is instead of landing under "Unassigned".
        ...(item.formType === "billing" ? { department: "Billing" } : item.department ? { department: item.department } : {}),
        what: itemTitle(item),
        ...(item.assignee?.trim() ? { owner: item.assignee.trim() } : {}),
        ...(item.dueDate?.trim() ? { due: item.dueDate.trim() } : {}),
        ...(url ? { url } : { notFiled: true }),
      };
    });

  const loomHeader = state.touch.noShow?.resolution === "loom" ? `No-Show / Loom Video Update
Loom recording: ${state.touch.noShow.url}
Client email: ${state.touch.noShow.sendStatus} (${state.touch.noShow.gmailMessageId || state.touch.noShow.conversationId})

` : "";
  const markdown = loomHeader + renderNotesMarkdown(filtered, { ticketActions });

  // The approval step created the "Monthly Touch (date)" page and recorded it. That page IS the
  // parent these notes go under, so its id is handed over as the prep page rather than letting
  // the writer search the book again and risk matching a page an AM made by hand.
  const approved = state.touch.approval?.clientBook;
  const links = state.touch.followThrough?.notesBookLinks || (approved
    ? {
        docId: approved.docId,
        prepPageId: approved.pageId,
        prepPageUrl: approved.pageUrl,
        ...(approved.postPageId ? { postPageId: approved.postPageId } : {}),
        ...(approved.postPageUrl ? { postPageUrl: approved.postPageUrl } : {}),
        writtenAt: state.touch.approval?.finishedAt || getNowIso(),
      }
    : state.touch.prepWorkflow?.filing?.links);

  const result = await writePostNotesToClientBook(state.context, {
    clientName: state.client.name,
    touchDateIso: state.touch.scheduledAt || getNowIso(),
    markdown,
    ...(links ? { links } : {}),
  });

  if ("error" in result) {
    return step("notes", "warning", result.error);
  }
  await persistProgress(state.context, state.touch.id, { notesBookLinks: result.links });
  return step("notes", "done", `Filed under “${result.pageName}”: ${result.links.postPageUrl || result.links.prepPageUrl}`);
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
      "skipped",
      "The Risk Register row was declined, so it was not written.",
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

  const outcome = await sendClientEmail(state.context, {
    contentPolicy: "agreed-recap",
    idempotencyKey: `monthly-touch:${state.touch.id}:recap`,
    recipient: resolveRecapRecipient(state.client, state.touch),
    blockedTaskTitles: blockedTaskTitles(state.touch),
    subject: recap.subject,
    html: recap.html,
    label: "recap email",
  });

  if (!outcome.sent) {
    return step("recap", "warning", outcome.detail);
  }
  await persistProgress(state.context, state.touch.id, {
    recap: { ...recap, sentAt: getNowIso(), gmailMessageId: outcome.messageId, ...(outcome.threadId ? { gmailThreadId: outcome.threadId } : {}), sentVia: outcome.sentVia },
  });
  return step("recap", "done", outcome.detail);
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
 * Calendar write access supports the explicit no-show reschedule only. Next-touch booking
 * retains the reminder fallback, including after a user grants the new write scope.
 */
async function bookNextTouch(state: StepContext): Promise<StepResult> {
  if (state.touch.nextMeetingBooking) {
    try {
      const booked = await readBookedNextMeeting(state.context, state.touch.id);
      if (booked) return step("booking", "done", "Next Monthly Touch is booked in Google Calendar for " + booked.scheduledAt + (booked.htmlLink ? ": " + booked.htmlLink : "."));
    } catch (error) { return step("booking", "warning", error instanceof Error ? error.message : "Verify the saved next meeting in Google Calendar."); }
  }
  const reminder = state.touch.followThrough;
  const previousReminder = reminder?.processing?.steps.find(entry => entry.id === "booking")?.message.match(/A reminder ticket was created instead: https:\/\/app\.clickup\.com\/t\/([a-z0-9]+)/i)?.[1];
  if (!reminder?.bookingReminderId && previousReminder) {
    await persistProgress(state.context, state.touch.id, { bookingReminderId: previousReminder, bookingReminderStatus: "created" });
    return step("booking", "warning", `The next-meeting reminder already exists (${previousReminder}). Use Book next Monthly Touch here; no duplicate reminder was created.`);
  }
  if (reminder?.bookingReminderId) return step("booking", "warning", `The next-meeting reminder already exists (${reminder.bookingReminderId}). Use Book next Monthly Touch here; no duplicate reminder was created.`);
  if (reminder?.bookingReminderStatus === "creating" || reminder?.bookingReminderStatus === "unknown") return step("booking", "warning", "The next-meeting reminder outcome is unresolved. Check ClickUp before creating another reminder.");
  // Asked of the shared permission read rather than by comparing a scope string here, so this
  // step and the Settings screen can never disagree about whether booking is allowed.
  const canWrite = await hasPermission(state.context, "calendar-write");

  const token = await clickUpToken(state.context);
  const listId = process.env.CLICKUP_GROWTH_PILOT_LIST_ID;
  const due = state.touch.followThrough?.dueAt;
  const base = canWrite
    ? "The next meeting has not been booked. Use Book next Monthly Touch on the closing presentation slide."
    : "MTOS cannot create calendar events: the connected Google account granted read-only calendar access.";

  if (!token || !listId) {
    return step("booking", "warning", `${base} Book the next Monthly Touch yourself — no reminder ticket could be created either, because ClickUp is not available.`);
  }

  try {
    await persistProgress(state.context, state.touch.id, { bookingReminderStatus: "creating" });
    const response = await fetch(`${CLICKUP_API}/list/${listId}/task`, {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({
        name: `Finish post-touch actions — ${state.client.name}`,
        description: `${base}\n\nBook the next Monthly Touch on both calendars and close this out.`,
        ...(due ? { due_date: new Date(due).getTime() } : {}),
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: string; url?: string };
    if (!response.ok || !payload.id) {
      await persistProgress(state.context, state.touch.id, { bookingReminderStatus: response.ok || response.status >= 500 ? "unknown" : "failed" });
      return step("booking", "warning", `ClickUp did not confirm a reminder task (${response.status}). Check ClickUp before retrying.`);
    }
    await persistProgress(state.context, state.touch.id, { bookingReminderId: payload.id, bookingReminderStatus: "created" });
    return step(
      "booking",
      "warning",
      `${base} A reminder ticket was created instead${payload.url ? `: ${payload.url}` : ""}.`,
    );
  } catch {
    await persistProgress(state.context, state.touch.id, { bookingReminderStatus: "unknown" });
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
  const touch = await getMtosDataSource(context).getMonthlyTouchById(touchId);
  if (!touch) throw new Error("Monthly touch not found");
  if (touch.noShow?.resolution === "loom" && !loomReady(touch)) throw new Error("Send the approved Loom update before processing Follow-Through.");
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("MTOS storage is unavailable.");
  const ref = db.doc(monthlyTouchPath(context.tenantId, touchId));
  const claim = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as { noShowProcessingAt?: string };
    if (current?.noShowProcessingAt && Date.now() - Date.parse(current.noShowProcessingAt) < 10 * 60000) throw new Error("Follow-Through is already processing. Wait before retrying.");
    tx.update(ref, { noShowProcessingAt: claim });
  });
  try { return await processFollowThroughRun(context, touchId); }
  finally { await ref.update({ noShowProcessingAt: FieldValue.delete() }); }
}

async function processFollowThroughRun(
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

  if (touch.postMeeting?.status === "approved" || touch.postMeeting?.draftTickets?.some((ticket) => ticket.clickupTaskId)) {
    throw new Error("This touch already has follow-up filed from the earlier screen. Open that screen to review what was sent.");
  }

  if (touch.noShow?.resolution === "loom" && !loomReady(touch)) throw new Error("Complete and approve the Loom email before processing Follow-Through.");
  const follow = touch.followThrough;
  const notes = follow?.notes;
  const cards = follow?.trackerCards || [];
  const diffs = Object.fromEntries(cards.map((card) => [card.id, trackerCardDiffs(card)]));

  // The same gate the screen applies, re-applied here because the screen's copy can be bypassed
  // and this one creates tickets.
  const blockers = finishBlockers({
    ...(notes ? { notes } : {}),
    ...(follow?.items ? { items: follow.items } : {}),
    trackerCards: cards,
    trackerDiffs: diffs,
    ...(follow?.recap ? { recap: follow.recap } : {}),
  });
  if (follow?.recap?.decision === "approved" && !follow.recap.sentAt && !resolveRecapRecipient(client, touch)) blockers.push("Enter and save the client's email address in Recap email before finishing.");
  if (blockers.length) {
    throw new FollowThroughNotReadyError(blockers);
  }

  const state: StepContext = {
    context,
    touch,
    client,
    notes: { ...notes!, clientActions: reviewedClientActions(notes!.clientActions, follow?.items || []) },
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
  if (JSON.stringify(state.notes.clientActions) !== JSON.stringify(notes!.clientActions)) await persistProgress(context, touchId, { notes: state.notes });

  const steps: StepResult[] = [];
  for (const definition of PROCESSING_STEPS) {
    const previous = follow?.processing?.steps.find(entry => entry.id === definition.id);
    if (previous?.status === "done") {
      steps.push(previous);
      continue;
    }
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
    const checkpoint = PROCESSING_STEPS.flatMap(definition => {
      const known = steps.find(entry => entry.id === definition.id) || follow?.processing?.steps.find(entry => entry.id === definition.id);
      return known ? [known] : [];
    });
    await persistProgress(context, touchId, { processing: { steps: checkpoint, ticketUrls: state.ticketUrls } });
  }

  const result: ProcessingResult = {
    steps,
    ticketUrls: state.ticketUrls,
    processedAt: getNowIso(),
  };

  await persistProgress(context, touchId, {
    processing: result,
    ...(processingOutcome(steps) === "processed" ? { finishedAt: result.processedAt } : {}),
    ticketIds: state.ticketIds,
    ticketUrls: state.ticketUrls,
  });

  // Include each step's persisted receipts and destination links in the QA evidence.
  const latest = await dataSource.getMonthlyTouchById(touchId);
  const finished: MonthlyTouchRecord = {
    ...(latest || touch),
    followThrough: {
      ...(latest || touch).followThrough,
      processing: result,
      finishedAt: result.processedAt,
      ticketIds: state.ticketIds,
      ticketUrls: state.ticketUrls,
    },
  };

  // Last, and never allowed to undo the run. Everything above this point has already been written
  // out to ClickUp, Intercom and the trackers; a handoff that threw and turned the whole call into
  // an error would invite the AM to press Finish again, having been told nothing happened when in
  // fact all of it did.
  if (processingOutcome(steps) !== "processed") {
    result.qc = { created: false, notified: 0, message: "Follow-through still has unfinished steps. Resolve the warnings and run the unfinished steps again before continuing to QA." };
  } else try {
    const handoff = await handTouchToQc(context, finished, client);
    result.qc = {
      created: handoff.created,
      notified: handoff.notified.length,
      message: handoff.message,
      ready: handoff.created || Boolean(handoff.qc),
    };
  } catch (error) {
    result.qc = {
      created: false,
      notified: 0,
      ready: false,
      message: `The follow-through is filed, but the touch could not be sent to QC: ${
        error instanceof Error ? error.message : "unknown error"
      }. Nothing was lost -- press Finish again to retry the handoff.`,
    };
  }

  // A second write, on purpose. The run itself is persisted above, before the handoff, because
  // that record is what makes every step skip itself on a retry -- losing it would mean a second
  // Finish creating a second set of tickets. So the handoff's outcome follows in its own write
  // rather than being held back to join the first one.
  await persistProgress(context, touchId, { processing: result });

  return result;
}
