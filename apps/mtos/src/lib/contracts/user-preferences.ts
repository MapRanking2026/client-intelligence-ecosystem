/**
 * Everything an account manager can decide about how MTOS behaves for them.
 *
 * Three decisions shape this file:
 *
 *  - **Every field is optional, and every reader has a default.** An AM who never opens Settings
 *    gets exactly the behaviour they had before this existed. That is also why `normalizePreferences`
 *    drops anything it does not recognise instead of coercing it: a half-understood value saved into
 *    a preference that scales the call guide or picks the start page is worse than no value.
 *  - **Defaults live here and nowhere else.** `DEFAULT_PREFERENCES` is the one answer to "what does
 *    this do when unset", so a screen and the service behind it cannot disagree.
 *  - **The UI is described here too.** `PREFERENCE_GROUPS` carries the label, the hint and, where it
 *    matters, the plain statement of what reads the value. A switch whose effect an AM cannot find
 *    is a switch they stop trusting, so a field nothing reads yet says so in its own hint and is
 *    marked `notWiredYet`. Nothing is marked at the moment: the last one was the review brief's
 *    charts, and the brief now draws them.
 */

import {
  CALL_LENGTH_OPTIONS,
  isCallLength,
  type CallLengthMinutes,
} from "@/src/lib/contracts/live-call";

// ---------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------

export const THEME_CHOICES = ["light", "dark", "system"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export const LIVE_CALL_FORMATS = ["guide", "deck"] as const;
export type LiveCallFormat = (typeof LIVE_CALL_FORMATS)[number];

export const PREP_REVIEW_REMINDERS = ["2h", "1d", "2d", "off"] as const;
export type PrepReviewReminder = (typeof PREP_REVIEW_REMINDERS)[number];

/**
 * Where "Start page" may point.
 *
 * A closed list rather than a free path: this value is handed to a redirect on the app's root, and
 * a stored string that is not one of our own pages would send the AM somewhere we do not control.
 */
export const START_PAGES = [
  { value: "/command-center", label: "Command Center" },
  { value: "/clients", label: "Clients" },
  { value: "/monthly-touch", label: "Monthly Touches" },
  { value: "/calls", label: "Call Intelligence" },
  { value: "/commitments", label: "Commitments" },
  { value: "/opportunities", label: "Opportunities" },
  { value: "/qa", label: "QA & Coaching" },
] as const;
export type StartPage = (typeof START_PAGES)[number]["value"];

/**
 * Re-exported rather than restated: the call guide is written against these four lengths and
 * scales its parts from them, so the list belongs to the live-call contract and a second copy
 * here would be a second copy to keep in step.
 */
export const CALL_LENGTH_CHOICES = CALL_LENGTH_OPTIONS;
export type CallLengthChoice = CallLengthMinutes;

export interface NotificationPreferences {
  dailyDigest: boolean;
  weeklyDigest: boolean;
  overdueFollowThrough: boolean;
  clientRepliesInIntercom: boolean;
  prepFinished: boolean;
  /** The AM's own QC score landing. The one QC notification an AM can turn off. */
  qcScoreReady: boolean;
  /** A new touch arriving in the QC queue. Only ever raised for a QC reviewer. */
  qcQueueReady: boolean;
}

export interface UserPreferences {
  /** Overrides the name derived from the sign-in email, in the sidebar and on anything they author. */
  displayName?: string;
  /** Their own job title, shown under the name. Not the role: the role comes from their account. */
  jobTitle?: string;
  /** IANA zone. Every deadline and wall-clock label an AM reads is rendered in it. */
  timeZone?: string;
  /** The sign-off at the end of a client email, newline-separated as they type it. */
  emailSignoff?: string;
  /** Which Intercom admin client email goes out as. Their own address, as Intercom knows it. */
  clientEmailsSendThrough?: string;
  theme?: ThemeChoice;
  startPage?: StartPage;
  /** The fact-highlighting overlay, on by default for AMs who want to see where a number came from. */
  highlightFacts?: boolean;
  liveCallFormat?: LiveCallFormat;
  /** Scales the call guide and the deck. One of the four lengths the team actually books. */
  callLengthMinutes?: CallLengthChoice;
  prepReviewReminder?: PrepReviewReminder;
  chartsInReviewBrief?: boolean;
  /** Copy the other client-side attendees on the calendar event into the agenda email. */
  ccOfficeContact?: boolean;
  qaChipsInPresenterView?: boolean;
  notifications?: Partial<NotificationPreferences>;
}

/** What every unset preference means. The only place that answer is written down. */
export const DEFAULT_PREFERENCES: Required<Omit<UserPreferences, "notifications">> & {
  notifications: NotificationPreferences;
} = {
  displayName: "",
  jobTitle: "",
  // Pacific rather than the server's zone: the team works Pacific hours, and a deadline rendered
  // in UTC because a profile field was blank is a deadline read eight hours wrong.
  timeZone: "America/Los_Angeles",
  emailSignoff: "",
  clientEmailsSendThrough: "",
  // Light, because the CSS default is light and the pre-paint script in the root layout renders
  // light before it knows anything. Any other default would flash.
  theme: "light",
  startPage: "/command-center",
  highlightFacts: false,
  liveCallFormat: "guide",
  callLengthMinutes: 40,
  prepReviewReminder: "1d",
  chartsInReviewBrief: true,
  ccOfficeContact: false,
  qaChipsInPresenterView: true,
  notifications: {
    // The two digests send real email to the AM's own address, so they stay opt-in: nobody should
    // start receiving mail from a tool because of a default somebody else chose.
    dailyDigest: false,
    weeklyDigest: false,
    overdueFollowThrough: true,
    clientRepliesInIntercom: true,
    prepFinished: true,
    // Both on. These are the two halves of the QC loop, and a reviewer who has silently opted out
    // of the queue is a queue nobody is working.
    qcScoreReady: true,
    qcQueueReady: true,
  },
};

// ---------------------------------------------------------------------------
// Reading a stored value
// ---------------------------------------------------------------------------

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export function isCallLengthChoice(value: unknown): value is CallLengthChoice {
  return isCallLength(value);
}

export function isStartPage(value: unknown): value is StartPage {
  return typeof value === "string" && START_PAGES.some((page) => page.value === value);
}

/**
 * Whether a string is a time zone this runtime can actually format a date in.
 *
 * Asked of the runtime rather than checked against a list we maintain: the zone is used to render
 * deadlines, so the only question that matters is whether `Intl` accepts it.
 */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const TEXT_LIMITS: Record<string, number> = {
  displayName: 120,
  jobTitle: 120,
  emailSignoff: 600,
  clientEmailsSendThrough: 200,
};

function text(value: unknown, field: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, TEXT_LIMITS[field] || 200);
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function notifications(value: unknown): Partial<NotificationPreferences> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const out: Partial<NotificationPreferences> = {};
  for (const key of Object.keys(DEFAULT_PREFERENCES.notifications) as (keyof NotificationPreferences)[]) {
    const parsed = bool(row[key]);
    if (parsed !== undefined) out[key] = parsed;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Keep the fields we recognise and understand; drop everything else.
 *
 * Used on both sides of the wire -- reading what Firestore holds and reading what the Settings
 * screen posted -- so a value that could never have come from the screen cannot reach a reader
 * by being written straight into the document.
 */
export function normalizePreferences(input: unknown): UserPreferences {
  if (!input || typeof input !== "object") return {};
  const row = input as Record<string, unknown>;
  const out: UserPreferences = {};

  const displayName = text(row.displayName, "displayName");
  if (displayName !== undefined) out.displayName = displayName;
  const jobTitle = text(row.jobTitle, "jobTitle");
  if (jobTitle !== undefined) out.jobTitle = jobTitle;
  if (isTimeZone(row.timeZone)) out.timeZone = row.timeZone;
  const signoff = typeof row.emailSignoff === "string" ? row.emailSignoff.slice(0, TEXT_LIMITS.emailSignoff) : undefined;
  if (signoff !== undefined) out.emailSignoff = signoff;
  const sendThrough = text(row.clientEmailsSendThrough, "clientEmailsSendThrough");
  if (sendThrough !== undefined) out.clientEmailsSendThrough = sendThrough;

  const theme = oneOf(row.theme, THEME_CHOICES);
  if (theme) out.theme = theme;
  if (isStartPage(row.startPage)) out.startPage = row.startPage;
  const highlight = bool(row.highlightFacts);
  if (highlight !== undefined) out.highlightFacts = highlight;

  const format = oneOf(row.liveCallFormat, LIVE_CALL_FORMATS);
  if (format) out.liveCallFormat = format;
  if (isCallLengthChoice(row.callLengthMinutes)) out.callLengthMinutes = row.callLengthMinutes;
  const reminder = oneOf(row.prepReviewReminder, PREP_REVIEW_REMINDERS);
  if (reminder) out.prepReviewReminder = reminder;

  const charts = bool(row.chartsInReviewBrief);
  if (charts !== undefined) out.chartsInReviewBrief = charts;
  const cc = bool(row.ccOfficeContact);
  if (cc !== undefined) out.ccOfficeContact = cc;
  const qaChips = bool(row.qaChipsInPresenterView);
  if (qaChips !== undefined) out.qaChipsInPresenterView = qaChips;

  const notify = notifications(row.notifications);
  if (notify) out.notifications = notify;

  return out;
}

/** Every preference with its value, stored or default. What a reader asks for. */
export function resolvePreferences(stored: UserPreferences | undefined): typeof DEFAULT_PREFERENCES {
  const value = stored || {};
  return {
    ...DEFAULT_PREFERENCES,
    ...value,
    notifications: { ...DEFAULT_PREFERENCES.notifications, ...(value.notifications || {}) },
  } as typeof DEFAULT_PREFERENCES;
}

/** Which stored preferences differ from the default, so the screen can say "N changed". */
export function changedPreferenceCount(stored: UserPreferences | undefined): number {
  if (!stored) return 0;
  const resolved = resolvePreferences(stored);
  let count = 0;
  for (const key of Object.keys(DEFAULT_PREFERENCES) as (keyof typeof DEFAULT_PREFERENCES)[]) {
    if (key === "notifications") {
      for (const flag of Object.keys(DEFAULT_PREFERENCES.notifications) as (keyof NotificationPreferences)[]) {
        if (resolved.notifications[flag] !== DEFAULT_PREFERENCES.notifications[flag]) count += 1;
      }
      continue;
    }
    if (resolved[key] !== DEFAULT_PREFERENCES[key]) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// How the screen is laid out
// ---------------------------------------------------------------------------

export type PreferenceKind = "text" | "textarea" | "select" | "switch" | "timezone";

export interface PreferenceField {
  key: keyof UserPreferences | `notifications.${keyof NotificationPreferences}`;
  label: string;
  kind: PreferenceKind;
  /** The one line under the field. Where a value takes effect, this is where it says so. */
  hint: string;
  options?: { value: string | number; label: string }[];
  /** True when nothing in MTOS reads this yet, which the screen shows as a plain note. */
  notWiredYet?: boolean;
}

export interface PreferenceGroup {
  id: string;
  title: string;
  subtitle: string;
  fields: PreferenceField[];
}

export const PREFERENCE_GROUPS: PreferenceGroup[] = [
  {
    id: "profile",
    title: "You",
    subtitle: "How you are named on your own work, and the clock every deadline is rendered against.",
    fields: [
      {
        key: "displayName",
        label: "Display name",
        kind: "text",
        hint: "Shown in the sidebar and used wherever MTOS writes in your name. Blank uses the name on your sign-in.",
      },
      {
        key: "jobTitle",
        label: "Title",
        kind: "text",
        hint: "Shown under your name. Your role on the account team is separate and comes from your access.",
      },
      {
        key: "timeZone",
        label: "Time zone",
        kind: "timezone",
        hint: "Every due date and wall-clock time you read is rendered in this zone, including the 24-hour follow-through deadline.",
      },
      {
        key: "emailSignoff",
        label: "Email sign-off",
        kind: "textarea",
        hint: "Closes the agenda email and the recap email. One line per line, as you would type it.",
      },
      {
        key: "clientEmailsSendThrough",
        label: "Client emails send through",
        kind: "text",
        hint: "The Intercom admin address client email is sent as. Blank sends as the address on your sign-in.",
      },
    ],
  },
  {
    id: "workspace",
    title: "The workspace",
    subtitle: "What you see when you arrive, and how the app looks while you work.",
    fields: [
      {
        key: "theme",
        label: "Theme",
        kind: "select",
        hint: "Saved to your account, so it follows you to another computer. System follows the one your device is set to.",
        options: [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
          { value: "system", label: "System" },
        ],
      },
      {
        key: "startPage",
        label: "Start page",
        kind: "select",
        hint: "Where MTOS opens when you go to the app without a page in mind.",
        options: START_PAGES.map((page) => ({ value: page.value, label: page.label })),
      },
      {
        key: "highlightFacts",
        label: "Highlight facts",
        kind: "switch",
        hint: "Marks the numbers and quotes that carry a source, so you can see at a glance what is evidence.",
      },
    ],
  },
  {
    id: "calls",
    title: "Monthly Touches",
    subtitle: "What Approve prepares, and how long the call it prepares is.",
    fields: [
      {
        key: "liveCallFormat",
        label: "Live call format default",
        kind: "select",
        hint: "Which format the approval prepares. You can still switch format on the touch itself.",
        options: [
          { value: "guide", label: "Call guide" },
          { value: "deck", label: "Client deck" },
        ],
      },
      {
        key: "callLengthMinutes",
        label: "Default call length",
        kind: "select",
        hint: "Scales the guide and the deck. A 30-minute call gets a guide that can be delivered in 30 minutes.",
        options: CALL_LENGTH_CHOICES.map((minutes) => ({ value: minutes, label: `${minutes} minutes` })),
      },
      {
        key: "ccOfficeContact",
        label: "cc the office contact",
        kind: "switch",
        hint: "Copies the other client-side attendees on the calendar event into the agenda email.",
      },
      {
        key: "qaChipsInPresenterView",
        label: "QA chips in presenter view",
        kind: "switch",
        hint: "Shows the QA points beside your script while you present. The client screen never shows them.",
      },
      {
        key: "chartsInReviewBrief",
        label: "Charts in the review brief",
        kind: "switch",
        hint: "Draws the figures above the paragraph that explains them, in the sections that have numbers. Off leaves the brief as prose.",
      },
      {
        key: "prepReviewReminder",
        label: "Prep review reminder",
        kind: "select",
        hint: "How long before a call you want reminding to review its prep. The run comes round every two hours, so it can arrive a little early, never late.",
        options: [
          { value: "2h", label: "2 hours before" },
          { value: "1d", label: "1 day before" },
          { value: "2d", label: "2 days before" },
          { value: "off", label: "Off" },
        ],
      },
    ],
  },
  {
    id: "notifications",
    title: "Notifications",
    subtitle:
      "What you want to hear about. Everything except the two digests appears in your notifications in the header; the digests are also emailed to you through your own Gmail, and say so in the feed when they could not be.",
    fields: [
      {
        key: "notifications.dailyDigest",
        label: "Daily digest",
        kind: "switch",
        hint: "Once a day on your own clock: everything outstanding across your book, emailed and in your feed.",
      },
      {
        key: "notifications.weeklyDigest",
        label: "Weekly digest",
        kind: "switch",
        hint: "The same roll-up on your Monday, for a weekly rhythm rather than a daily one.",
      },
      {
        key: "notifications.overdueFollowThrough",
        label: "Overdue follow-through",
        kind: "switch",
        hint: "When a touch passes its 24-hour deadline without being processed. Raised once per touch, not once a day.",
      },
      {
        key: "notifications.clientRepliesInIntercom",
        label: "Client replies in Intercom",
        kind: "switch",
        hint: "When a client writes and nobody has answered, for the clients whose touch is within two weeks.",
      },
      {
        key: "notifications.prepFinished",
        label: "Prep finished",
        kind: "switch",
        hint: "When a brief has finished drafting and is waiting on your approval.",
      },
      {
        key: "notifications.qcScoreReady",
        label: "QC score ready",
        kind: "switch",
        hint: "When QC has scored one of your monthly touches. The notification carries the score, what went well and the coaching plan.",
      },
      {
        key: "notifications.qcQueueReady",
        label: "New touch in QC queue",
        kind: "switch",
        // Shown to everyone rather than hidden behind the role: a switch that appears and
        // disappears depending on who you are is one people report as a bug.
        hint: "For QC reviewers: when an account manager finishes a follow-through and the touch is ready to score. Nothing is raised if you do not review QC.",
      },
    ],
  },
];

/** Fields nothing reads yet, named once so the screen and the checks agree on which they are. */
export function notWiredPreferenceLabels(): string[] {
  return PREFERENCE_GROUPS.flatMap((group) =>
    group.fields.filter((field) => field.notWiredYet).map((field) => field.label),
  );
}
