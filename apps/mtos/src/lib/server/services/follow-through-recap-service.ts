import { readBookedNextMeeting } from "@/src/lib/server/services/next-touch-booking-service";
import { loomEvidence } from "@/src/lib/contracts/no-show";
import { recapCommunicationViolations } from "@/src/lib/contracts/recap-client-content";
import { readTouchTranscriptPayload } from "@/src/lib/server/services/transcript-watch-service";
import { recapContactName } from "@/src/lib/contracts/recap-contact";
import { generateRecapContent } from "@/src/lib/server/services/recap-content-service";
import { resolveClientTimeZone } from "@/src/lib/contracts/client-time-zone";
import { blockedTaskTitles, clientText } from "@/src/lib/contracts/client-content";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import {
  buildRecapEmailDraft,
  sanitizeRecapEmailHtml,
  type RecapEmailState,
  type RecapWin,
} from "@/src/lib/contracts/follow-through-recap-email";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getServerEnv } from "@/src/lib/server/env";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getAccountManagerPreferences, getAccountManagerProfile } from "@/src/lib/server/services/user-service";

/**
 * Assembling the recap email from what the touch actually decided.
 *
 * Everything in it is read from a record: the summary from the notes, the commitments from the
 * approved tickets, the asks from the client actions, the sign-off from the AM's profile. The
 * one thing MTOS cannot supply is covered below.
 */

/** `Mon, 2 November` in the client's recorded zone. */
function dayLabel(iso: string | undefined, timeZone: string | undefined): string {
  if (!iso || !timeZone) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(date);
}

/**
 * The wins to show, from the Map Ranking commitments that were completed.
 *
 * Their ship dates come back EMPTY, and that is not an oversight. A commitment record carries a
 * due date and a status, and nothing anywhere records the day a piece of work actually shipped.
 * Writing the due date into a client-facing email as "shipped 14 October" would be stating a
 * date we do not hold, about work the client can check. So the AM fills these in, and the email
 * leaves a win undated rather than carrying a date that might be wrong.
 */
async function winsSinceLastTouch(context: TenantContext, clientId: string): Promise<RecapWin[]> {
  const dataSource = getMtosDataSource(context);
  const commitments = await dataSource.getCommitments(clientId);
  return commitments
    .filter((commitment) => commitment.status === "Completed" && commitment.category === "Map Ranking")
    .slice(0, 6)
    .map((commitment) => ({ what: commitment.title, shipped: "" }));
}

export interface RecapBuildResult {
  recap: RecapEmailState;
  blockingGaps: string[];
  note?: string;
}

export async function buildFollowThroughRecap(
  context: TenantContext,
  touchId: string,
): Promise<RecapBuildResult> {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  const notes = touch.followThrough?.notes;
  if (!notes) {
    throw new Error("Draft the notes before building the recap email.");
  }
  const client = await dataSource.getClientById(touch.clientId);
  if (!client) {
    throw new Error("The client for this touch is not visible to you.");
  }

  const [profile, preferences] = await Promise.all([
    getAccountManagerProfile(context),
    getAccountManagerPreferences(context),
  ]);
  const env = getServerEnv();
  const timeZone = resolveClientTimeZone(client).timeZone;

  // The next check-in is only named when one is actually on the calendar. Booking it is the last
  // step of the follow-through, so on most runs this is empty and the email simply does not
  // promise a date -- which is better than promising one nobody has agreed to.
  const touches = await dataSource.getMonthlyTouches();
  const next = touches
    .filter(
      (candidate) =>
        candidate.clientId === client.id &&
        candidate.id !== touch.id &&
        candidate.scheduledAt &&
        touch.scheduledAt &&
        candidate.scheduledAt > touch.scheduledAt,
    )
    .sort((a, b) => (a.scheduledAt || "").localeCompare(b.scheduledAt || ""))[0];

  const wins = await winsSinceLastTouch(context, client.id);
  let generationFailure = "";

  const blocked = blockedTaskTitles(touch);
  const safeSummary = clientText(notes.summary, blocked);
  const transcript = touch.noShow?.resolution === "loom" ? undefined : await readTouchTranscriptPayload(context, touchId, touch.postMeeting?.transcript);
  const alternative = loomEvidence(touch);
  const presentation = JSON.stringify({ slides: touch.presentation?.slides.map(slide => ({ title: slide.title, subtitle: slide.subtitle, bullets: slide.bullets, columns: slide.columns, presenterNotes: slide.presenterNotes, presenterScript: slide.presenterScript })), callGuide: touch.callGuide, preparationQuestions: touch.prepPack?.recapQuestions, goalQuestions: touch.prepPack?.leadQualityQuestions });
  const evidence = ["Meeting context:", JSON.stringify({ meetingDate: touch.scheduledLocalDate, meetingStartedAt: touch.scheduledAt, clientTimeZone: timeZone }), "Internal call notes (extract supported client-safe facts only):", notes.summary, JSON.stringify({ bullets: notes.bullets, departmentActions: notes.departments, clientActions: notes.clientActions, pending: notes.pending }), alternative || "", "Performance metrics:", notes.bullets.metrics || "", "Verified completed work:", ...wins.map(win => win.what)].filter(Boolean).join("\n");
  // A draft the AM cannot open is worse than one they have to rewrite. When the model's content
  // cannot be produced or verified, the email is still built -- from the notes alone -- and the
  // reason becomes a gap on the review list, so every account gets something editable on screen
  // instead of an error where the email should be.
  const content = await generateRecapContent(env, evidence, blocked, { transcript, presentation }).catch((error) => {
    generationFailure = error instanceof Error ? error.message : "The recap content could not be generated.";
    return undefined;
  });
  const reviewGaps = [...(content?.reviewGaps || []), ...(generationFailure ? [`${generationFailure} This draft was written from the call notes alone — read every section before approving it.`] : [])];
  const liveBooking = touch.nextMeetingBooking ? await readBookedNextMeeting(context, touchId).catch(error => { reviewGaps.push(error instanceof Error ? error.message : "Verify the saved next meeting in Google Calendar."); return undefined; }) : undefined;
  const nextScheduledAt = liveBooking?.scheduledAt || next?.scheduledAt;
  let nextLabel = nextScheduledAt && timeZone ? new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone }).format(new Date(nextScheduledAt!)) + " (" + timeZone + ")" : "";
  let nextMeetingAgreed = false;
  if (content?.nextMeeting) {
    const agreed = content.nextMeeting;
    const calendarDate = nextScheduledAt && timeZone ? new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(new Date(nextScheduledAt!)) : "";
    if (calendarDate && agreed.date && calendarDate !== agreed.date) {
      reviewGaps.push("The next meeting date agreed in the transcript differs from the calendar. Confirm it before sending."); nextLabel = "";
    } else if (agreed.date) {
      nextMeetingAgreed = true;
      if (!nextLabel) nextLabel = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" }).format(new Date(agreed.date + "T12:00:00Z"));
    } else {
      reviewGaps.push("Verify the next meeting date: " + agreed.label); nextLabel = "";
    }
  }
  const draft = buildRecapEmailDraft(
    {
      businessName: client.name,
      contactName: recapContactName(client.contact, [notes.summary, touch.postMeeting?.recapSummary].filter(Boolean).join("\n")),
      ...(content ? { overview: content.overview, highlights: content.highlights, discussionTopics: content.discussionTopics, goalTargets: content.goalTargets, meetingCommitments: content.agencyCommitments, meetingRequests: content.clientRequests, next30Days: content.next30Days, promisedInclusions: content.promisedInclusions } : {}),
      nextMeetingAgreed,
      metLabel: dayLabel(touch.scheduledAt, timeZone),
      nextCheckInLabel: nextLabel,
      nextCheckInUrl: "",
      signoff: preferences.emailSignoff?.trim() || (
        preferences.jobTitle?.trim() && (profile.name || client.accountManager)
          ? `Best regards,\n${profile.name || client.accountManager}\n${preferences.jobTitle.trim()} | Map Ranking`
          : ""
      ),
      accountManagerName: profile.name || client.accountManager || "",
      ...(env.appUrl ? { appUrl: env.appUrl } : {}),
      wins,
    },
    { ...notes, summary: content?.overview || safeSummary, clientActions: [], pending: [], departments: notes.departments.map((group) => ({ ...group, actions: [] })) },
    [],
  );

  return {
    recap: { subject: draft.subject, html: draft.html },
    blockingGaps: [...draft.blockingGaps, ...reviewGaps],
    note: [
      !transcript && !alternative ? "No transcript was available. Verify the agreed follow-ups and promised email content against your call notes before approving." : "",
      wins.length ? "Completed work dates are omitted where no actual completion date is recorded." : "",
    ].filter(Boolean).join(" "),
  };
}

export async function saveFollowThroughRecap(
  context: TenantContext,
  touchId: string,
  recap: RecapEmailState,
): Promise<RecapEmailState> {
  // Cleaned on the way in, so the stored draft is exactly what the client would receive. The AM
  // wrote it, so this is not defence against an attacker -- it is defence against what lands in
  // a contentEditable when someone pastes from a web page.
  if (recapCommunicationViolations(`${recap.subject} ${recap.html}`).length) throw new Error("Keep internal team information out of the client recap. Include only the agreed client-facing follow-ups.");
  const cleaned: RecapEmailState = { ...recap, html: sanitizeRecapEmailHtml(recap.html) };
  const db = getFirebaseAdminDb();
  if (db) {
    await db
      .doc(monthlyTouchPath(context.tenantId, touchId))
      .set({ followThrough: { recap: cleaned } }, { mergeFields: ["followThrough.recap"] });
  }
  return cleaned;
}
