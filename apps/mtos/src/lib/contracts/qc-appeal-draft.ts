import {
  isGraded,
  type QcAppealItem,
  type QcCriterionNote,
  type QcScoreValue,
} from "@/src/lib/contracts/qc-record";
import { QC_RUBRIC } from "@/src/lib/contracts/qc-rubric";

/**
 * The AM's appeal form: which criteria can be appealed, and when the form may be sent.
 *
 * Pure, and the rules are deliberately strict in one direction only. An appeal is an AM telling a
 * reviewer something the recording could not show -- a promise handled by email before the call, a
 * client who asked to skip a topic, a segment someone else led. It costs a reviewer real time to
 * read, and an appeal with no specifics costs that time for nothing. So the form asks for enough
 * to act on and then gets out of the way.
 *
 * ## What it refuses, and why each refusal is kind
 *
 * **A criterion already at 5 cannot be appealed.** There is nothing above it. Offering the row
 * would invite an AM to fill in context that could not change anything.
 *
 * **A criterion marked N/A cannot be appealed either.** N/A is not a low score; it is a statement
 * that the criterion did not apply. Appealing it would be asking to be graded on something that
 * did not happen, and if the AM thinks it *did* apply, the thing to dispute is the N/A itself --
 * which the context field and the overall note both carry to the reviewer.
 *
 * **"Should be" must be above the current score.** An appeal asking for the same number or a lower
 * one is a mistake in the form, not a request.
 *
 * **Context must be more than a few characters.** Five is the handoff's bar. "Wrong" is not
 * something a reviewer can check, and an appeal a reviewer cannot check gets declined -- which is
 * a worse outcome for the AM than being stopped here.
 */

/** Context shorter than this is not something a reviewer can act on. */
export const MIN_CONTEXT_LENGTH = 5;

/** One row of the form, as the screen holds it while the AM fills it in. */
export interface QcAppealDraftEntry {
  /** The score being asked for. Pre-set to one above the current, which is the common case. */
  to: number;
  ctx: string;
  link?: string;
}

/** Keyed by criterion number, and only the criteria the AM has ticked are present. */
export type QcAppealDraft = Record<number, QcAppealDraftEntry | undefined>;

export interface QcAppealCandidate {
  n: number;
  name: string;
  /** The score as given. Always 1-4 here; see the file note on 5 and N/A. */
  current: 1 | 2 | 3 | 4;
  /** The scores that can be asked for: every value above the current one. */
  options: number[];
  /** What the reviewer wrote about this criterion, so the AM answers the actual finding. */
  found?: string;
}

/**
 * The criteria this touch's score allows an appeal on.
 *
 * Returns them in rubric order rather than worst-first. The AM is reading down their own
 * breakdown, and a form whose order does not match the list above it makes them hunt.
 */
export function appealCandidates(
  crit: readonly QcScoreValue[] | undefined,
  notes?: Record<number, QcCriterionNote> | undefined,
): QcAppealCandidate[] {
  const out: QcAppealCandidate[] = [];
  for (const criterion of QC_RUBRIC) {
    const value = crit?.[criterion.n - 1];
    if (!isGraded(value) || value >= 5) continue;
    const found = notes?.[criterion.n]?.found?.trim();
    out.push({
      n: criterion.n,
      name: criterion.name,
      current: value as 1 | 2 | 3 | 4,
      options: [1, 2, 3, 4, 5].filter((option) => option > value),
      ...(found ? { found } : {}),
    });
  }
  return out;
}

/** A fresh entry for a criterion the AM has just ticked: one point up, nothing written yet. */
export function newAppealEntry(current: number): QcAppealDraftEntry {
  return { to: Math.min(5, current + 1), ctx: "" };
}

/** The criterion numbers currently ticked, in rubric order. */
export function appealPicked(draft: QcAppealDraft): number[] {
  return Object.keys(draft)
    .map(Number)
    .filter((n) => Number.isInteger(n) && Boolean(draft[n]))
    .sort((a, b) => a - b);
}

/**
 * What stops this appeal being sent, in the AM's own words.
 *
 * A list rather than a boolean, so the hint under the button can say which of the three things is
 * missing instead of leaving the AM to guess why a disabled button is disabled.
 */
export function appealBlockers(
  draft: QcAppealDraft,
  candidates: readonly QcAppealCandidate[],
): string[] {
  const picked = appealPicked(draft);
  if (!picked.length) return ["Pick at least one criterion"];

  const blockers: string[] = [];
  const thin: number[] = [];
  const unmoved: number[] = [];
  for (const n of picked) {
    const entry = draft[n];
    const candidate = candidates.find((row) => row.n === n);
    if (!entry || !candidate) continue;
    if (!(entry.to > candidate.current)) unmoved.push(n);
    if (entry.ctx.trim().length <= MIN_CONTEXT_LENGTH) thin.push(n);
  }
  if (unmoved.length) {
    blockers.push(
      `Pick a higher score for ${unmoved.length === 1 ? `criterion ${unmoved[0]}` : `criteria ${unmoved.join(", ")}`}`,
    );
  }
  if (thin.length) {
    blockers.push(
      thin.length === picked.length
        ? "Add context for each criterion"
        : `Add context for ${thin.length === 1 ? `criterion ${thin[0]}` : `criteria ${thin.join(", ")}`}`,
    );
  }
  return blockers;
}

/** The line beside the send button: how many are selected, then what is still missing. */
export function appealHint(
  draft: QcAppealDraft,
  candidates: readonly QcAppealCandidate[],
): string {
  const picked = appealPicked(draft);
  const blockers = appealBlockers(draft, candidates);
  if (!picked.length) return blockers[0] || "Pick at least one criterion";
  const count = `${picked.length} selected`;
  return blockers.length ? `${count} · ${blockers.join(" · ")}` : count;
}

/**
 * Turn the form into the items that get stored.
 *
 * Trims everything, drops an empty link rather than storing "", and keeps rubric order. Only the
 * criteria that pass `appealBlockers` reach here -- the caller checks that first -- but this still
 * filters, because a stored appeal item with no context is one a reviewer cannot answer.
 */
export function toAppealItems(
  draft: QcAppealDraft,
  candidates: readonly QcAppealCandidate[],
): QcAppealItem[] {
  const out: QcAppealItem[] = [];
  for (const n of appealPicked(draft)) {
    const entry = draft[n];
    const candidate = candidates.find((row) => row.n === n);
    if (!entry || !candidate) continue;
    const ctx = entry.ctx.trim();
    if (ctx.length <= MIN_CONTEXT_LENGTH) continue;
    if (!(entry.to > candidate.current)) continue;
    const link = entry.link?.trim();
    out.push({ n, to: entry.to, ctx, ...(link ? { link } : {}) });
  }
  return out;
}

/** The copy at the top of the form. Kept here so the component holds no policy. */
export const APPEAL_INTRO =
  "Optional. Use it when QC didn't have the full picture — a promise handled by email before the call, a client who asked to skip a topic, a co-led segment. Pick the criteria, say what changes the score, and link proof if you have it.";

/**
 * Whether this touch can still be appealed at all.
 *
 * One appeal per touch (handoff §6.7). A second one would mean a reviewer answering the same
 * score twice, and the record carrying two "from" values with no way to say which came first.
 */
export function canAppeal(input: {
  hasAppeal: boolean;
  hasScore: boolean;
  isOwner: boolean;
}): boolean {
  return input.isOwner && input.hasScore && !input.hasAppeal;
}
