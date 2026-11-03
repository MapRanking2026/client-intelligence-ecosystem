import { npsBand, riskRegisterRequired } from "@/src/lib/contracts/post-meeting-review";

/**
 * The gate the follow-through opens on: the account health score, and what caps it.
 *
 * The score is picked before anything is drafted, because almost everything downstream reads it.
 * A 6 or below adds the Risk Register row, the red-flag playbook and the Manager tag; the Health
 * Tracker row's Health field comes from it; the notes' first section quotes it. Drafting first and
 * scoring afterwards would mean rewriting the draft every time the AM moved the number.
 *
 * Three decisions are worth stating, because they are what the AM will argue with:
 *
 *  - **A red flag caps the score, it does not set it.** "Money came up" does not mean the account
 *    is an 8; it means it cannot be a 9 or a 10. The AM still picks. The cap is the ceiling a
 *    guideline puts on that pick, and the lowest cap found wins, because the flags compound.
 *  - **The cap is advisory, not enforced.** Scoring above it is allowed and warned about. An AM who
 *    was on the call knows things the transcript does not, and a gate that refuses their judgement
 *    gets worked around by picking the number that unlocks the button.
 *  - **A flag is only found when there is something to quote.** Every finding carries its evidence
 *    and, where the transcript has them, the timestamps it came from. A flag asserted with nothing
 *    behind it is a guess wearing a number, and it would quietly lower a real client's score.
 */

// ---------------------------------------------------------------------------
// The six red flags
// ---------------------------------------------------------------------------

export type RedFlagId =
  | "money"
  | "responsiveness"
  | "lifeChange"
  | "technical"
  | "otherAgency"
  | "performance";

export interface RedFlagRule {
  id: RedFlagId;
  /** The field's name in the Risk Register, so the two screens never disagree on wording. */
  label: string;
  /** The ceiling this flag puts on the score when it is found at its ordinary severity. */
  cap: number;
  /** What the AM should be listening for. Shown beside the flag while they check it. */
  hint: string;
  /**
   * The harsher ceiling, and what makes a case of this flag that much worse.
   *
   * Only three flags have one, and each is a specific thing said on the call rather than a feeling
   * about how bad it was -- so "severe" is a question the AM can answer yes or no to.
   */
  severe?: { cap: number; label: string };
}

/**
 * The six flags, in the order the guideline lists them -- which is also the order of the Risk
 * Register's own columns, so an AM checking them here fills that row top to bottom.
 */
export const RED_FLAGS: RedFlagRule[] = [
  {
    id: "money",
    label: "Money / Cash Flow",
    cap: 8,
    hint: "Price pushback, a payment they want to move, asking what they can cut, or the business being slow.",
  },
  {
    id: "responsiveness",
    label: "Responsiveness",
    cap: 5,
    hint: "Approvals and assets we chased, calls rescheduled, replies that took weeks.",
    severe: { cap: 3, label: "They went quiet on us entirely" },
  },
  {
    id: "lifeChange",
    label: "Life Change",
    cap: 7,
    hint: "Illness, a birth, a bereavement, a move, a partner leaving, selling the business.",
  },
  {
    id: "technical",
    label: "Technical Challenge",
    cap: 7,
    hint: "They cannot work the tools, the site, the CRM or the reports we give them.",
    severe: { cap: 4, label: "It is blocking the work we are billing for" },
  },
  {
    id: "otherAgency",
    label: "Other Agency / Advisor",
    cap: 7,
    hint: "Another agency, a consultant, or a friend 'who does marketing' in the conversation.",
    severe: { cap: 5, label: "They brought audit-style questions from them" },
  },
  {
    id: "performance",
    label: "Performance",
    cap: 4,
    hint: "Results below what they expected, leads drying up, 'I'm not seeing it'.",
    severe: { cap: 3, label: "They named a competitor or raised cancelling" },
  },
];

export function redFlagRule(id: RedFlagId): RedFlagRule | undefined {
  return RED_FLAGS.find((flag) => flag.id === id);
}

// ---------------------------------------------------------------------------
// What was found on this call
// ---------------------------------------------------------------------------

export interface RedFlagFinding {
  id: RedFlagId;
  found: boolean;
  /** What in the call says so, in the AM's reading language. Required for a found flag. */
  evidence?: string;
  /** Transcript timestamps, as they appear in the transcript ("12:04"), for the chips. */
  timestamps?: string[];
  /** Whether this case of the flag meets the rule's own `severe` condition. */
  severe?: boolean;
}

/** The cap one finding imposes, or null when the flag was not found. */
export function capForFinding(finding: RedFlagFinding): number | null {
  const rule = redFlagRule(finding.id);
  if (!rule || !finding.found) return null;
  return finding.severe && rule.severe ? rule.severe.cap : rule.cap;
}

export interface RecommendedCap {
  /** The ceiling, or null when nothing was found and the whole range is open. */
  cap: number | null;
  /** The flags that produced it -- every flag sitting at the cap, not only the first. */
  from: RedFlagId[];
  /** One sentence naming the cap and where it came from, for the chip beside the picker. */
  sentence: string;
}

/**
 * The recommended ceiling: the lowest cap among the flags that were found.
 *
 * Lowest wins rather than, say, an average, because each cap is a separate statement about what
 * this account cannot be. A client who is both unhappy with results and shopping other agencies is
 * not the mean of those two problems.
 */
export function recommendedCap(findings: RedFlagFinding[]): RecommendedCap {
  const caps = findings
    .map((finding) => ({ id: finding.id, cap: capForFinding(finding) }))
    .filter((row): row is { id: RedFlagId; cap: number } => row.cap !== null);

  if (!caps.length) {
    return {
      cap: null,
      from: [],
      sentence: "No red flags found on this call, so nothing caps the score.",
    };
  }

  const lowest = Math.min(...caps.map((row) => row.cap));
  const from = caps.filter((row) => row.cap === lowest).map((row) => row.id);
  const names = from.map((id) => redFlagRule(id)?.label || id);
  const joined =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  return {
    cap: lowest,
    from,
    sentence: `Recommended max ${lowest}/10 — ${joined} ${names.length === 1 ? "was" : "were"} found on this call.`,
  };
}

/**
 * The warning shown when the AM scores above the cap, or "" when they have not.
 *
 * Deliberately not a refusal. It names the flag so the AM can say why it does not apply here --
 * that sentence is what the justification is for, and it is worth more in the notes than a score
 * that was quietly forced down to clear a validation rule.
 */
export function aboveCapWarning(score: number | null, cap: RecommendedCap): string {
  if (score === null || cap.cap === null || score <= cap.cap) return "";
  const names = cap.from.map((id) => redFlagRule(id)?.label || id).join(", ");
  return `${score}/10 is above the recommended max of ${cap.cap} for ${names}. That is your call to make — say why in the justification, because this is the line a manager reads first.`;
}

// ---------------------------------------------------------------------------
// What a score commits the AM to
// ---------------------------------------------------------------------------

/** What a score of 6 or below adds to the follow-through, named before the AM confirms it. */
export function scoreObligations(score: number | null): string[] {
  if (!riskRegisterRequired(score)) return [];
  return [
    "A Risk Register row will be drafted for this client.",
    "The matching red-flag playbook will be added to the notes.",
    "The Manager will be @-tagged when the follow-through is processed.",
  ];
}

/** The band label and the one-line reading of it, for the chip under the picker. */
export function scoreBand(score: number | null): { label: string; detail: string } | null {
  if (score === null) return null;
  const label = npsBand(score);
  const detail =
    score >= 9
      ? "Nothing in the way. Worth asking for the testimonial or the referral."
      : score >= 7
        ? "Fundamentally fine, with something rubbing. Fix the friction before it becomes the story."
        : score >= 5
          ? "At risk. This is the month to act, not the month to watch."
          : score >= 3
            ? "Critical. Manager involved, and a plan with dates on it."
            : "Churn imminent. Assume they are deciding, and give them a reason not to.";
  return { label, detail };
}

// ---------------------------------------------------------------------------
// The justification
// ---------------------------------------------------------------------------

/**
 * The justification MTOS writes when there is no model answer for this score.
 *
 * Deliberately plain and short. It names the band, then the flags found, then stops -- it never
 * invents what the client said, because a justification is quoted in the notes and read by a
 * manager as a record of the call. An AM rewriting one sentence is a far better outcome than an
 * AM deleting a paragraph of invented detail.
 */
export function fallbackJustification(
  score: number | null,
  findings: RedFlagFinding[],
  clientName: string,
): string {
  if (score === null) {
    return `No score recorded for ${clientName} this month. Say here why the call did not support one.`;
  }

  const found = findings.filter((finding) => finding.found);
  const band = npsBand(score).toLowerCase();
  const opening = `${score}/10 — ${band}.`;

  if (!found.length) {
    return `${opening} Nothing on this call flagged a risk to the account. Add the one thing that made it this score rather than a point either side.`;
  }

  const named = found
    .map((finding) => {
      const rule = redFlagRule(finding.id);
      const label = rule?.label || finding.id;
      return finding.evidence?.trim() ? `${label} (${finding.evidence.trim()})` : label;
    })
    .join("; ");

  return `${opening} Raised on this call: ${named}. Add what you took from it that the transcript does not show.`;
}

// ---------------------------------------------------------------------------
// The gate itself
// ---------------------------------------------------------------------------

export interface ScoreGateState {
  /** The score the AM has picked. undefined means they have not picked one yet. */
  score?: number | null;
  justification?: string;
  /** True once the AM has typed into the justification, so a score change keeps their wording. */
  justificationEdited?: boolean;
  findings?: RedFlagFinding[];
  /** The score MTOS suggested, kept so the notes can show where the AM moved it from. */
  suggested?: number;
  confirmedAt?: string;
}

/** Whether a score is one of the ten the picker offers. */
export function isScoreValue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
}

/**
 * What is stopping the AM confirming the score, in their own words.
 *
 * A list rather than a boolean so the screen and the server can refuse with the same sentences.
 * Being above the cap is not on it: that is a warning, by the rule at the top of this file.
 */
export function scoreGateBlockers(state: ScoreGateState): string[] {
  const blockers: string[] = [];

  if (state.score === undefined) {
    blockers.push("Pick the score. Everything below it is drafted from the number you choose.");
  } else if (!state.justification?.trim()) {
    blockers.push("Write the justification. One or two sentences in your own voice is enough.");
  }

  const unevidenced = (state.findings || []).filter(
    (finding) => finding.found && !finding.evidence?.trim(),
  );
  if (unevidenced.length) {
    const names = unevidenced.map((finding) => redFlagRule(finding.id)?.label || finding.id);
    blockers.push(
      `Say what was said for ${names.join(", ")}. A flag with nothing to quote lowers the score on a guess.`,
    );
  }

  return blockers;
}

/** Whether the score has been confirmed and the rest of the follow-through may be drafted. */
export function scoreConfirmed(state: ScoreGateState | undefined): boolean {
  return Boolean(state?.confirmedAt && state.score !== undefined);
}
