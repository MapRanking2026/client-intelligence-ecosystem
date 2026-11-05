/**
 * The QC rubric: the 17 things a Monthly Touch is scored on.
 *
 * ## This file is meant to be replaced
 *
 * The names and descriptions below are **placeholders**, taken from the prototype. Jessica's real
 * 17-point rubric is coming, and when it does this file is the only one that should need editing.
 * That is why it holds nothing but data: no scoring arithmetic, no screen copy, no Firestore. The
 * maths lives in `qc-record.ts` and reads this list by position, so changing a criterion's wording
 * cannot change anybody's score.
 *
 * Two things must hold when the real rubric arrives:
 *
 *  1. **There are still 17 criteria, numbered 1 to 17 in order.** The stored `crit` array is
 *     positional, and three KPIs are defined by position (1, 17, and the separate goal field).
 *     A rubric with a different length is a different data shape, not an edit to this file.
 *  2. **`QC_RUBRIC_VERSION` is bumped in the same commit.** Every QC record stores the version it
 *     was scored under. That is what lets a score from last quarter keep showing the labels it was
 *     actually graded against, instead of silently re-labelling old criterion 9 with new criterion
 *     9's name. Scores are shown back to the person who earned them; mislabelling one is worse
 *     than showing nothing.
 */

/** Bump this whenever a name, description, group or order below changes. */
export const QC_RUBRIC_VERSION = "placeholder-17-v1";

/** The six groups, in the order the criteria are shown in. */
export const QC_GROUPS = [
  "Before the call",
  "Opening",
  "The conversation",
  "Outcomes",
  "Close",
  "After the call",
] as const;

export type QcGroup = (typeof QC_GROUPS)[number];

/**
 * The three KPI labels.
 *
 * `Goal KPI` is the odd one out: criterion 11 carries the label, but the KPI itself is measured by
 * the separate `goal` field on the record (Yes / Partial / No / N/A), not by the 1-5 score. The two
 * are kept together here so the screen can show the chip in the right place.
 */
export type QcKpi = "Prep KPI" | "Goal KPI" | "Post-touch KPI";

export interface QcCriterion {
  /** 1-17. Also its position in the stored `crit` array, minus one. */
  n: number;
  name: string;
  description: string;
  group: QcGroup;
  kpi?: QcKpi;
}

export const QC_RUBRIC: QcCriterion[] = [
  {
    n: 1,
    name: "Meeting prep",
    description:
      "Prep page in the Client's Book before the call, open tickets and carry-overs checked, agenda emailed 1–3 days before.",
    group: "Before the call",
    kpi: "Prep KPI",
  },
  {
    n: 2,
    name: "Opening & agenda",
    description: "Warm start, purpose of the call, agenda read so the client knows what comes first.",
    group: "Opening",
  },
  {
    n: 3,
    name: "Recording consent & intros",
    description: "Asked to record; everyone on the call introduced with their role.",
    group: "Opening",
  },
  {
    n: 4,
    name: "Rapport & tone",
    description: "Personal, calm and confident; matched the client's energy.",
    group: "Opening",
  },
  {
    n: 5,
    name: "Owns open commitments",
    description: "Raised misses and late items before the client did, with a new date.",
    group: "The conversation",
  },
  {
    n: 6,
    name: "Results in business terms",
    description: "Calls, leads and jobs before rankings; numbers tied to what the client cares about.",
    group: "The conversation",
  },
  {
    n: 7,
    name: "Diagnosis before planning",
    description: "Asked how things work today before proposing a fix.",
    group: "The conversation",
  },
  {
    n: 8,
    name: "Listening first",
    description: "Let the client finish, summarised back, followed their thread.",
    group: "The conversation",
  },
  {
    n: 9,
    name: "Data accuracy",
    description: "Every number said on the call matches the brief and its sources.",
    group: "The conversation",
  },
  {
    n: 10,
    name: "Marketing content",
    description: "Story, praise or a filming yes captured — with consent asked.",
    group: "The conversation",
  },
  {
    n: 11,
    name: "Client goal",
    description: "A numeric goal for the month or quarter, agreed and documented.",
    group: "Outcomes",
    kpi: "Goal KPI",
  },
  {
    n: 12,
    name: "Ownership",
    description: 'Speaks as "we"; no blaming other teams, vendors or the client.',
    group: "Outcomes",
  },
  {
    n: 13,
    name: "Success in the client's words",
    description: "Knows and repeats what a good month means to this client.",
    group: "Outcomes",
  },
  {
    n: 14,
    name: "Honest picture",
    description: "No overpromising; risks and limits named plainly.",
    group: "Outcomes",
  },
  {
    n: 15,
    name: "Next steps with owners & dates",
    description: "Recap where every action has an owner and a date.",
    group: "Close",
  },
  {
    n: 16,
    name: "Time & next touch",
    description: "Kept to the planned length; next touch booked on the call.",
    group: "Close",
  },
  {
    n: 17,
    name: "Post-touch actions",
    description:
      "Notes in the Client's Book, one ticket per commitment, recap sent, Health Tracker updated — inside 24 h.",
    group: "After the call",
    kpi: "Post-touch KPI",
  },
];

/** How many criteria there are. Everything positional is written against this, never a literal 17. */
export const QC_CRITERION_COUNT = QC_RUBRIC.length;

/** The criteria of one group, in order. Used by the scoring screen's group cards. */
export function criteriaInGroup(group: QcGroup): QcCriterion[] {
  return QC_RUBRIC.filter((criterion) => criterion.group === group);
}

/**
 * One criterion by its number, or undefined.
 *
 * Undefined rather than a throw: a stored record may have been scored under a longer rubric, and a
 * history page that crashes on an old score is worse than one that shows the score without a label.
 */
export function criterionByNumber(n: number): QcCriterion | undefined {
  return QC_RUBRIC.find((criterion) => criterion.n === n);
}

/** The criterion numbers behind each scored KPI. The goal KPI is not here: it has its own field. */
export const QC_PREP_CRITERION = 1;
export const QC_POST_TOUCH_CRITERION = 17;
