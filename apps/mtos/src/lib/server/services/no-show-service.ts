import { blockedTaskTitles, internalTaskText } from "@/src/lib/contracts/client-content";
import { FieldValue } from "firebase-admin/firestore";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import { calendarSlotAvailable, loomReady, usableLoomUrl, type NoShowState } from "@/src/lib/contracts/no-show";
import { sanitizeAgendaEmailHtml, emailSignatureLines } from "@/src/lib/contracts/agenda-email";
import { followThroughDueAt } from "@/src/lib/contracts/touch-progress";
import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { clientPath, monthlyTouchPath, monthlyTouchArtifactPath } from "@/src/lib/server/firebase/collections";
import { generatePresentation } from "./presentation-service";
import { readRescheduleAvailability, rescheduleLinkedEvent } from "./google-meet-service";
import { resolveRecipient } from "./confirmation-email-service";
import { sendClientEmail, verifyClientEmailAccepted } from "./client-email-service";
import { verifyLoomEmailAccepted } from "./intercom-send-service";
import { getAccountManagerPreferences, getAccountManagerProfile } from "./user-service";

export type NoShowAction =
  | { action: "select"; resolution: "reschedule" | "loom" }
  | { action: "generate" }
  | { action: "save"; script: string; url: string; subject?: string; html?: string }
  | { action: "email" }
  | { action: "send"; approved: true }
  | { action: "reconcile" }
  | { action: "reschedule"; scheduledAt: string; confirmed: true };

const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export async function runNoShowAction(context: TenantContext, touchId: string, action: NoShowAction) {
  const source = getMtosDataSource(context);
  const touch = await source.getMonthlyTouchById(touchId);
  const client = touch && await source.getClientById(touch.clientId);
  if (!touch || !client) throw new Error("This Monthly Touch is not available to your account.");
  if (client.touchId && client.touchId !== touchId) throw new Error("Open the client's current Monthly Touch before recording a no-show.");
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("MTOS storage is unavailable.");
  const ref = db.doc(monthlyTouchPath(context.tenantId, touchId));
  const at = new Date().toISOString();
  // Serialize every no-show mutation, including slow remote calls. A crash leaves a claim for
  // reconciliation rather than risking a second email or racing a Calendar reset.
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as MonthlyTouchRecord & { noShowBusy?: string };
    if (!current || (current.noShowBusy && (!Number.isFinite(Date.parse(current.noShowBusy)) || Date.now() - Date.parse(current.noShowBusy) < 10 * 60000))) throw new Error("A no-show action is in progress. An interrupted request can be retried after ten minutes; unresolved email delivery must be reconciled first.");
    if (current.progress !== "live" || current.qc || current.followThrough?.finishedAt) {
      if (!(action.action === "send" && loomReady(current))) throw new Error("No-show actions are available only during Live Call.");
    }
    tx.update(ref, { noShowBusy: at });
  });
  try {
    const current = (await ref.get()).data() as MonthlyTouchRecord;
    let state: NoShowState | undefined = current.noShow;
    if (action.action === "select") {
      if (state && !state.rescheduledAt) {
        if (state.resolution !== action.resolution) throw new Error("A no-show resolution is already in progress.");
        return state;
      }
      state = { resolution: action.resolution, selectedAt: at, selectedBy: context.userId };
      await ref.update({ noShow: state, noShowHistory: FieldValue.arrayUnion({ at, by: context.userId, resolution: action.resolution, detail: "No-show resolution selected" }) });
      return state;
    }
    if (!state) throw new Error("Select a no-show resolution first.");
    if (action.action === "reschedule") {
      if (state.resolution !== "reschedule" || !current.calendarEventId) throw new Error("This touch needs a linked Calendar event and the reschedule resolution.");
      const scheduledAt = new Date(action.scheduledAt).toISOString();
      if (Date.parse(scheduledAt) <= Date.now()) throw new Error("Choose a future meeting time.");
      const available = await readRescheduleAvailability(context, touchId);
      if (!calendarSlotAvailable(scheduledAt, available, Date.now())) throw new Error("The selected time is busy or outside the next 30 days. Refresh availability and choose another time.");
      // Archive before the remote write. The original event ID is retained throughout.
      await ref.collection("attempts").doc(state.selectedAt.replace(/[^0-9]/g, "")).set(current);
      await rescheduleLinkedEvent(context, current.calendarEventId, scheduledAt);
      const profile = await getAccountManagerProfile(context);
      const scheduledLocalDate = new Intl.DateTimeFormat("en-CA", { timeZone: profile.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(scheduledAt));
      state = { ...state, rescheduledAt: at, standbyUntil: new Date(Date.parse(scheduledAt) - 48 * 3600_000).toISOString() };
      const batch = db.batch();
      const artifactRef = db.doc(monthlyTouchArtifactPath(context.tenantId, touchId, "transcript"));
      const artifact = await artifactRef.get();
      if (artifact.exists) batch.set(ref.collection("attempts").doc(state.selectedAt.replace(/[^0-9]/g, "") + "-transcript"), artifact.data()!);
      batch.delete(artifactRef);
      const review = { ...current.review };
      delete review.approvedAt;
      delete review.approvedBy;
      batch.update(ref, { noShow: state, scheduledAt, scheduledLocalDate, progress: "prep", status: "Preparing", progressUpdatedAt: at,
        live: FieldValue.delete(), liveSession: FieldValue.delete(), transcript: FieldValue.delete(),
        followThrough: FieldValue.delete(), postMeeting: FieldValue.delete(), approval: FieldValue.delete(),
        agendaEmail: FieldValue.delete(), googleMeeting: FieldValue.delete(), prepWorkflow: FieldValue.delete(),
        review,
        noShowHistory: FieldValue.arrayUnion({ at, by: context.userId, resolution: "reschedule", detail: `Existing event rescheduled to ${scheduledAt}; prior attempt archived` }) });
      batch.set(db.doc(clientPath(context.tenantId, client.id)), {
        nextTouchStartAt: scheduledAt, nextTouchEventId: current.calendarEventId,
        manualTouchStartAt: scheduledAt,
        touchDate: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: profile.timeZone }).format(new Date(scheduledAt)),
      }, { merge: true });
      await batch.commit();
      return state;
    }
    if (state.resolution !== "loom") throw new Error("Select Loom Video Update first.");
    if (state.sendStatus === "sent") return state;
    if (action.action !== "reconcile" && (state.sendStatus === "sending" || state.sendStatus === "unknown")) throw new Error("Email delivery is unresolved. Check the sending mailbox before retrying to avoid a duplicate.");
    if (!current.prepPack || !current.review?.approvedAt) throw new Error("Finalize and approve the preparation before creating the Loom update.");
    if (action.action === "generate") {
      const generated = await generatePresentation(context, touchId, "loom");
      const presentation = generated.touch.presentation!;
      const slides = presentation.slides.filter((slide) => !slide.sectionId || !current.review?.declinedSections?.includes(slide.sectionId));
      state = { ...state, presentation: { ...presentation, slides }, script: slides.map((slide) => `${slide.title}\n${slide.presenterNotes || (slide.bullets || []).join("\n")}`).join("\n\n") };
    }
    if (action.action === "generate") delete state.email;
    if (action.action === "save") {
      if (internalTaskText(action.script, blockedTaskTitles(current)) || internalTaskText(`${action.subject || ""} ${action.html || ""}`, blockedTaskTitles(current))) throw new Error("Keep unfinished tasks in internal notes. The Loom script and client email may show completed work only.");
      if (action.url && !usableLoomUrl(action.url)) throw new Error("Paste an HTTPS Loom share URL, such as https://www.loom.com/share/recordingid.");
      const urlChanged = action.url !== state.url;
      state = { ...state, script: action.script, url: action.url,
        ...(state.email && !urlChanged ? { email: { ...state.email, subject: action.subject ?? state.email.subject, html: sanitizeAgendaEmailHtml(action.html ?? state.email.html) } } : {}) };
      if (urlChanged) delete state.email;
    }
    if (action.action === "email") {
      if (!usableLoomUrl(state.url || "") || !state.script?.trim() || !state.presentation) throw new Error("Generate the presentation and save the reviewed script and Loom URL first.");
      const [profile, preferences] = await Promise.all([getAccountManagerProfile(context), getAccountManagerPreferences(context)]);
      const signature = emailSignatureLines(preferences.emailSignoff, profile.name);
      if (!signature.length) throw new Error("Add your email signature in Settings first.");
      const recipient = resolveRecipient(client, current).recipient;
      if (!recipient) throw new Error("Add the client's email address to their existing contact record first.");
      state = { ...state, email: { recipient, subject: `Your Monthly Touch video update — ${client.name}`,
        html: `<p>Hello,</p><p>We missed you at our scheduled Monthly Touch meeting. I prepared a video update for you instead.</p><p><a href="${esc(state.url!)}"><strong>Watch your Monthly Touch video update</strong></a></p><p>The video covers ${esc(state.presentation.slides.filter((s) => s.sectionId).map((s) => s.title).join(", ") || "your account updates and next steps")}.</p><p>Please reach out with any questions or concerns.</p><p>${signature.map(esc).join("<br>")}</p>` } };
    }
    if (action.action === "send" || action.action === "reconcile") {
      if (!state.email?.subject.trim() || !state.email.html.trim() || !usableLoomUrl(state.url || "") || !state.script?.trim() || !state.presentation) throw new Error("Complete the video and email draft before approving.");
      if (!state.email.html.includes(state.url!)) throw new Error("The approved email must include the saved Loom recording URL.");
      const email = state.email;
      if (action.action === "send") { state = { ...state, emailProvider: "gmail" }; await ref.update({ noShow: { ...state, sendStatus: "sending" } }); }
      const outcome = action.action === "reconcile"
        ? state.emailProvider === "gmail"
          ? await verifyClientEmailAccepted(context, `monthly-touch:${touchId}:loom`)
          : { sent: true as const, conversationId: await verifyLoomEmailAccepted(context, { recipient: email.recipient, subject: email.subject, url: state.url!, selectedAt: state.selectedAt }) }
        : await sendClientEmail(context, { ...email, idempotencyKey: `monthly-touch:${touchId}:loom`, blockedTaskTitles: blockedTaskTitles(current), label: "Loom video update" });
      if (!outcome.sent) {
        await ref.update({ noShow: { ...state, sendStatus: outcome.deliveryUncertain ? "unknown" : "failed", sendError: outcome.detail } });
        throw new Error(outcome.detail);
      }
      const reference = "messageId" in outcome ? outcome.messageId : outcome.conversationId;
      state = { ...state, sendStatus: "sent", sentAt: at, ...("messageId" in outcome ? { gmailMessageId: outcome.messageId, ...(outcome.threadId ? { gmailThreadId: outcome.threadId } : {}) } : { conversationId: outcome.conversationId }) };
      delete state.sendError;
      await ref.update({ noShow: state, progress: "follow", progressUpdatedAt: at,
        "followThrough.dueAt": followThroughDueAt(at),
        noShowHistory: FieldValue.arrayUnion({ at, by: context.userId, resolution: "loom", detail: `Loom email accepted by ${state.emailProvider === "gmail" ? "Gmail" : "Intercom (legacy)"}: ${reference}` }) });
      return state;
    }
    await ref.update({ noShow: state });
    return state;
  } finally {
    await ref.update({ noShowBusy: FieldValue.delete() });
  }
}
