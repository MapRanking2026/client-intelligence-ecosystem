import type { TenantContext } from "@/src/lib/contracts/mtos";
import { agendaEmailHasBody } from "@/src/lib/contracts/agenda-email";
import { approvalSummary, approvedBriefMarkdown } from "@/src/lib/contracts/prep-brief";
import {
  APPROVAL_STEPS,
  emptyApprovalState,
  nextApprovalStep,
  stepIsSettled,
  type ApprovalStepId,
  type ApprovalStepState,
  type TouchApprovalState,
} from "@/src/lib/contracts/touch-approval";
import type { LiveCallFormat, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { readAgendaEmail } from "@/src/lib/server/services/agenda-email-service";
import { filePrepNotesToClientBook } from "@/src/lib/server/services/client-book-service";
import { sendAgendaEmailViaIntercom } from "@/src/lib/server/services/intercom-send-service";
import { generateLiveCallGuide } from "@/src/lib/server/services/live-call-guide-service";
import { generatePresentation } from "@/src/lib/server/services/presentation-service";
import { getNowIso } from "@/src/lib/server/services/mtos-ai";
import { advanceTouchProgress } from "@/src/lib/server/services/touch-state-service";
import {
  getAccountManagerPreferences,
  getAccountManagerProfile,
  saveAccountManagerPreferences,
} from "@/src/lib/server/services/user-service";

/**
 * One approval, four outward writes.
 *
 * The account manager presses one button and four things happen outside MTOS: the brief is
 * approved, the client is emailed, a page is written into the client's ClickUp book, and the call
 * guide or the deck is built. The screen shows them happening one at a time, which is honest --
 * they really do happen one at a time, and any of them can fail on its own.
 *
 * What makes one button safe is that every step is idempotent against a stored record, and the
 * record is written **before and after** each attempt. So:
 *
 *   - A step that already said `done` or `skipped` is never attempted again. The email is the one
 *     that matters: the Intercom conversation id is the proof it went out, and while it is there
 *     no retry can produce a second email in a client's inbox.
 *   - A run that fails at step 3 leaves steps 1 and 2 done. Pressing the button again picks up at
 *     step 3. It does not re-approve, and it does not re-send.
 *   - A step that fails says why in the account manager's own terms, and whether the right move is
 *     to retry or to do that one thing by hand.
 *
 * Nothing here runs without the button. The handoff's rule is that anything leaving MTOS waits for
 * an explicit human action, and this whole file is what that one action does.
 */

export interface ApprovalRunResult {
  approval: TouchApprovalState;
  /** The format that was built, so the screen can offer the right thing to open. */
  format: LiveCallFormat;
  /** True when every step finished one way or the other. */
  complete: boolean;
  /** One line for the AM: what the run achieved, or where it stopped. */
  message: string;
}

function requireDb() {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firestore is not configured, so nothing can be approved.");
  }
  return db;
}

async function loadTouch(context: TenantContext, touchId: string) {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) throw new Error("Monthly touch not found");
  const client = await dataSource.getClientById(touch.clientId);
  if (!client) {
    throw new Error("MTOS can't see this touch's client, so there is no account to approve against.");
  }
  return { touch, client };
}

/**
 * Write the approval record, and nothing else on the document.
 *
 * `mergeFields` rather than a merge of the whole touch: the two generators in step 4 rewrite the
 * record they read, and an overlapping write of the whole touch here would put back the version
 * this run started from -- losing the call guide it had just built.
 */
async function writeApproval(
  context: TenantContext,
  touchId: string,
  approval: TouchApprovalState,
): Promise<void> {
  const db = requireDb();
  await db
    .doc(monthlyTouchPath(context.tenantId, touchId))
    .set({ approval: { ...approval, updatedAt: getNowIso() } }, { mergeFields: ["approval"] });
}

function settle(
  approval: TouchApprovalState,
  step: ApprovalStepId,
  state: ApprovalStepState,
): TouchApprovalState {
  return {
    ...approval,
    steps: { ...approval.steps, [step]: { ...state, at: state.at || getNowIso() } },
  };
}

/** The call label the filed page and the live guide both carry. */
function callLabel(touch: MonthlyTouchRecord, timeZone: string): string {
  const iso = touch.scheduledAt || touch.prepPack?.schedule.scheduledAt;
  if (!iso) return "no date and time recorded on this touch";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "no date and time recorded on this touch";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short" }).format(date);
  }
}

/**
 * Run the approval, resuming from wherever it got to last time.
 *
 * Stops at the first step that fails rather than carrying on: steps 3 and 4 are both built from
 * the approved brief, and filing or presenting a brief whose approval did not record is exactly
 * the inconsistency the single button is supposed to remove.
 */
export async function approveAndPrepareCall(
  context: TenantContext,
  touchId: string,
  options: { format?: LiveCallFormat; makeDefault?: boolean } = {},
): Promise<ApprovalRunResult> {
  const { touch, client } = await loadTouch(context, touchId);
  const [profile, preferences] = await Promise.all([
    getAccountManagerProfile(context),
    getAccountManagerPreferences(context),
  ]);

  const format: LiveCallFormat =
    options.format || touch.live?.format || preferences.liveCallFormat || "guide";

  let approval: TouchApprovalState = {
    ...emptyApprovalState(),
    ...touch.approval,
    steps: { ...emptyApprovalState().steps, ...touch.approval?.steps },
    startedAt: touch.approval?.startedAt || getNowIso(),
    approvedBy: touch.approval?.approvedBy || profile.email || profile.name || undefined,
  };

  if (!nextApprovalStep(approval)) {
    return {
      approval,
      format,
      complete: true,
      message: "This brief was already approved and the call is already prepared. Nothing was sent or written again.",
    };
  }

  const db = requireDb();
  const ref = db.doc(monthlyTouchPath(context.tenantId, touchId));
  const summary = approvalSummary(touch.review);

  // ---- Step 1: the approval itself -------------------------------------------------------------
  if (!stepIsSettled(approval.steps.approve)) {
    const approvedAt = getNowIso();
    await ref.set(
      {
        review: {
          declinedSections: [],
          sectionEdits: {},
          coaching: {},
          ...touch.review,
          approvedAt,
          approvedBy: profile.email || profile.name || "",
        },
      },
      { mergeFields: ["review"] },
    );
    approval = settle(approval, "approve", {
      status: "done",
      at: approvedAt,
      detail: summary.declined.length
        ? `${summary.approving} of ${summary.approving + summary.declined.length} sections approved · declined: ${summary.declined.join(", ")}`
        : `All ${summary.approving} sections approved.`,
    });
    await writeApproval(context, touchId, approval);
    // Approving is what puts Live into READY; the timer belongs to the call, not to this click.
    await advanceTouchProgress(context, touchId, "live").catch(() => undefined);
  }

  // ---- Step 2: the agenda email ----------------------------------------------------------------
  if (!stepIsSettled(approval.steps.email)) {
    const view = await readAgendaEmail(context, touch, client);
    const email = view.state;

    if (email.declined) {
      approval = settle(approval, "email", {
        status: "skipped",
        detail: "You declined the agenda email, so the client was told nothing before the call.",
      });
      await writeApproval(context, touchId, approval);
    } else if (view.sent || email.intercomConversationId) {
      approval = settle(approval, "email", {
        status: "done",
        detail: `Already sent${email.sentAt ? ` ${email.sentAt}` : ""}. Nothing was sent again.`,
      });
      await writeApproval(context, touchId, approval);
    } else if (email.blockingGaps?.length || !agendaEmailHasBody(email.html)) {
      const reason = email.blockingGaps?.length
        ? email.blockingGaps[0]
        : "The agenda email has almost no text in it, so there is nothing worth sending.";
      approval = settle(approval, "email", { status: "failed", detail: reason });
      await writeApproval(context, touchId, approval);
      return {
        approval,
        format,
        complete: false,
        message: `The brief is approved, but the agenda email was not sent: ${reason} Fix it and approve again, or decline the email to carry on without it.`,
      };
    } else {
      const sent = await sendAgendaEmailViaIntercom(context, {
        accountManagerEmail: profile.email,
        recipient: email.recipient || "",
        cc: view.ccEnabled ? view.availableCc : [],
        subject: email.subject,
        html: email.html,
        ...(email.intercomConversationId ? { existingConversationId: email.intercomConversationId } : {}),
      });

      if (sent.sent) {
        await ref.set(
          {
            agendaEmail: {
              ...email,
              sentAt: getNowIso(),
              sentVia: sent.sentVia,
              intercomConversationId: sent.conversationId,
            },
          },
          { mergeFields: ["agendaEmail"] },
        );
        approval = settle(approval, "email", { status: "done", detail: sent.detail });
        await writeApproval(context, touchId, approval);
      } else {
        approval = settle(approval, "email", { status: "failed", detail: sent.detail });
        await writeApproval(context, touchId, approval);
        return {
          approval,
          format,
          complete: false,
          message: sent.sendItYourself
            ? `The brief is approved. The agenda email did not go out: ${sent.detail}`
            : `The brief is approved, but the agenda email failed: ${sent.detail}`,
        };
      }
    }
  }

  // ---- Step 3: the Client's Book ---------------------------------------------------------------
  if (!stepIsSettled(approval.steps.book)) {
    const touchDateIso =
      touch.scheduledAt || touch.prepPack?.schedule.scheduledAt || touch.prepPack?.schedule.touchDate || getNowIso();
    const markdown = touch.prepBrief
      ? approvedBriefMarkdown(touch.prepBrief, touch.review, {
          clientName: client.name,
          callLabel: callLabel(touch, profile.timeZone),
          accountManager: profile.name || client.accountManager,
        })
      : "";

    if (!markdown) {
      const detail =
        "There is no prepared brief on this touch, so there is nothing to post to the Client's Book. Run the preparation first.";
      approval = settle(approval, "book", { status: "failed", detail });
      await writeApproval(context, touchId, approval);
      return { approval, format, complete: false, message: detail };
    }

    const filed = await filePrepNotesToClientBook(context, {
      clientName: client.name,
      touchDateIso,
      markdown,
      // The page MTOS already wrote for this touch, from either this approval or the preparation
      // step's own filing. Passing it is what makes a second approval edit that page rather than
      // leave two differently-dated briefs sitting next to each other in the book.
      ...(approval.clientBook
        ? {
            existing: {
              docId: approval.clientBook.docId,
              prepPageId: approval.clientBook.pageId,
              prepPageUrl: approval.clientBook.pageUrl,
              writtenAt: approval.steps.book.at || getNowIso(),
            },
          }
        : touch.prepWorkflow?.filing?.links
          ? { existing: touch.prepWorkflow.filing.links }
          : {}),
    });

    if ("error" in filed) {
      approval = settle(approval, "book", { status: "failed", detail: filed.error });
      await writeApproval(context, touchId, approval);
      return {
        approval,
        format,
        complete: false,
        message: `The brief is approved${approval.steps.email.status === "done" ? " and the client has the agenda" : ""}, but it was not posted to the Client's Book: ${filed.error}`,
      };
    }

    approval = {
      ...settle(approval, "book", {
        status: "done",
        detail: `Posted as "${filed.pageName}" in ${filed.destination}. The post-call write-up goes inside this page after the call.`,
      }),
      clientBook: {
        docId: filed.links.docId,
        pageId: filed.links.prepPageId,
        pageUrl: filed.links.prepPageUrl,
        pageName: filed.pageName,
        destination: filed.destination,
      },
    };
    await writeApproval(context, touchId, approval);
  }

  // ---- Step 4: build the call ------------------------------------------------------------------
  if (!stepIsSettled(approval.steps.build)) {
    // The chosen format is written first, so the generator and everything after it agree on which
    // one was asked for even if the build fails.
    await ref.set(
      { live: { notes: {}, ...touch.live, format, readyAt: touch.live?.readyAt || getNowIso() } },
      { mergeFields: ["live"] },
    );
    if (options.makeDefault && options.format) {
      // A preference is a convenience: failing to store it must not fail the approval.
      await saveAccountManagerPreferences(context, { liveCallFormat: format }).catch(() => undefined);
    }

    try {
      if (format === "deck") {
        const built = await generatePresentation(context, touchId);
        approval = settle(approval, "build", {
          status: "done",
          detail: `${built.touch.presentation?.slides?.length ?? 0} slides and your presenter script, built from the approved sections.`,
        });
      } else {
        const built = await generateLiveCallGuide(context, touchId);
        approval = settle(approval, "build", {
          status: "done",
          detail: `${built.touch.callGuide?.sections?.length ?? 0} timed parts, built from the approved sections.`,
        });
      }
      await writeApproval(context, touchId, approval);
    } catch (error) {
      const detail = `${format === "deck" ? "The presentation" : "The call guide"} could not be built: ${
        error instanceof Error ? error.message : "unknown error"
      }`;
      approval = settle(approval, "build", { status: "failed", detail });
      await writeApproval(context, touchId, approval);
      return {
        approval,
        format,
        complete: false,
        message: `${detail} Everything else is done — the brief is approved and filed. Approve again to retry just this step.`,
      };
    }
  }

  const finishedAt = getNowIso();
  approval = { ...approval, finishedAt };
  await writeApproval(context, touchId, approval);

  const skipped = APPROVAL_STEPS.filter((id) => approval.steps[id].status === "skipped");
  return {
    approval,
    format,
    complete: true,
    message: skipped.length
      ? `Ready for the call. ${skipped.map((id) => approval.steps[id].detail).filter(Boolean).join(" ")}`
      : "Ready for the call.",
  };
}
