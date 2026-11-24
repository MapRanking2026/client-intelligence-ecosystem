import type { MonthlyTouchRecord, Presentation } from "@/src/lib/mtos-data";

export interface NoShowState {
  resolution: "reschedule" | "loom";
  selectedAt: string;
  selectedBy: string;
  script?: string;
  url?: string;
  presentation?: Presentation;
  email?: { subject: string; html: string; recipient: string };
  sendStatus?: "sending" | "sent" | "failed" | "unknown";
  sendError?: string;
  conversationId?: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  emailProvider?: "gmail" | "intercom";
  sentAt?: string;
  rescheduledAt?: string;
  standbyUntil?: string;
}

export interface RescheduleAvailability {
  currentBooking?: { start: string; end: string };
  durationMinutes: number;
  until: string;
  timeZone?: string;
  calendarCount?: number;
  busy: { start?: string; end?: string; timeZone?: string }[];
}

export function calendarSlotAvailable(startIso: string, availability: RescheduleAvailability, now: number): boolean {
  const start = Date.parse(startIso);
  const end = start + availability.durationMinutes * 60000;
  if (!Number.isFinite(start) || start <= now || end > Date.parse(availability.until)) return false;
  const localDay = (instant: number, timeZone = availability.timeZone || "UTC") => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  return !availability.busy.some((period) => {
    if (!period.start || !period.end) return true;
    if (period.start.length === 10) return localDay(start, period.timeZone) < period.end && localDay(end - 1, period.timeZone) >= period.start;
    return start < Date.parse(period.end) && end > Date.parse(period.start);
  });
}

/**
 * Why this no-show cannot be taken back, or undefined when it can.
 *
 * The client who rings ten minutes late is the ordinary case: No-Show has been clicked, a
 * resolution may even have been picked, and nothing has left the building yet. Undoing that is
 * just deleting a local decision, so the call can run as though it had never been recorded.
 *
 * What cannot be undone from this panel is anything the client has already seen -- a meeting
 * moved in their calendar, or a video update Gmail has accepted. Those are reversed where they
 * happened, not with a button here, and an in-flight send is held until it is reconciled so an
 * undo cannot race a second email.
 */
export function noShowUndoBlocker(state: NoShowState | undefined): string | undefined {
  if (!state) return "There is no recorded no-show on this Monthly Touch.";
  if (state.rescheduledAt) return "This meeting has already been moved in Google Calendar. Change the meeting back there first, then reopen the touch.";
  if (state.sendStatus === "sent") return "The Loom update has already been emailed to the client. The call cannot be resumed from here.";
  if (state.sendStatus === "sending" || state.sendStatus === "unknown") return "Email delivery is unresolved. Check the sending mailbox and reconcile it before undoing the no-show.";
  return undefined;
}

export function usableLoomUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      ["loom.com", "www.loom.com"].includes(url.hostname) && /^\/share\/[a-zA-Z0-9]+\/?$/.test(url.pathname);
  } catch { return false; }
}

export function loomReady(touch: Pick<MonthlyTouchRecord, "noShow" | "prepPack" | "review">): boolean {
  const loom = touch.noShow;
  return Boolean(loom?.resolution === "loom" && loom.sendStatus === "sent" && loom.sentAt &&
    (loom.gmailMessageId || loom.conversationId) && usableLoomUrl(loom.url || "") && loom.script?.trim() &&
    loom.presentation?.status === "generated" && touch.prepPack && touch.review?.approvedAt && loom.email);
}

/** Alternative evidence, never a fabricated transcript or client statement. */
export function loomEvidence(touch: MonthlyTouchRecord): string | undefined {
  if (!loomReady(touch)) return undefined;
  return [
    "NO-SHOW / LOOM VIDEO UPDATE. No live meeting took place; no transcript exists.",
    "Use the following supporting materials. Do not invent client feedback, quotes, agreement, NPS, or video observations. The URL is a reference, not evidence that you watched the video.",
    JSON.stringify({ preparation: touch.prepPack, brief: touch.prepBrief, review: touch.review,
      recommendations: touch.aiRecommendations, opportunities: touch.opportunities,
      risks: touch.risks, commitments: touch.commitments, loom: touch.noShow }, null, 2),
  ].join("\n\n");
}
