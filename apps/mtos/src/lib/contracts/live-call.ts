/**
 * The live call: its three states, its clock, and how the approved brief becomes what the AM
 * actually reads while the client is talking.
 *
 * Three decisions here are the ones that matter, and they are all about trust in the screen:
 *
 *  - **The clock belongs to the call, not to the approval.** Approving the brief puts the touch
 *    into READY and nothing more, so a brief approved on Monday for a Thursday call does not show
 *    a three-day timer. The elapsed time is measured from `callStartedAt`, which only the Start
 *    call button writes.
 *  - **A declined section is never presented.** The guide and the deck are generated from the
 *    approved sections, but an AM can decline a section after approving -- so the decision is
 *    applied again here, at the moment of rendering, rather than trusted to have been applied
 *    once upstream.
 *  - **A part keeps its key when another part is dropped.** The AM's capture notes are stored
 *    against the part, so the key is the part's position in the generated guide and not its
 *    position on screen. Re-keying on render would move an AM's notes under the wrong heading.
 *
 * Kept free of React and Firestore so all of it can be exercised directly: the arithmetic in here
 * is read aloud on a client call, which is a poor place to find out it is wrong.
 */

import type {
  CallGuidePoint,
  CallGuideResponse,
  CallGuideSection,
  PresentationSlide,
  TouchLiveState,
} from "@/src/lib/mtos-data";
import type { BriefSectionId } from "@/src/lib/contracts/prep-brief";

// ---------------------------------------------------------------------------
// Call length
// ---------------------------------------------------------------------------

/** The lengths a Monthly Touch is booked for. The AM's default lives in their preferences. */
export const CALL_LENGTH_OPTIONS = [30, 40, 45, 60] as const;

export type CallLengthMinutes = (typeof CALL_LENGTH_OPTIONS)[number];

/** The length the guide is written against, and so the baseline every other length scales from. */
export const DEFAULT_CALL_LENGTH_MINUTES: CallLengthMinutes = 40;

export function isCallLength(value: unknown): value is CallLengthMinutes {
  return typeof value === "number" && (CALL_LENGTH_OPTIONS as readonly number[]).includes(value);
}

/** The AM's default, or 40 when they have not set one. */
export function callLengthMinutes(preference?: unknown): CallLengthMinutes {
  return isCallLength(preference) ? preference : DEFAULT_CALL_LENGTH_MINUTES;
}

// ---------------------------------------------------------------------------
// The three states of the call
// ---------------------------------------------------------------------------

/**
 * `not_ready` is a real state rather than an error: the Live step is reachable from the rail at
 * any time, and an AM who opens it before approving the brief should be told what is missing
 * instead of being shown a Start call button that would start a call with no guide behind it.
 */
export type LivePhase = "not_ready" | "ready" | "live" | "ended";

export function livePhase(live?: Pick<TouchLiveState, "readyAt" | "callStartedAt" | "callEndedAt">): LivePhase {
  if (live?.callEndedAt) return "ended";
  if (live?.callStartedAt) return "live";
  if (live?.readyAt) return "ready";
  return "not_ready";
}

export const LIVE_PHASE_BADGE: Record<LivePhase, string> = {
  not_ready: "NOT READY",
  ready: "READY",
  live: "LIVE",
  ended: "CALL ENDED",
};

/** Which chip colour the phase draws, in the app's own status vocabulary. */
export const LIVE_PHASE_TONE: Record<LivePhase, "neutral" | "good" | "watch" | "info"> = {
  not_ready: "watch",
  ready: "info",
  live: "good",
  ended: "neutral",
};

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

function parse(value?: string): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : time;
}

/**
 * Seconds of call so far: live counts up to now, an ended call is frozen at its own length.
 *
 * Never negative. A clock that has been started with a timestamp in the future -- a machine with
 * a wrong clock, a record edited by hand -- shows 00:00 rather than counting backwards.
 */
export function callElapsedSeconds(
  live: Pick<TouchLiveState, "callStartedAt" | "callEndedAt"> | undefined,
  nowIso?: string,
): number {
  const started = parse(live?.callStartedAt);
  if (started === undefined) return 0;
  const ended = parse(live?.callEndedAt);
  const now = parse(nowIso) ?? Date.now();
  return Math.max(0, Math.floor(((ended ?? now) - started) / 1000));
}

/** `mm:ss`, or `h:mm:ss` once a call runs past the hour. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(hours ? minutes : minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** `45:00`, the planned length in the same shape as the clock beside it. */
export function plannedClock(minutes: number): string {
  return `${String(Math.max(0, Math.round(minutes))).padStart(2, "0")}:00`;
}

/**
 * How the call is doing against its planned length, for the line beside the clock.
 *
 * Minutes, not seconds: nobody adjusts a call because they are forty seconds over, and a counter
 * that ticks over to "1 min over" on the dot is read as precision the number does not have.
 */
export function callBudget(
  elapsedSeconds: number,
  plannedMinutes: number,
): { over: boolean; label: string } {
  const overSeconds = elapsedSeconds - plannedMinutes * 60;
  if (overSeconds < 60) {
    const leftMinutes = Math.floor(-overSeconds / 60);
    return {
      over: false,
      label: leftMinutes > 0 ? `${leftMinutes} min left` : "on the hour",
    };
  }
  const overMinutes = Math.floor(overSeconds / 60);
  return { over: true, label: `${overMinutes} min over` };
}

export interface LiveHeader {
  phase: LivePhase;
  badge: string;
  tone: "neutral" | "good" | "watch" | "info";
  /** The clock, for LIVE and CALL ENDED. Empty in the other two states, which have no call. */
  clock: string;
  /** The line beside the badge: what to do next, or how long the call ran. */
  note: string;
  /** Whether the Start call and End call buttons belong on screen. */
  canStart: boolean;
  canEnd: boolean;
}

/**
 * The whole header in one value, so the screen renders a state rather than deciding one.
 *
 * `formatLabel` is the AM's chosen delivery -- the call guide or the client presentation -- named
 * in the header because it is what the Approve button built, and an AM who expected a deck should
 * find that out before the client joins rather than when they go looking for slides.
 */
export function liveHeader(options: {
  live?: Pick<TouchLiveState, "readyAt" | "callStartedAt" | "callEndedAt">;
  plannedMinutes: number;
  formatLabel: string;
  nowIso?: string;
}): LiveHeader {
  const phase = livePhase(options.live);
  const elapsed = callElapsedSeconds(options.live, options.nowIso);
  const base = { phase, badge: LIVE_PHASE_BADGE[phase], tone: LIVE_PHASE_TONE[phase] };

  if (phase === "not_ready") {
    return {
      ...base,
      clock: "",
      note: "Approve the brief on the review step first — that is what builds the guide and the deck.",
      canStart: false,
      canEnd: false,
    };
  }
  if (phase === "ready") {
    return {
      ...base,
      clock: "",
      note: `${options.formatLabel} ready — look it over now, start the clock when the client joins.`,
      canStart: true,
      canEnd: false,
    };
  }
  if (phase === "live") {
    const budget = callBudget(elapsed, options.plannedMinutes);
    return {
      ...base,
      clock: formatClock(elapsed),
      note: `of ${plannedClock(options.plannedMinutes)} planned · ${budget.label} · ${options.formatLabel}`,
      canStart: false,
      canEnd: true,
    };
  }
  return {
    ...base,
    clock: formatClock(elapsed),
    // The length is the one fact the AM wants after hanging up, and the follow-through's deadline
    // is counted from the end of the call, so the header says it plainly.
    note: `call length · ${options.formatLabel}`,
    canStart: false,
    canEnd: false,
  };
}

// ---------------------------------------------------------------------------
// The guide parts
// ---------------------------------------------------------------------------

export interface GuidePart {
  /**
   * Stable across declines: the part's position in the generated guide, which is what the AM's
   * capture notes are stored against. Never its position on screen.
   */
  key: string;
  /** Position on screen, from 1. */
  n: number;
  title: string;
  minutes: number;
  /** Minute of the call this part should start and finish on. */
  startMinute: number;
  endMinute: number;
  /** `min 0–3 of 40`, so the AM can see at a glance whether the call is running long. */
  window: string;
  sectionId?: BriefSectionId;
  goal: string;
  say: string;
  points: CallGuidePoint[];
  ask: string[];
  ifSays: CallGuideResponse[];
  qaChips: string[];
  next: string;
}

/** The key the AM's notes for a guide part are stored under in `live.notes`. */
export function guidePartKey(generatedIndex: number): string {
  return `part-${generatedIndex + 1}`;
}

function pointsOf(section: CallGuideSection): CallGuidePoint[] {
  if (section.points?.length) {
    return section.points.filter((point) => point.text?.trim());
  }
  // An older guide, generated before the richer part existed. Its talking points are the content;
  // only the source chips are missing, and a point with no chip is better than no point.
  return section.talkingPoints.filter((point) => point?.trim()).map((text) => ({ text }));
}

/**
 * The parts the AM presents, timed to the length this call was booked for.
 *
 * The windows are allocated cumulatively against the planned length rather than by scaling each
 * part on its own, which is what makes them add up: the last part ends on the planned minute
 * instead of two minutes short of it because every part rounded down. Each part keeps at least a
 * minute, so a guide with more parts than the call has minutes still reads in order -- it simply
 * runs past the planned end, which is the truth of that call.
 */
export function buildGuideParts(options: {
  sections?: CallGuideSection[];
  plannedMinutes: number;
  declinedSections?: string[];
}): GuidePart[] {
  const declined = new Set(options.declinedSections || []);
  const kept = (options.sections || [])
    .map((section, generatedIndex) => ({ section, generatedIndex }))
    .filter(({ section }) => !(section.sectionId && declined.has(section.sectionId)));

  const total = kept.reduce((sum, { section }) => sum + Math.max(1, section.minutes || 1), 0);
  const planned = Math.max(1, Math.round(options.plannedMinutes));

  let cumulative = 0;
  let startMinute = 0;

  return kept.map(({ section, generatedIndex }, index) => {
    cumulative += Math.max(1, section.minutes || 1);
    const rawEnd = total > 0 ? Math.round((planned * cumulative) / total) : startMinute + 1;
    const endMinute = Math.max(startMinute + 1, rawEnd);
    const part: GuidePart = {
      key: guidePartKey(generatedIndex),
      n: index + 1,
      title: section.title,
      minutes: endMinute - startMinute,
      startMinute,
      endMinute,
      window: `min ${startMinute}–${endMinute} of ${planned}`,
      ...(section.sectionId ? { sectionId: section.sectionId } : {}),
      goal: section.goal?.trim() || "",
      say: section.say?.trim() || "",
      points: pointsOf(section),
      ask: section.clientPrompts.filter((prompt) => prompt?.trim()),
      ifSays: (section.ifSays || []).filter((row) => row.says?.trim() && row.response?.trim()),
      qaChips: (section.qaChips || []).filter((chip) => chip?.trim()),
      next: section.next?.trim() || "",
    };
    startMinute = endMinute;
    return part;
  });
}

// ---------------------------------------------------------------------------
// The deck
// ---------------------------------------------------------------------------

/**
 * The slides shown on this call: every slide except those presenting a declined section.
 *
 * The cover, the agenda and the closing slides carry no section and are always kept, so a deck
 * never loses its frame because the AM declined a section in the middle of it.
 */
export function visibleSlides(
  slides: PresentationSlide[] | undefined,
  declinedSections?: string[],
): PresentationSlide[] {
  const declined = new Set(declinedSections || []);
  return (slides || []).filter((slide) => !(slide.sectionId && declined.has(slide.sectionId)));
}

// ---------------------------------------------------------------------------
// The client screen
// ---------------------------------------------------------------------------

/** Where the slides-only window lives. The AM shares this window in Meet, not the whole app. */
export function clientScreenPath(touchId: string): string {
  return `/monthly-touch/${encodeURIComponent(touchId)}/client-screen`;
}

/**
 * One channel per touch, so two AMs presenting two different clients from one browser profile
 * cannot drive each other's client screen.
 */
export function clientScreenChannel(touchId: string): string {
  return `mtos-client-screen:${touchId}`;
}

/**
 * What the presenter and the client window say to each other.
 *
 * `hello` matters more than it looks: the client window is opened by the AM at an arbitrary
 * moment, so it cannot assume it starts on the same slide as the presenter. It announces itself,
 * and the presenter answers with where it actually is. Without that the client sees slide 1 while
 * the AM talks about slide 4 until the next click.
 */
export type ClientScreenMessage =
  | { type: "hello" }
  | { type: "slide"; index: number }
  | { type: "closed" };

export function isClientScreenMessage(value: unknown): value is ClientScreenMessage {
  if (!value || typeof value !== "object") return false;
  const row = value as { type?: unknown; index?: unknown };
  if (row.type === "hello" || row.type === "closed") return true;
  return row.type === "slide" && typeof row.index === "number" && Number.isInteger(row.index) && row.index >= 0;
}
