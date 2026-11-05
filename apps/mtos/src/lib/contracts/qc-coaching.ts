import type { BriefProposal, PrepBrief } from "@/src/lib/contracts/prep-brief";
import {
  isGraded,
  type QcCriterionNote,
  type QcScoreValue,
  type TouchQc,
} from "@/src/lib/contracts/qc-record";
import { qcDateLabel as dateLabel } from "@/src/lib/contracts/qc-dates";
import { QC_RUBRIC, criterionByNumber } from "@/src/lib/contracts/qc-rubric";

/**
 * Closing the loop: the last QC score becomes the next call's coaching block (handoff §6.8).
 *
 * The Review step already has the right surface for this -- section 1's "Your focus for this call
 * (from your QCs)" with Use / Adapt / Skip on every item. Until now it was filled from whatever the
 * preparation model wrote, which in practice meant the QC tracker in Drive if anyone had kept it
 * up. This file fills it from the actual QC record instead, which is the one source that cannot
 * drift from what the reviewer really said.
 *
 * ## Proposals, never orders
 *
 * Every item here is a proposal with a stated exception, and the AM answers it. QC reads the call;
 * it does not read the sales promise, the client's history or what the owner said on the phone
 * last week. So "Idea · Why · How it could sound · Skip it when" is the whole shape, and
 * `whenToSkip` is never left empty -- a coaching idea with no stated exception is one an AM will
 * carry into a call where it is wrong.
 *
 * ## The ids have to be stable
 *
 * The AM's Use / Adapt / Skip answers are stored in `review.coaching`, keyed by proposal id. An id
 * derived from a random value or an array position would detach a decision from the item it was
 * made about the next time the page rendered, which would quietly show the AM a different answer
 * than the one they gave. So every id is built from the touch it came from and the criterion it is
 * about: the same QC always produces the same ids.
 */

/** Criterion 10 is Marketing content. Its findings are what the next call's questions come from. */
export const QC_CONTENT_CRITERION = 10;

/** How many lowest-scoring criteria become proposals. More than this is a reading list. */
export const LOWEST_COUNT = 3;

/** A criterion at or below this was not done well enough to leave alone next month. */
export const LOW_SCORE_AT_OR_BELOW = 3;

export interface QcCoachingSource {
  touchId: string;
  client: string;
  dateLabel: string;
  score?: number;
  rating?: string;
  /** True when this QC is from the same client as the touch being prepared. */
  sameClient: boolean;
}

export interface QcBriefCoaching {
  source: QcCoachingSource;
  /** The reviewer's own coaching plan, as proposals. Replaces whatever the model wrote. */
  focus: BriefProposal[];
  /** The lowest criteria and the content findings, as proposals the AM answers. */
  proposals: BriefProposal[];
  /** Said on the screen so the AM knows which call this came from. */
  note: string;
}

/** Where a proposal came from, said in full, for someone who was not on that call. */
function provenance(source: QcCoachingSource): string {
  const scored = typeof source.score === "number" ? `, scored ${source.score}` : "";
  return `From your QC of ${source.client} on ${source.dateLabel}${scored}`;
}

/**
 * The three lowest graded criteria, worst first.
 *
 * N/A is skipped -- a criterion that did not apply is not a weakness. Ties break on the lower
 * criterion number so the same QC always yields the same list in the same order, which the stable
 * ids above depend on.
 */
export function lowestCriteria(
  crit: readonly QcScoreValue[] | undefined,
  count = LOWEST_COUNT,
): { n: number; name: string; value: number }[] {
  const rows: { n: number; name: string; value: number }[] = [];
  for (const criterion of QC_RUBRIC) {
    const value = crit?.[criterion.n - 1];
    if (!isGraded(value)) continue;
    rows.push({ n: criterion.n, name: criterion.name, value });
  }
  rows.sort((a, b) => a.value - b.value || a.n - b.n);
  return rows.slice(0, count);
}

function noteOf(
  notes: Record<number, QcCriterionNote> | undefined,
  n: number,
): { found: string; next: string } {
  const note = notes?.[n];
  return { found: note?.found?.trim() || "", next: note?.next?.trim() || "" };
}

/**
 * Turn a submitted QC into the next call's coaching block.
 *
 * Returns undefined when the record has nothing to say -- no criteria and no coaching plan. The
 * review then keeps whatever source it had, which is the handoff's own fallback rule.
 */
export function qcToBriefCoaching(input: {
  touchId: string;
  client: string;
  date?: string;
  sameClient: boolean;
  qc: Pick<TouchQc, "crit" | "notes" | "coaching" | "focus" | "score" | "rating">;
}): QcBriefCoaching | undefined {
  const { qc } = input;
  const hasCoaching = Boolean(qc.coaching?.some((item) => item.idea.trim()));
  const hasCrit = Boolean(qc.crit?.length);
  if (!hasCoaching && !hasCrit) return undefined;

  const source: QcCoachingSource = {
    touchId: input.touchId,
    client: input.client,
    dateLabel: dateLabel(input.date),
    ...(typeof qc.score === "number" ? { score: qc.score } : {}),
    ...(qc.rating ? { rating: qc.rating } : {}),
    sameClient: input.sameClient,
  };
  const from = provenance(source);

  const focus: BriefProposal[] = (qc.coaching || [])
    .filter((item) => item.idea.trim())
    .map((item, index) => ({
      id: `qc-${input.touchId}-coaching-${index}`,
      idea: item.idea.trim(),
      // The reviewer's "why" already names the call and the moment. `from` is appended so the item
      // still says where it came from when the reviewer wrote a short one.
      why: item.why.trim() ? `${item.why.trim()} (${from}.)` : `${from}.`,
      howItCouldSound: item.how.trim(),
      whenToSkip:
        item.skip.trim() ||
        "Skip it if this client has already moved on from that, or the call has to go somewhere else first.",
    }));

  const proposals: BriefProposal[] = [];

  // The content criterion gets its own proposal, ahead of the generic lowest list: the handoff
  // calls it out separately because next month's questions are drafted from it.
  const content = noteOf(qc.notes, QC_CONTENT_CRITERION);
  const contentValue = qc.crit?.[QC_CONTENT_CRITERION - 1];
  const contentName = criterionByNumber(QC_CONTENT_CRITERION)?.name || "Marketing content";
  if (content.found || content.next) {
    proposals.push({
      id: `qc-${input.touchId}-content`,
      idea: content.next || `Plan one ${contentName.toLowerCase()} moment for this call`,
      why: content.found
        ? `${content.found} ${from}, ${contentName.toLowerCase()} scored ${isGraded(contentValue) ? contentValue : "N/A"}.`
        : `${from}, ${contentName.toLowerCase()} scored ${isGraded(contentValue) ? contentValue : "N/A"}.`,
      howItCouldSound: "",
      whenToSkip:
        "Skip it if the client opens with a problem — deal with that first and come back to it only if there is room.",
    });
  }

  for (const low of lowestCriteria(qc.crit)) {
    if (low.n === QC_CONTENT_CRITERION && proposals.length) continue;
    if (low.value > LOW_SCORE_AT_OR_BELOW) continue;
    const note = noteOf(qc.notes, low.n);
    proposals.push({
      id: `qc-${input.touchId}-low-${low.n}`,
      idea: note.next || `Work on ${low.name.toLowerCase()} on this call`,
      why: note.found
        ? `${note.found} ${from}, ${low.name.toLowerCase()} scored ${low.value} out of 5.`
        : `${from}, ${low.name.toLowerCase()} scored ${low.value} out of 5. ${criterionByNumber(low.n)?.description || ""}`.trim(),
      howItCouldSound: "",
      whenToSkip: "Skip it if it does not fit this client's situation this month.",
    });
  }

  const where = input.sameClient ? "this client" : input.client;
  return {
    source,
    focus,
    proposals,
    note: `From your last QC of ${where} (${source.dateLabel}). Proposals, not orders — you decide which fit this call.`,
  };
}

/**
 * Put the QC's coaching into the brief the Review screen renders.
 *
 * `focus` is **replaced** when the QC has a coaching plan, because that is the handoff's rule: the
 * reviewer's plan is the authority on what this AM is working on, and keeping the model's version
 * beside it would show the AM two different answers to the same question. When the QC has no
 * coaching plan the existing source stands, untouched.
 *
 * `proposals` are **prepended** rather than replaced. The brief's own proposals are this client's
 * content and strategy ideas, which is a different question from how the last call went -- dropping
 * them would lose work rather than replace it. QC's go first because they are about something that
 * already happened.
 */
export function mergeQcIntoBrief(
  brief: PrepBrief,
  coaching: QcBriefCoaching | undefined,
): PrepBrief {
  if (!coaching) return brief;
  const existing = new Set(brief.proposals.map((item) => item.idea.trim().toLowerCase()));
  const added = coaching.proposals.filter((item) => !existing.has(item.idea.trim().toLowerCase()));
  return {
    ...brief,
    focus: coaching.focus.length ? coaching.focus : brief.focus,
    proposals: [...added, ...brief.proposals],
  };
}
