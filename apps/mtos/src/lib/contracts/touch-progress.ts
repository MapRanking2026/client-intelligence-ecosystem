import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";
/**
 * Where a Monthly Touch has got to, and when its follow-through is due.
 *
 * A touch is one long piece of work split over days: the preparation, the review of the brief, the
 * call itself, the follow-through, then QA. The account manager leaves it and comes back, often on
 * a different machine, and until now the screen had no idea which of those they were in the middle
 * of -- so reopening a client dropped them at the top and they had to find their place again.
 *
 * `progress` is the furthest step reached, never the step being looked at. An AM who opens the
 * review again after the call is reading, not rewinding, so looking backwards must not lose the
 * fact that the call already happened. That is why every write goes through `advanceProgress`.
 *
 * Kept free of Firestore and React so the step order and the deadline arithmetic can be exercised
 * directly -- the deadline in particular is the one number in the system an AM can be measured on.
 */

export type TouchStep = "prep" | "review" | "live" | "follow" | "qa";

/** The five steps in the order they happen. Index order is the whole state machine. */
export const TOUCH_STEPS: TouchStep[] = ["prep", "review", "live", "follow", "qa"];

export const TOUCH_STEP_LABELS: Record<TouchStep, string> = {
  prep: "Preparation",
  review: "Review the brief",
  live: "Live call",
  follow: "Follow-through",
  qa: "QA review",
};

/** Short form for the step rail, where the long labels wrap. */
export const TOUCH_STEP_SHORT: Record<TouchStep, string> = {
  prep: "Prep",
  review: "Review",
  live: "Live",
  follow: "Follow-through",
  qa: "QA",
};

export function isTouchStep(value: unknown): value is TouchStep {
  return typeof value === "string" && (TOUCH_STEPS as string[]).includes(value);
}

export function touchStepIndex(step: TouchStep): number {
  return TOUCH_STEPS.indexOf(step);
}

/** The step a touch is at when nothing has been recorded yet. */
export const FIRST_TOUCH_STEP: TouchStep = "prep";

/**
 * The furthest step reached, given what is stored and what a caller wants to move to.
 *
 * Monotone on purpose: a caller may only move the marker forward. Returning the stored step for a
 * backwards request is what lets the UI navigate freely without the stored state following it.
 */
export function advanceProgress(stored: TouchStep | undefined, next: TouchStep): TouchStep {
  const current = stored && isTouchStep(stored) ? stored : FIRST_TOUCH_STEP;
  return touchStepIndex(next) > touchStepIndex(current) ? next : current;
}

/**
 * The step a screen should open on.
 *
 * `?stage=` is honoured only for a step the touch has actually reached -- a link to `follow` on a
 * touch that has not had its call yet would otherwise open a follow-through screen with no
 * transcript, which reads as a broken page rather than as a step that hasn't happened.
 */
export function resolveOpeningStep(
  progress: TouchStep | undefined,
  requested?: string | null,
): TouchStep {
  const reached = progress && isTouchStep(progress) ? progress : FIRST_TOUCH_STEP;
  if (requested && isTouchStep(requested) && touchStepIndex(requested) <= touchStepIndex(reached)) {
    return requested;
  }
  return reached;
}

export interface ResumeNotice {
  step: TouchStep;
  /** `Picked up where you left off — Review the brief.` */
  headline: string;
  /** `Last saved 10:42 AM, Jul 2` in the AM's own zone, or undefined when nothing is saved yet. */
  savedLabel?: string;
}

/**
 * The banner shown when a touch is reopened part-way through.
 *
 * Absent for a touch still on its first step with nothing saved: there is nothing to pick up, and
 * a banner saying so on a brand-new touch is noise the AM learns to scroll past.
 */
export function resumeNotice(options: {
  progress?: TouchStep;
  lastSavedAt?: string;
  timeZone?: string;
}): ResumeNotice | undefined {
  const step = options.progress && isTouchStep(options.progress) ? options.progress : FIRST_TOUCH_STEP;
  const saved = options.lastSavedAt ? new Date(options.lastSavedAt) : undefined;
  const savedValid = saved && !Number.isNaN(saved.getTime()) ? saved : undefined;
  if (step === FIRST_TOUCH_STEP && !savedValid) return undefined;
  return {
    step,
    headline: `Picked up where you left off — ${TOUCH_STEP_LABELS[step]}.`,
    ...(savedValid ? { savedLabel: `Last saved ${wallClockLabel(savedValid, options.timeZone)}` } : {}),
  };
}

function wallClockLabel(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}),
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date);
}

export const FOLLOW_THROUGH_HOURS = 24;

/**
 * When the follow-through is due: 24 hours after the call ended.
 *
 * Plain clock hours, weekend included. This used to skip Saturday and Sunday, which made a Friday
 * call read as "2d 23h left" on the Friday afternoon it happened -- a deadline that says you have
 * three days is not a 24-hour deadline, whatever it is measured in, and the follow-through is
 * worth doing while the call is still fresh rather than after a weekend.
 */
export function followThroughDueAt(callEndedAt: string | undefined): string | undefined {
  if (!callEndedAt) return undefined;
  const parsed = Date.parse(callEndedAt);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed + FOLLOW_THROUGH_HOURS * 60 * 60 * 1000).toISOString();
}

export type DeadlineTone = "ok" | "amber" | "red";

export interface FollowThroughDeadline {
  dueAt: string;
  tone: DeadlineTone;
  /** `3h 12m left` or `2h 40m overdue`. */
  label: string;
  msRemaining: number;
  overdue: boolean;
}

const AMBER_WITHIN_MS = 4 * 60 * 60 * 1000;

/** The countdown as the AM reads it: amber inside four hours, red once it has passed. */
export function followThroughDeadline(
  dueAt: string | undefined,
  now: number = Date.now(),
): FollowThroughDeadline | undefined {
  if (!dueAt) return undefined;
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return undefined;
  const msRemaining = due - now;
  const overdue = msRemaining < 0;
  return {
    dueAt,
    msRemaining,
    overdue,
    tone: overdue ? "red" : msRemaining <= AMBER_WITHIN_MS ? "amber" : "ok",
    label: `${durationLabel(Math.abs(msRemaining))} ${overdue ? "overdue" : "left"}`,
  };
}

function durationLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours >= 1) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

export function canDeleteTestTouch(touch: MonthlyTouchRecord): boolean {
  return !(
    touch.deletedAt || touch.status === "Completed" || touch.qc || touch.qaReview ||
    touch.approval?.startedAt || touch.agendaEmail?.sentAt ||
    touch.prepWorkflow?.confirmationEmail?.sentAt || touch.prepWorkflow?.filing?.links ||
    touch.followThrough?.processing || touch.followThrough?.recap?.sentAt ||
    Object.keys(touch.followThrough?.ticketIds || {}).length ||
    touch.postMeeting?.status === "approved" || touch.postMeeting?.notes?.clientBook ||
    touch.postMeeting?.clientIntelligence?.status === "applied" ||
    touch.postMeeting?.draftTickets?.some((ticket) => ticket.clickupTaskId)
  );
}
