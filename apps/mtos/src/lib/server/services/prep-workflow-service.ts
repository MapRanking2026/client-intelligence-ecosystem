import type { TenantContext } from "@/src/lib/contracts/mtos";
import {
  emptyPrepWorkflowState,
  type ConfirmationEmailState,
  type PrepCommsVerification,
  type PrepSourceCheck,
  type PrepStageId,
  type PrepWorkflowState,
} from "@/src/lib/contracts/prep-workflow";
import type { IntegrationProviderId } from "@/src/lib/contracts/integrations";
import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import {
  refreshGbpInsightsForClient,
  refreshGhlLeadsForClient,
  refreshSnapshotsForPrep,
  refreshTouchScheduleForClient,
  type PrepSnapshotRefresh,
  type TouchScheduleRefreshResult,
} from "@/src/lib/server/integration-sync";
import { getIntegrationConnection } from "@/src/lib/server/integrations";
import { filePrepNotesToClientBook } from "@/src/lib/server/services/client-book-service";
import {
  generateConfirmationEmail,
  resolveRecipient,
  sendConfirmationEmail,
  type GenerateConfirmationEmailOptions,
} from "@/src/lib/server/services/confirmation-email-service";
import { readClientInbox } from "@/src/lib/server/services/intercom-service";
import { generatePrepDocument } from "@/src/lib/server/services/prep-document-service";
import {
  blockedReason,
  isPrepDocumentComplete,
  isStageOpen,
  recomputeGates,
} from "@/src/lib/server/services/prep-workflow-rules";
import { prepareMonthlyTouch } from "@/src/lib/server/services/monthly-touch-prep-service";
import { computeConfidence, computeReadiness, deriveTouchStatus } from "@/src/lib/server/services/prep-readiness-service";
import { getNowIso, stripUndefinedDeep } from "@/src/lib/server/services/mtos-ai";

/**
 * The preparation workflow, enforced.
 *
 * Four stages, in one order: prepare the Monthly Touch, generate and send the client confirmation
 * email, write the structured preparation notes, file them in ClickUp with the empty post-meeting
 * subpage. The order lives here, in the application logic, not in the position of the buttons on a
 * screen -- a stage whose prerequisite is not genuinely satisfied is refused, whatever the caller
 * asks for.
 *
 * Every stage records its own outcome, so the screen never has to infer. A stage that failed stays
 * failed and says why, and retrying is safe: a second filing edits the page MTOS already wrote, and
 * a second send of an approved email is refused once it has gone.
 */

export class PrepStageBlockedError extends Error {
  constructor(
    readonly stage: PrepStageId,
    message: string,
  ) {
    super(message);
    this.name = "PrepStageBlockedError";
  }
}

function workflowOf(touch: MonthlyTouchRecord): PrepWorkflowState {
  return touch.prepWorkflow ?? emptyPrepWorkflowState(getNowIso());
}

/** Refuse a stage whose prerequisite is not satisfied. The message is the one the AM reads. */
function assertStageOpen(workflow: PrepWorkflowState, stage: PrepStageId) {
  if (!isStageOpen(workflow, stage)) {
    throw new PrepStageBlockedError(stage, blockedReason(stage));
  }
}

async function loadTouch(context: TenantContext, touchId: string) {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) throw new Error("Monthly touch not found");
  const client = await dataSource.getClientById(touch.clientId);
  if (!client) {
    throw new Error("MTOS can't see this touch's client, so the preparation has no account to work from.");
  }
  return { touch, client };
}

/**
 * Persist the workflow and the scores derived from it.
 *
 * Readiness, confidence and the touch's own status are written together with the workflow, from the
 * same state, in one place -- which is what stops the list, the run-sheet and the board ever
 * disagreeing about whether a touch is ready.
 */
async function persist(
  context: TenantContext,
  touch: MonthlyTouchRecord,
  workflow: PrepWorkflowState,
): Promise<MonthlyTouchRecord> {
  const gated = recomputeGates({ ...workflow, updatedAt: getNowIso() });
  const withWorkflow: MonthlyTouchRecord = { ...touch, prepWorkflow: gated };
  const readiness = computeReadiness(withWorkflow);
  const confidence = computeConfidence(withWorkflow);
  const finalWorkflow: PrepWorkflowState = stripUndefinedDeep({ ...gated, readiness, confidence });

  const updated: MonthlyTouchRecord = stripUndefinedDeep({
    ...withWorkflow,
    prepWorkflow: finalWorkflow,
    readinessScore: readiness.score ?? 0,
    confidenceScore: confidence.score ?? 0,
    status: deriveTouchStatus(withWorkflow, readiness),
    updatedAt: getNowIso(),
  });

  const db = getFirebaseAdminDb();
  if (db) {
    await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(
      {
        // `finalWorkflow` is stripped above, and it has to stay that way.
        //
        // An unstripped workflow here is what made "Approve this wording" look like a dead
        // button. Approving writes `lastError: undefined` to clear a previous failure, and
        // MTOS's Firestore is the one Admin app that does NOT set `ignoreUndefinedProperties`,
        // so the driver threw "Cannot use undefined as a Firestore value (found in field
        // prepWorkflow.confirmationEmail.lastError)", the whole approval was lost, and the AM
        // saw a button that did nothing. Do not hand a raw workflow to this write.
        prepWorkflow: finalWorkflow,
        readinessScore: updated.readinessScore,
        confidenceScore: updated.confidenceScore,
        status: updated.status,
        updatedAt: updated.updatedAt,
      },
      { merge: true },
    );
  }

  return updated;
}

/**
 * Which evidence sources the account review could actually reach.
 *
 * Recorded per run rather than inferred later, because "not connected" and "connected but it did
 * not answer" are different facts and the preparation document is not allowed to blur them. The
 * client-email rule is the strict one: a missing email is only a finding once BOTH Intercom and the
 * support inbox have been read.
 */
async function recordSourceChecks(
  context: TenantContext,
  touch: MonthlyTouchRecord,
  /**
   * What the per-client Business Profile re-read achieved this run, if anything.
   *
   * Said out loud on the Business Profile line because "last synced <date>" was the one thing on
   * this screen that could quietly be yesterday's answer: the AM has no other way to tell whether
   * the review count in front of them was read a minute ago or at nine this morning.
   */
  gbpRefresh?: { status: "refreshed" | "skipped" | "failed"; locations: number; detail: string },
  /**
   * What the calendar re-read concluded about when this meeting actually is. Shown on the Calendar
   * line for the same reason: a stale meeting time is the one piece of stale data that gets
   * repeated back to the client in writing.
   */
  scheduleRefresh?: TouchScheduleRefreshResult,
  /**
   * What the re-pull of every other platform achieved. Each provider says here whether the
   * figures below it were pulled for this run or are older, and how much older -- the one thing
   * this panel could not previously tell anybody.
   */
  snapshotRefreshes: PrepSnapshotRefresh[] = [],
  /** What the per-client GoHighLevel read achieved, which outranks the tenant pull on that line. */
  ghlRefresh?: { status: string; detail: string },
): Promise<{ sourceChecks: PrepSourceCheck[]; commsVerification: PrepCommsVerification }> {
  const refreshedByProvider = new Map(snapshotRefreshes.map((entry) => [entry.providerId, entry]));
  // Needed only for the client's email address, which is what turns the Intercom read from a weak
  // name match into real evidence. A client that can't be loaded degrades the Intercom check; it
  // never fails the stage.
  const client = await getMtosDataSource(context)
    .getClientById(touch.clientId)
    .catch(() => undefined);

  const answered = new Map(
    (touch.prepPack?.integrationSources ?? []).map((source) => [source.providerId, source]),
  );

  const providers: { id: IntegrationProviderId; label: string }[] = [
    { id: "clickup", label: "ClickUp (Client's Book, tickets, Health Tracker)" },
    { id: "gmail", label: "Gmail (support inbox)" },
    { id: "google-calendar", label: "Google Calendar (the meeting and last month's call)" },
    { id: "gohighlevel", label: "GoHighLevel (leads and calls)" },
    { id: "google-ads", label: "Google Ads" },
    { id: "google-lsa", label: "Google Local Services Ads" },
    { id: "meta-ads", label: "Meta Ads" },
    { id: "google-business-profile", label: "Google Business Profile" },
    { id: "rank-tracker", label: "Rank Tracker and geo-grid scans" },
    { id: "map-checkins", label: "Map Check-Ins" },
  ];

  const checks: PrepSourceCheck[] = [];
  for (const provider of providers) {
    const connection = await getIntegrationConnection(context, provider.id).catch(() => undefined);
    const connected = Boolean(connection && connection.status === "connected");
    const source = answered.get(provider.id);
    let freshness = "";
    if (provider.id === "google-business-profile" && gbpRefresh) {
      freshness =
        gbpRefresh.status === "refreshed"
          ? ` Re-read for this client at the start of this run, so the listing figures are current (${gbpRefresh.locations} location${gbpRefresh.locations === 1 ? "" : "s"}).`
          : ` ${gbpRefresh.detail}`;
    }
    if (provider.id === "google-calendar" && scheduleRefresh) {
      freshness = ` ${scheduleRefresh.detail}`;
    }
    const refreshed = refreshedByProvider.get(provider.id);
    if (refreshed) {
      freshness = ` ${refreshed.detail}`;
    }
    // The per-client read is the one the brief's lead numbers actually come from, so it has the
    // last word on this line over the tenant-wide pull above it.
    if (provider.id === "gohighlevel" && ghlRefresh) {
      freshness = ` ${ghlRefresh.detail}`;
    }
    checks.push({
      key: provider.id,
      label: provider.label,
      checked: connected,
      reachable: connected && Boolean(source),
      detail:
        (!connected
          ? "Not connected in MTOS, so this source was not checked."
          : source
            ? `${source.summary} (last synced ${source.syncedAt}).`
            : "Connected, but it returned nothing for this client in this run.") + freshness,
    });
  }

  // Intercom is the shared inbox the AMs actually answer client email through, and the preparation
  // requirements make it the FIRST place to look before saying anything about an email. It is read
  // live for this one client rather than taken from a nightly snapshot, because the question is
  // always about this client in this window. `checked` is set only when the inbox genuinely
  // answered -- a weak name-only match and an unreachable inbox both stay unchecked, so the
  // document can never imply both inboxes were verified when they were not.
  const clientEmail = client ? resolveRecipient(client, touch).recipient : "";
  const inbox = await readClientInbox(context, {
    clientName: client?.name || "",
    clientEmail: clientEmail || undefined,
  }).catch(() => undefined);
  checks.push({
    key: "intercom",
    label: "Intercom (the shared client inbox the AMs answer email in)",
    checked: inbox?.status === "checked",
    reachable: inbox?.status === "checked",
    detail:
      inbox?.detail ||
      "The Intercom read could not be completed, so the shared client inbox was not checked. Check it by hand before saying an email was or was not sent.",
  });

  const inboxState = (check: PrepSourceCheck | undefined): PrepCommsVerification["gmail"] =>
    !check?.checked ? "not_connected" : check.reachable ? "checked" : "failed";

  const intercomState = inboxState(checks.find((check) => check.key === "intercom"));
  const gmailState = inboxState(checks.find((check) => check.key === "gmail"));

  const note =
    intercomState === "checked" && gmailState === "checked"
      ? "Both the Intercom shared inbox and the support@ Gmail inbox were read for this client, so a missing email is a real finding."
      : [
          intercomState === "checked"
            ? "The Intercom shared inbox was read."
            : intercomState === "not_connected"
              ? "Intercom is not connected, so the shared client inbox was NOT checked."
              : "Intercom is connected but returned nothing, so the shared client inbox could not be verified.",
          gmailState === "checked"
            ? "The support@ Gmail inbox was read."
            : gmailState === "not_connected"
              ? "Gmail is not connected, so the support@ inbox was NOT checked."
              : "Gmail is connected but returned nothing, so the support@ inbox could not be verified.",
          "Because both inboxes were not verified, do not state that any email was sent, received or left unanswered.",
        ].join(" ");

  return {
    sourceChecks: checks,
    commsVerification: { intercom: intercomState, gmail: gmailState, note },
  };
}

export interface PrepStageResult {
  touch: MonthlyTouchRecord;
  workflow: PrepWorkflowState;
  /** What happened, in the words the AM reads on the screen. */
  message: string;
}

/**
 * Stage 1 -- prepare the Monthly Touch.
 *
 * Runs the existing preparation engine (the account review, the data pulls, the analysis and the
 * agenda) and then judges it honestly: if the engine could not produce a preparation pack, or the
 * model half failed, the stage is `failed` and nothing downstream opens. The old behaviour was to
 * mark the touch `Ready` either way, which is exactly the contradiction this replaces.
 */
export async function runResearchStage(context: TenantContext, touchId: string): Promise<PrepStageResult> {
  const { touch, client } = await loadTouch(context, touchId);
  const startedAt = getNowIso();
  const before = workflowOf(touch);
  const attempts = (before.stages.research.attempts ?? 0) + 1;

  /**
   * Ask Google again before reading the snapshot.
   *
   * The preparation reads whatever the last provider sync stored, and nothing in the workflow ever
   * refreshed it -- so pressing the button again re-ran the ANALYSIS over yesterday's facts and
   * produced the same stale sentence every time. The owner's case, 9 November 2026: the brief kept
   * saying four reviews were unanswered for hours after they had all been replied to, because the
   * snapshot behind it was written at 09:17 that morning.
   *
   * Scoped to this client's locations and non-fatal: a refused API or a missing connection leaves
   * the older snapshot in place and the preparation carries on, as it always did.
   */
  const [gbpRefresh, snapshotRefreshes] = await Promise.all([
    refreshGbpInsightsForClient(context, client.id).catch((error) => ({
      status: "failed" as const,
      locations: 0,
      detail: error instanceof Error ? error.message : "The Business Profile refresh failed.",
    })),
    // Everything else the preparation reads, pulled again now. Runs alongside the Business
    // Profile re-read because they touch different APIs and nothing here depends on anything
    // there.
    refreshSnapshotsForPrep(context).catch(() => [] as PrepSnapshotRefresh[]),
  ]);
  console.info(`[prep] ${client.id}: gbp refresh ${gbpRefresh.status} -- ${gbpRefresh.detail}`);
  for (const entry of snapshotRefreshes) {
    console.info(`[prep] ${client.id}: ${entry.providerId} ${entry.status} -- ${entry.detail}`);
  }

  /**
   * Then this client's own GoHighLevel sub-account, after the tenant sync above rather than
   * beside it, so the broad pull cannot overwrite the narrow one.
   *
   * The agency sync reads a bounded slice of sub-accounts per run, so re-syncing the provider is
   * not enough on its own to guarantee numbers for the client in front of you. Asking for that
   * one sub-account is.
   */
  const ghlRefresh = await refreshGhlLeadsForClient(context, client.id, client.name).catch((error) => ({
    status: "failed" as const,
    detail: error instanceof Error ? error.message : "The GoHighLevel refresh failed.",
  }));
  console.info(`[prep] ${client.id}: ghl refresh ${ghlRefresh.status} -- ${ghlRefresh.detail}`);

  /**
   * And ask the calendar when the meeting actually is, before anything quotes a time at a client.
   *
   * Same failure, worse consequence: the time on the touch is whatever the last calendar sync
   * wrote, and the confirmation email states it to the client as fact. On 9 November 2026 that
   * sync was six days old, so the draft offered to remind a client about a call on the 4th -- a
   * date that had passed and that the client had already rebooked away from.
   */
  const scheduleRefresh = await refreshTouchScheduleForClient(context, client.id, touchId).catch((error) => ({
    status: "failed" as const,
    scheduledAt: null,
    timing: null,
    detail: error instanceof Error ? error.message : "The calendar refresh failed.",
  }));
  console.info(`[prep] ${client.id}: schedule refresh ${scheduleRefresh.status} -- ${scheduleRefresh.detail}`);

  let prepared: MonthlyTouchRecord;
  try {
    const result = await prepareMonthlyTouch(context, touchId, { includeClaude: true });
    prepared = result.touch;
  } catch (error) {
    const workflow: PrepWorkflowState = {
      ...before,
      stages: {
        ...before.stages,
        research: {
          status: "failed",
          startedAt,
          attempts,
          errorMessage: error instanceof Error ? error.message : "The account review failed.",
        },
      },
    };
    const saved = await persist(context, touch, workflow);
    return {
      touch: saved,
      workflow: saved.prepWorkflow!,
      message: `The account review failed: ${workflow.stages.research.errorMessage}`,
    };
  }

  const claude = prepared.prepPack?.claude;
  const failureReason = !prepared.prepPack
    ? "The preparation engine returned no preparation pack, so there are no findings to work from."
    : claude?.status === "failed"
      ? `The analysis step failed: ${claude.errorMessage || "the model did not answer"}. The data pulls were saved, so retrying only re-runs the analysis.`
      : claude?.status === "not_configured"
        ? "No AI provider is configured, so the account review could gather data but could not produce the analysis or the agenda."
        : !prepared.agenda.length
          ? "The account review produced no agenda, so there is nothing to tell the client."
          : "";

  const { sourceChecks, commsVerification } = await recordSourceChecks(
    context,
    prepared,
    gbpRefresh,
    scheduleRefresh,
    snapshotRefreshes,
    ghlRefresh,
  );

  const workflow: PrepWorkflowState = {
    ...before,
    stages: {
      ...before.stages,
      research: failureReason
        ? { status: "failed", startedAt, attempts, errorMessage: failureReason }
        : { status: "complete", startedAt, completedAt: getNowIso(), attempts },
    },
    ...(failureReason
      ? {}
      : {
          research: {
            completedAt: getNowIso(),
            pipelineVersion: prepared.prepPack!.pipelineVersion,
            agenda: prepared.agenda,
            sourceChecks,
            dataGaps: prepared.prepPack!.dataGaps ?? [],
            commsVerification,
          },
        }),
  };

  const saved = await persist(context, prepared, workflow);
  return {
    touch: saved,
    workflow: saved.prepWorkflow!,
    message: failureReason
      ? failureReason
      : `The account review is done. ${sourceChecks.filter((check) => check.reachable).length} of ${sourceChecks.length} sources answered, and the agenda is ready for the client email.`,
  };
}

/** Stage 2a -- write the client confirmation email from the finalized agenda. */
export async function generateConfirmationEmailStage(
  context: TenantContext,
  touchId: string,
  options: GenerateConfirmationEmailOptions = {},
): Promise<PrepStageResult> {
  const { touch, client } = await loadTouch(context, touchId);
  const before = workflowOf(touch);
  assertStageOpen(before, "confirmation_email");

  const existing = before.confirmationEmail;
  if (existing && (existing.status === "sent" || existing.status === "sent_manually")) {
    return {
      touch,
      workflow: before,
      message:
        "This confirmation email has already been sent, so it was not rewritten. Rewriting it would mean sending the client a second, different agenda.",
    };
  }

  const email = await generateConfirmationEmail(touch, client, options);
  const workflow: PrepWorkflowState = {
    ...before,
    confirmationEmail: email,
    stages: {
      ...before.stages,
      confirmation_email: {
        ...before.stages.confirmation_email,
        status: "ready",
        attempts: (before.stages.confirmation_email.attempts ?? 0) + 1,
      },
    },
  };

  const saved = await persist(context, touch, workflow);
  return {
    touch: saved,
    workflow: saved.prepWorkflow!,
    message: email.gaps.length
      ? "The draft is ready, with a few things to check before you approve it."
      : "The draft is ready. Read it, edit anything that does not fit, then approve it.",
  };
}

/**
 * Stage 2b -- the AM approves the wording.
 *
 * Approval is a human act and the only thing that unlocks sending, so the AM's edits are what get
 * approved: whatever subject and body they pass in replace the draft's. It is recorded with who and
 * when, because every external action in MTOS has to be traceable to the person who allowed it.
 */
export async function approveConfirmationEmailStage(
  context: TenantContext,
  touchId: string,
  edits: { subject: string; body: string; recipient?: string; timeZone?: string },
): Promise<PrepStageResult> {
  const { touch } = await loadTouch(context, touchId);
  const before = workflowOf(touch);
  assertStageOpen(before, "confirmation_email");

  const email = before.confirmationEmail;
  if (!email) {
    throw new PrepStageBlockedError(
      "confirmation_email",
      "There is no confirmation email to approve yet. Generate the draft first.",
    );
  }
  if (email.status === "sent" || email.status === "sent_manually") {
    return { touch, workflow: before, message: "This email has already been sent." };
  }

  const subject = edits.subject.trim();
  const body = edits.body.trim();
  if (!subject || !body) {
    throw new Error("An approved email needs both a subject and a body.");
  }

  const recipient = edits.recipient?.trim() || email.recipient;
  const approved: ConfirmationEmailState = {
    ...email,
    subject,
    body,
    recipient,
    recipientSource: edits.recipient?.trim() ? "Entered by the account manager." : email.recipientSource,
    ...(edits.timeZone?.trim()
      ? { timeZone: edits.timeZone.trim(), timeZoneSource: "Set by the account manager for this client." }
      : {}),
    status: "approved",
    approvedAt: getNowIso(),
    approvedBy: context.userId,
    // The approved wording is a new message; anything already attempted against the old draft does
    // not carry over, so a retry count from a previous draft cannot hide a fresh failure.
    deliveryAttempts: 0,
    lastError: undefined,
    gaps: recipient
      ? email.gaps.filter((gap) => !gap.startsWith("No client email address"))
      : email.gaps,
  };

  const workflow: PrepWorkflowState = { ...before, confirmationEmail: approved };
  const saved = await persist(context, touch, workflow);
  return {
    touch: saved,
    workflow: saved.prepWorkflow!,
    message: recipient
      ? `Approved. It has not been sent yet — send it to ${recipient}, or send it yourself and record that.`
      : "Approved. Add the client's email address before this can be sent.",
  };
}

/**
 * Stage 2 -- run this touch WITHOUT a confirmation email, on purpose.
 *
 * For the client who books the call the same day: they already know when it is, and an agenda
 * email landing after the meeting is worse than none. Without this the AM's only way past the
 * gate was to send an email nobody needed, or to press "I sent this myself" about a message that
 * never existed -- which would have put a lie in the preparation notes to satisfy the screen.
 *
 * Recorded as `skipped`, never as sent. Section 15 of the notes is told plainly that no email went
 * out, and the readiness score books it as a deliberate omission rather than a success.
 *
 * Reversible: the draft, if there is one, is left intact, so writing or approving it afterwards
 * puts the touch straight back on the normal path.
 */
export async function skipConfirmationEmailStage(
  context: TenantContext,
  touchId: string,
  options: { reason?: string } = {},
): Promise<PrepStageResult> {
  const { touch } = await loadTouch(context, touchId);
  const before = workflowOf(touch);
  assertStageOpen(before, "confirmation_email");

  const email = before.confirmationEmail;
  if (email && (email.status === "sent" || email.status === "sent_manually")) {
    return {
      touch,
      workflow: before,
      message: "This email has already gone out, so there is nothing to skip.",
    };
  }

  const nowIso = getNowIso();
  const reason = options.reason?.trim();
  // A touch can be skipped before anything was ever drafted -- that is the whole point for a
  // same-day booking -- so stand up the minimum state rather than demanding a draft first.
  const base: ConfirmationEmailState = email ?? {
    subject: "",
    body: "",
    channel: "email",
    recipient: "",
    recipientSource: "No draft was written for this touch.",
    timeZone: "",
    timeZoneSource: "No draft was written for this touch.",
    meetingWhen: "—",
    status: "draft",
    generatedAt: nowIso,
    deliveryAttempts: 0,
    idempotencyKey: `skipped-${touchId}-${nowIso}`,
    gaps: [],
  };

  const skipped: ConfirmationEmailState = {
    ...base,
    status: "skipped",
    skippedAt: nowIso,
    skippedBy: context.userId,
    ...(reason ? { skipReason: reason } : {}),
    lastError: undefined,
  };

  const workflow: PrepWorkflowState = { ...before, confirmationEmail: skipped };
  const saved = await persist(context, touch, workflow);
  return {
    touch: saved,
    workflow: saved.prepWorkflow!,
    message:
      "Skipped. The client has NOT been sent an agenda, and the preparation notes will say so. The next step is open.",
  };
}

/** Stage 2c -- try to deliver it. Safe to retry; never marked sent on a failure. */
export async function sendConfirmationEmailStage(
  context: TenantContext,
  touchId: string,
): Promise<PrepStageResult> {
  const { touch } = await loadTouch(context, touchId);
  const before = workflowOf(touch);
  assertStageOpen(before, "confirmation_email");

  const email = before.confirmationEmail;
  if (!email) {
    throw new PrepStageBlockedError(
      "confirmation_email",
      "There is no confirmation email to send yet. Generate the draft and approve it first.",
    );
  }

  const result = await sendConfirmationEmail(context, email);
  const workflow: PrepWorkflowState = {
    ...before,
    confirmationEmail: result.email,
    stages: {
      ...before.stages,
      confirmation_email: result.sent
        ? { ...before.stages.confirmation_email, status: "complete", completedAt: getNowIso() }
        : {
            ...before.stages.confirmation_email,
            status: "failed",
            errorMessage: result.email.lastError,
          },
    },
  };

  const saved = await persist(context, touch, workflow);
  return { touch: saved, workflow: saved.prepWorkflow!, message: result.message };
}

/**
 * Stage 2d -- the AM sent it themselves.
 *
 * Needed because most tenants' Gmail connection is read-only, and without this the record would
 * either stall or have to lie. Stored as `sent_manually` with the channel the AM used, so nothing
 * downstream can claim MTOS delivered it.
 */
export async function markConfirmationEmailSentStage(
  context: TenantContext,
  touchId: string,
  details: { channel: string; sentAt?: string },
): Promise<PrepStageResult> {
  const { touch } = await loadTouch(context, touchId);
  const before = workflowOf(touch);
  assertStageOpen(before, "confirmation_email");

  const email = before.confirmationEmail;
  if (!email) {
    throw new PrepStageBlockedError("confirmation_email", "There is no confirmation email to record as sent.");
  }
  if (email.status === "draft") {
    throw new PrepStageBlockedError(
      "confirmation_email",
      "Approve the wording first, so the record says what the client actually received.",
    );
  }
  if (email.status === "sent" || email.status === "sent_manually") {
    return { touch, workflow: before, message: "This email is already recorded as sent." };
  }

  const channel = details.channel.trim() || "sent by the account manager";
  const updated: ConfirmationEmailState = {
    ...email,
    status: "sent_manually",
    sentAt: details.sentAt?.trim() || getNowIso(),
    sentVia: `sent by the account manager (${channel})`,
    lastError: undefined,
  };

  const workflow: PrepWorkflowState = {
    ...before,
    confirmationEmail: updated,
    stages: {
      ...before.stages,
      confirmation_email: {
        ...before.stages.confirmation_email,
        status: "complete",
        completedAt: getNowIso(),
      },
    },
  };

  const saved = await persist(context, touch, workflow);
  return {
    touch: saved,
    workflow: saved.prepWorkflow!,
    message: `Recorded as sent by you via ${channel}. MTOS did not send it, and the notes will say so.`,
  };
}

/**
 * Stage 3 -- write the structured preparation notes.
 *
 * Built from the findings the account review established and from the approved email, so the
 * agenda the client was told and the agenda in the document are the same one. A document missing
 * any required section fails the stage; it is not filed and not approvable.
 */
export async function generatePrepNotesStage(context: TenantContext, touchId: string): Promise<PrepStageResult> {
  const { touch, client } = await loadTouch(context, touchId);
  const before = workflowOf(touch);
  assertStageOpen(before, "prep_notes");

  const startedAt = getNowIso();
  const document = await generatePrepDocument(context, touch, client);
  const complete = isPrepDocumentComplete(document);

  const workflow: PrepWorkflowState = {
    ...before,
    document,
    stages: {
      ...before.stages,
      prep_notes: complete
        ? {
            status: "complete",
            startedAt,
            completedAt: getNowIso(),
            attempts: (before.stages.prep_notes.attempts ?? 0) + 1,
          }
        : {
            status: "failed",
            startedAt,
            attempts: (before.stages.prep_notes.attempts ?? 0) + 1,
            errorMessage: document.errorMessage || "The preparation notes are incomplete.",
          },
    },
  };

  const saved = await persist(context, touch, workflow);
  return {
    touch: saved,
    workflow: saved.prepWorkflow!,
    message: complete
      ? `The preparation notes are written — ${document.sections.filter((section) => section.included).length} sections. Read them, then approve them so they can be filed in ClickUp.`
      : document.errorMessage || "The preparation notes are incomplete.",
  };
}

/** Stage 3b -- the AM approves the notes. Nothing reaches ClickUp before this. */
export async function approvePrepNotesStage(context: TenantContext, touchId: string): Promise<PrepStageResult> {
  const { touch } = await loadTouch(context, touchId);
  const before = workflowOf(touch);

  const document = before.document;
  if (!document || !isPrepDocumentComplete(document)) {
    throw new PrepStageBlockedError(
      "prep_notes",
      "These notes are not complete, so there is nothing to approve yet. Regenerate them first.",
    );
  }

  const workflow: PrepWorkflowState = {
    ...before,
    document: { ...document, approvedAt: getNowIso(), approvedBy: context.userId },
  };
  const saved = await persist(context, touch, workflow);
  return {
    touch: saved,
    workflow: saved.prepWorkflow!,
    message: "Approved. You can file them in the client's ClickUp book now.",
  };
}

/**
 * Stage 4 -- file the notes and create the empty post-meeting subpage.
 *
 * Idempotent on purpose: the page ids MTOS wrote are kept on the touch, so filing again edits those
 * pages instead of adding a second `Monthly Touch (date)` next to the first. A post-meeting subpage
 * that already holds real content is never replaced.
 */
export async function filePrepNotesStage(context: TenantContext, touchId: string): Promise<PrepStageResult> {
  const { touch, client } = await loadTouch(context, touchId);
  const before = workflowOf(touch);
  assertStageOpen(before, "clickup_filing");

  const document = before.document;
  if (!document?.approvedAt) {
    throw new PrepStageBlockedError(
      "clickup_filing",
      "Approve the preparation notes before anything is written into the client's ClickUp book.",
    );
  }

  const startedAt = getNowIso();
  const touchDateIso = touch.scheduledAt || touch.prepPack?.schedule.scheduledAt || touch.prepPack?.schedule.touchDate || startedAt;

  const result = await filePrepNotesToClientBook(context, {
    clientName: client.name,
    touchDateIso,
    markdown: document.markdown,
    existing: before.filing?.links,
  });

  if ("error" in result) {
    const workflow: PrepWorkflowState = {
      ...before,
      filing: {
        status: "failed",
        postNotesCreated: Boolean(before.filing?.postNotesCreated),
        errorMessage: result.error,
        ...(before.filing?.links ? { links: before.filing.links } : {}),
      },
      stages: {
        ...before.stages,
        clickup_filing: {
          status: "failed",
          startedAt,
          attempts: (before.stages.clickup_filing.attempts ?? 0) + 1,
          errorMessage: result.error,
        },
      },
    };
    const saved = await persist(context, touch, workflow);
    return { touch: saved, workflow: saved.prepWorkflow!, message: result.error };
  }

  const workflow: PrepWorkflowState = {
    ...before,
    filing: {
      status: "filed",
      links: result.links,
      // The post-meeting subpage is created after the call, by the post-meeting step, as a child of
      // the page just filed. Nothing here claims it exists: a flag set now would make every later
      // post-meeting run look like a re-run of a write-up that was never written.
      postNotesCreated: Boolean(before.filing?.links?.postPageId),
      filedAt: getNowIso(),
      destination: result.destination,
      pageName: result.pageName,
    },
    stages: {
      ...before.stages,
      clickup_filing: {
        status: "complete",
        startedAt,
        completedAt: getNowIso(),
        attempts: (before.stages.clickup_filing.attempts ?? 0) + 1,
      },
    },
  };

  const saved = await persist(context, touch, workflow);
  return {
    touch: saved,
    workflow: saved.prepWorkflow!,
    message: `Filed as "${result.pageName}" in ${result.destination}. The post-meeting notes are written into this page as a subpage after the call.`,
  };
}

/**
 * The workflow as the screen should read it, including the scores, for a touch that may never have
 * been through this workflow at all. Nothing is inferred from the older single-action fields: a
 * touch prepared by the old engine reads as not started, which is the truth about this workflow.
 */
export function readPrepWorkflow(touch: MonthlyTouchRecord): PrepWorkflowState {
  const workflow = touch.prepWorkflow ?? emptyPrepWorkflowState(touch.updatedAt || getNowIso());
  const gated = recomputeGates(workflow);
  return {
    ...gated,
    readiness: gated.readiness ?? computeReadiness(touch),
    confidence: gated.confidence ?? computeConfidence(touch),
  };
}
