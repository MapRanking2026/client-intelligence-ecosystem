/**
 * The Post Monthly Touch Notes: what is in them, in what order, and what makes one finished.
 *
 * The numbering is not decoration. These notes are pasted into the Client's Book, read by the
 * next AM who picks the account up and graded by QA against section numbers, so "section 3" has
 * to mean the same thing on every client in the book. That is why the order is fixed here rather
 * than left to whatever the model felt like emitting.
 *
 * Two rules in here will look fussy and are not:
 *
 *  - **Four sentences for the summary.** Not a style preference. The summary is the only part
 *    anyone reads in a hurry, and a summary that runs to twelve sentences is one nobody reads at
 *    all -- at which point the notes have failed at the one job they do between calls.
 *  - **Twenty words for an action line.** An action is a ticket title and a commitment. Past
 *    twenty words it stops being either: it becomes a paragraph that cannot be assigned, cannot
 *    be checked off, and hides the actual deliverable in the middle of a sentence.
 *
 * Both are reported, neither is enforced. The AM can leave a long line; they just see that it is
 * long, and why. Nothing in this module reaches a model, a database or ClickUp.
 */

// ---------------------------------------------------------------------------
// The sections
// ---------------------------------------------------------------------------

export type NotesSectionId = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";

export interface NotesSection {
  id: NotesSectionId;
  title: string;
  /** What belongs in it, shown under the heading while the AM edits. */
  blurb: string;
}

export const NOTES_SECTIONS: NotesSection[] = [
  {
    id: "1",
    title: "Meeting identification",
    blurb: "Who, when, which touch, the score you confirmed, and where the quarterly goal stands.",
  },
  {
    id: "2",
    title: "Meeting summary",
    blurb: "Four sentences at most, then the labelled bullets. The only part most people read.",
  },
  {
    id: "3",
    title: "Action items by department",
    blurb: "Only the departments that actually came up. Each one: what the client said, then what we will do.",
  },
  {
    id: "4",
    title: "Account health / risk",
    blurb: "Only when the score is 6 or below. The register row, the playbook, and the Manager tag.",
  },
  {
    id: "5",
    title: "Client / participation",
    blurb: "What the client owes us, by when, and what it is holding up.",
  },
  {
    id: "6",
    title: "Pending info — draft tickets",
    blurb: "Work we cannot start yet. Who we are waiting on, and when to chase.",
  },
  { id: "7", title: "Client recap email", blurb: "The email going to the client, in their language." },
  { id: "8", title: "Post-touch checklist", blurb: "Everything above, filed within 24 business hours." },
];

/**
 * The heading number for section 2, which is the one section that renumbers.
 *
 * With AM context added the summary becomes 2A and the context 2B; without it the summary is
 * plainly 2 and there is no 2B at all. An empty 2B is never written as a blank heading -- it
 * reads as a section somebody forgot to fill in, where the truth is that there was nothing to add.
 */
export function summaryNumbering(hasAmContext: boolean): { summary: string; context?: string } {
  return hasAmContext ? { summary: "2A", context: "2B" } : { summary: "2" };
}

/** What the notes say in place of AM context when the AM added none. */
export const NO_AM_CONTEXT = "None provided.";

// ---------------------------------------------------------------------------
// The summary's sentence budget
// ---------------------------------------------------------------------------

export const SUMMARY_MAX_SENTENCES = 4;

/**
 * How many sentences a piece of prose runs to.
 *
 * Counts terminators rather than splitting, and treats a trailing fragment with no full stop as a
 * sentence, because an AM mid-type is writing one. Decimal points and the common abbreviations
 * that appear in these notes are not terminators: "Dr. Chen asked about Q4." is one sentence, and
 * counting it as two would put a four-sentence summary over budget for no reason the AM can see.
 */
export function sentenceCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  const masked = trimmed
    // 3.5, $1,200.00 -- a stop between digits never ends a sentence.
    .replace(/(\d)[.](\d)/g, "$1_$2")
    // The titles and abbreviations that turn up in these notes.
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|approx|no|est)\./gi, "$1_")
    // An initial in a name: "J. Alvarez".
    .replace(/\b([A-Z])[.]/g, "$1_");

  // The closing quote or bracket is allowed to sit between the stop and the space: a sentence
  // ending on a quotation ("He said \"fine.\" We moved on.") is still a sentence that ended.
  const terminated = masked.match(/[.!?]+["')\]]?(?=\s|$)/g)?.length || 0;
  const endsClean = /[.!?]["')\]]?$/.test(masked);
  return endsClean ? terminated : terminated + 1;
}

/** The counter under the summary box: how many, out of how many, and whether it is over. */
export function summaryBudget(text: string): { count: number; max: number; over: boolean } {
  const count = sentenceCount(text);
  return { count, max: SUMMARY_MAX_SENTENCES, over: count > SUMMARY_MAX_SENTENCES };
}

/** The labelled bullets that sit under the summary, in the order they are written. */
export const SUMMARY_BULLETS = [
  { key: "metrics", label: "Metrics" },
  { key: "delivery", label: "Delivery status" },
  { key: "posture", label: "Client posture" },
  { key: "requests", label: "Client requests" },
  { key: "nextTouch", label: "Next touch" },
  { key: "sentiment", label: "Client sentiment" },
] as const;

export type SummaryBulletKey = (typeof SUMMARY_BULLETS)[number]["key"];

// ---------------------------------------------------------------------------
// Action lines
// ---------------------------------------------------------------------------

export const ACTION_MAX_WORDS = 20;

export interface ActionLine {
  id: string;
  /** What we will do. The ticket's name, in the client's terms. */
  what: string;
  /** The Map Ranking team that owns it. */
  team: string;
  /** When it is due, as the AM would say it to the client ("Fri 7 Nov"). */
  due: string;
  /** True when this was already owed before this call. */
  carryOver?: boolean;
  /** Another department this touches, where it genuinely does. */
  crossDepartment?: string;
  /** What has to happen first. Only a real dependency, never a restatement of the due date. */
  dependsOn?: string;
}

/** The one format every action line takes, in the notes and in the pasted document alike. */
export function formatActionLine(action: ActionLine): string {
  const parts = [`**Action:** ${action.what.trim()}`, action.team.trim(), action.due.trim()].filter(
    (part) => part && part !== "**Action:** ",
  );
  let line = parts.join(" — ");
  if (action.carryOver) line += " _(carry-over)_";
  if (action.crossDepartment?.trim()) line += ` _(also ${action.crossDepartment.trim()})_`;
  if (action.dependsOn?.trim()) line += ` _(after ${action.dependsOn.trim()})_`;
  return line;
}

/** Words in the `what` -- the only part the twenty-word budget applies to. */
export function actionWordCount(action: Pick<ActionLine, "what">): number {
  return action.what.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * What is wrong with an action line, in the AM's words. Empty means nothing is.
 *
 * Length is reported last because it is the softest of the three: a line missing its owner or its
 * date cannot become a ticket at all, while a long one merely reads badly.
 */
export function actionLineIssues(action: ActionLine): string[] {
  const issues: string[] = [];
  if (!action.what.trim()) issues.push("Say what we will actually do.");
  if (!action.team.trim()) issues.push("Name the team that owns it.");
  if (!action.due.trim()) issues.push("Give it a date.");
  const words = actionWordCount(action);
  if (words > ACTION_MAX_WORDS) {
    issues.push(`${words} words — over ${ACTION_MAX_WORDS}. Shorten it to the deliverable, or split it in two.`);
  }
  return issues;
}

// ---------------------------------------------------------------------------
// The quarterly goal
// ---------------------------------------------------------------------------

export const GOAL_STATUSES = [
  "On track",
  "At risk",
  "Off track",
  "Too early to tell",
  "Newly set this call",
  "Not discussed",
  "Met",
  "Not met",
] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

export function isGoalStatus(value: unknown): value is GoalStatus {
  return typeof value === "string" && (GOAL_STATUSES as readonly string[]).includes(value);
}

/** "Q4 2026" for the quarter a date falls in. */
export function quarterLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
}

/** The notes' title line. */
export function notesTitle(input: {
  clientName: string;
  date: string;
  accountManager?: string;
  monthNumber?: number;
}): string {
  const parts = [input.clientName, input.date];
  if (input.accountManager?.trim()) parts.push(`AM: ${input.accountManager.trim()}`);
  // "Month n" only when the touch's place in the series is actually known. A guessed ordinal in
  // the title of a filed document is the kind of thing that gets quoted back a year later.
  parts.push(
    input.monthNumber
      ? `Recurring Monthly Touch (Month ${input.monthNumber})`
      : "Recurring Monthly Touch",
  );
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

export interface DepartmentNotes {
  department: string;
  /** What the client said that put this department in the notes. */
  clientFeedback: string;
  actions: ActionLine[];
}

export interface ClientAction {
  id: string;
  what: string;
  due: string;
  /** True when the client gave a date they were not sure about. */
  tentative?: boolean;
  /** What of ours this is holding up. */
  blocks?: string;
}

export interface PendingItem {
  id: string;
  /** Which of the two pending states this is in. */
  waitingOn: "Client" | "AM review";
  /** What is missing. */
  missing: string;
  /** Who it is coming from. */
  from: string;
  /** The team that picks it up once it arrives. */
  team: string;
  /** The AM who owns the chase. */
  owner: string;
  /** When to chase. */
  reminderDate: string;
}

export interface NotesDraft {
  title: string;
  /** The confirmed score, repeated into the notes so the document stands on its own. */
  nps: number | null;
  npsJustification: string;
  goalQuarter: string;
  goalText: string;
  goalStatus: GoalStatus;
  goalEvidence: string;
  summary: string;
  bullets: Partial<Record<SummaryBulletKey, string>>;
  /** undefined means the AM never opened the box; "" means they opened it and left it empty. */
  amContext?: string;
  departments: DepartmentNotes[];
  /** Only written when the score is 6 or below. */
  healthRisk?: { playbook: string; registerNote: string; managerTag: string };
  clientActions: ClientAction[];
  pending: PendingItem[];
}

/** The `[PENDING – ...]` marker a pending item carries into the notes and its ticket title. */
export function pendingMarker(item: Pick<PendingItem, "waitingOn">): string {
  return `[PENDING – ${item.waitingOn === "Client" ? "waiting on Client" : "AM review"}]`;
}

// ---------------------------------------------------------------------------
// Rendering, for the preview and for the page that gets pasted into ClickUp
// ---------------------------------------------------------------------------

export interface RenderOptions {
  /** Ticket links by action id, appended to each action line once the tickets exist. */
  ticketLinks?: Record<string, string>;
  /** The "Tickets created" list at the bottom, once there is one. */
  createdTickets?: { title: string; url: string }[];
}

/**
 * The notes as paste-safe markdown.
 *
 * Headings, one level of bullets, bold labels and blank lines between blocks -- and nothing else.
 * No tables and no code fences: ClickUp's importer renders a table as a wall of pipes and a fence
 * as a grey box nobody can edit, and these notes are meant to be edited in place by the next AM.
 */
export function renderNotesMarkdown(draft: NotesDraft, options: RenderOptions = {}): string {
  const out: string[] = [];
  const push = (line = "") => out.push(line);
  const links = options.ticketLinks || {};

  const action = (line: ActionLine) => {
    const link = links[line.id];
    push(`- ${formatActionLine(line)}${link ? ` — [ticket](${link})` : ""}`);
  };

  push(`# ${draft.title}`);
  push();

  push("## 1 · Meeting identification");
  push();
  push(
    `- **NPS / Account Health:** ${draft.nps === null ? "No score recorded" : `${draft.nps}/10`}`,
  );
  if (draft.npsJustification.trim()) push(`- **Why:** ${draft.npsJustification.trim()}`);
  push(
    `- **Quarterly goal${draft.goalQuarter ? ` (${draft.goalQuarter})` : ""}:** ${
      draft.goalText.trim() || "Not recorded"
    }`,
  );
  push(`- **Status:** ${draft.goalStatus}`);
  if (draft.goalEvidence.trim()) push(`- **Evidence:** ${draft.goalEvidence.trim()}`);
  push();

  const hasContext = draft.amContext !== undefined;
  const numbering = summaryNumbering(hasContext);

  push(`## ${numbering.summary} · Meeting summary`);
  push();
  if (draft.summary.trim()) {
    push(draft.summary.trim());
    push();
  }
  for (const bullet of SUMMARY_BULLETS) {
    const value = draft.bullets[bullet.key]?.trim();
    if (value) push(`- **${bullet.label}:** ${value}`);
  }
  push();

  if (numbering.context) {
    push(`## ${numbering.context} · Additional AM context`);
    push();
    push(draft.amContext?.trim() || NO_AM_CONTEXT);
    push();
  }

  push("## 3 · Action items by department");
  push();
  if (!draft.departments.length) {
    push("No department actions came out of this call.");
    push();
  }
  for (const department of draft.departments) {
    push(`### ${department.department}`);
    push();
    if (department.clientFeedback.trim()) {
      push(`- **Client feedback:** ${department.clientFeedback.trim()}`);
    }
    for (const line of department.actions) action(line);
    push();
  }

  if (draft.healthRisk) {
    push("## 4 · Account health / risk");
    push();
    push(`- **Risk Register:** ${draft.healthRisk.registerNote}`);
    push(`- **Playbook:** ${draft.healthRisk.playbook}`);
    push(`- **Manager:** ${draft.healthRisk.managerTag}`);
    push();
  }

  push("## 5 · Client / participation");
  push();
  if (!draft.clientActions.length) {
    push("Nothing is owed by the client from this call.");
    push();
  }
  for (const item of draft.clientActions) {
    const tentative = item.tentative ? " (tentative)" : "";
    const blocks = item.blocks?.trim() ? ` — holds up ${item.blocks.trim()}` : "";
    push(`- **${item.what.trim()}** — ${item.due.trim()}${tentative}${blocks}`);
  }
  push();

  push("## 6 · Pending info — draft tickets");
  push();
  if (!draft.pending.length) {
    push("Nothing is pending.");
    push();
  }
  for (const item of draft.pending) {
    push(`- **${pendingMarker(item)}** ${item.missing.trim()}`);
    push(`  - From: ${item.from.trim()} · Team: ${item.team.trim()} · Owner: ${item.owner.trim()}`);
    push(`  - Chase on: ${item.reminderDate.trim()}`);
  }
  push();

  if (options.createdTickets?.length) {
    push("## Tickets created");
    push();
    for (const ticket of options.createdTickets) {
      push(`- [${ticket.title}](${ticket.url})`);
    }
    push();
  }

  // One trailing newline, and never three blank lines in a row -- ClickUp's importer turns a run
  // of blank lines into empty paragraphs the next AM has to delete by hand.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// Whether the notes are finished
// ---------------------------------------------------------------------------

/**
 * What is still missing from the notes, in the AM's words.
 *
 * The summary's length is NOT on this list. It is shown as a counter, because an over-long
 * summary is a readability problem and blocking on it would teach AMs to delete sentences they
 * need rather than write better ones.
 */
export function notesBlockers(draft: NotesDraft): string[] {
  const blockers: string[] = [];

  if (!draft.summary.trim()) {
    blockers.push("Write the meeting summary. It is the part the next person actually reads.");
  }

  const brokenActions = draft.departments.flatMap((department) =>
    department.actions
      .filter((line) => actionLineIssues(line).some((issue) => !issue.includes("over ")))
      .map((line) => `${department.department}: ${line.what.trim() || "an unnamed action"}`),
  );
  if (brokenActions.length) {
    blockers.push(
      `${brokenActions.length === 1 ? "An action line is" : `${brokenActions.length} action lines are`} missing what, who or when — ${brokenActions.join("; ")}.`,
    );
  }

  const namelessClientAction = draft.clientActions.filter((item) => !item.what.trim()).length;
  if (namelessClientAction) {
    blockers.push("A client action has nothing written in it. Say what they are doing, or delete the line.");
  }

  const incompletePending = draft.pending.filter(
    (item) => !item.missing.trim() || !item.from.trim() || !item.reminderDate.trim(),
  ).length;
  if (incompletePending) {
    blockers.push(
      `${incompletePending === 1 ? "A pending item needs" : `${incompletePending} pending items need`} what is missing, who it is coming from, and when to chase.`,
    );
  }

  return blockers;
}
