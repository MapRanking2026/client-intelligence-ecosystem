import { z } from "zod";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import { QC_RUBRIC } from "@/src/lib/contracts/qc-rubric";
import {
  type CoachingItem,
  type QcAiPreread,
  type QcEvidenceRow,
  type QcGoal,
  type QcScoreValue,
} from "@/src/lib/contracts/qc-record";
import { renderNotesMarkdown } from "@/src/lib/contracts/follow-through-notes";
import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getServerEnv } from "@/src/lib/server/env";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { callLlmForJson, getNowIso, hasAnyLlmProvider } from "@/src/lib/server/services/mtos-ai";
import { readTouchTranscriptPayload } from "@/src/lib/server/services/transcript-watch-service";

/**
 * The AI pre-read: a suggested score and a reason for each of the 17 criteria.
 *
 * ## It suggests. The reviewer scores.
 *
 * Nothing this writes is a score. It lands in `touch.qc.ai`, which the scoring screen shows as
 * dashed "AI suggests 4" chips the reviewer can accept one at a time, and it never touches
 * `touch.qc.crit`. The distinction is the whole design: a QC score goes into somebody's record and
 * is argued about in appeals, so a human has to have decided it. A pre-read that silently became
 * the score would be a performance review written by a model, and the appeal process would be an
 * argument with nobody.
 *
 * ## Every suggestion carries where it came from
 *
 * `evidence[n]` is one line per criterion -- a timestamp and what happened, or a fact from the
 * follow-through -- and a suggestion with no evidence line is dropped rather than shown. A score
 * the reviewer cannot check is a score they have to either take on faith or re-derive from
 * scratch, and both are worse than no suggestion at all.
 *
 * ## No LLM, no pre-read, said plainly
 *
 * When no provider is configured, the call fails, or there is no transcript, nothing is written and
 * the screen says "No AI pre-read for this call — grade from the transcript." This never blocks
 * QC: the queue works, the scoring screen works, and the reviewer grades from the sources in the
 * sidebar as they would have done anyway.
 */

const prereadSchema = z.object({
  crit: z.array(z.union([z.number(), z.null()])).optional(),
  evidence: z.array(z.string()).optional(),
  goal: z.string().optional(),
  strengths: z.string().optional(),
  focus: z.string().optional(),
  coaching: z
    .array(
      z.object({
        idea: z.string().optional(),
        why: z.string().optional(),
        how: z.string().optional(),
        skip: z.string().optional(),
      }),
    )
    .optional(),
});

const GOALS: QcGoal[] = ["Yes", "Partial", "No", "N/A"];

/** 1-5, or null for N/A. Anything else -- 0, 6, a string, a decimal -- becomes null. */
function toScore(value: unknown): QcScoreValue {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > 5) return null;
  return value as QcScoreValue;
}

/**
 * Keep only the suggestions that came with a reason.
 *
 * A criterion whose evidence line is blank has its suggestion removed too, so the screen shows no
 * chip rather than a number the reviewer cannot trace.
 */
function pairUp(
  crit: unknown[] | undefined,
  evidence: string[] | undefined,
): { crit: QcScoreValue[]; evidence: string[] } {
  const outCrit: QcScoreValue[] = [];
  const outEvidence: string[] = [];
  for (let index = 0; index < QC_RUBRIC.length; index += 1) {
    const line = (evidence?.[index] || "").trim();
    const score = toScore(crit?.[index]);
    if (!line) {
      outCrit.push(null);
      outEvidence.push("");
      continue;
    }
    outCrit.push(score);
    outEvidence.push(line);
  }
  return { crit: outCrit, evidence: outEvidence };
}

/** At most three, each needing an idea and a why. A coaching item with no reason is not advice. */
function cleanCoaching(items: z.infer<typeof prereadSchema>["coaching"]): CoachingItem[] {
  return (items || [])
    .map((item) => ({
      idea: (item.idea || "").trim(),
      why: (item.why || "").trim(),
      how: (item.how || "").trim(),
      skip: (item.skip || "").trim(),
    }))
    .filter((item) => item.idea && item.why)
    .slice(0, 3);
}

export type QcPrereadOutcome =
  | { status: "written"; ai: QcAiPreread }
  | { status: "skipped"; reason: string };

/**
 * Generate the pre-read for one touch and store it.
 *
 * Returns why it did nothing rather than throwing, because every caller is a background task whose
 * failure must not affect the thing that triggered it. The reason is logged, not shown: the screen
 * shows the absence of a pre-read, which is all a reviewer needs to know.
 *
 * Idempotent in the way that matters: it refuses to overwrite a pre-read that already exists, and
 * it refuses to run at all once the touch has been scored. A model's opinion arriving after the
 * reviewer has finished would change the chips under a score already submitted.
 */
export async function generateQcPreread(
  context: TenantContext,
  touchId: string,
): Promise<QcPrereadOutcome> {
  const env = getServerEnv();
  if (!hasAnyLlmProvider(env)) {
    return { status: "skipped", reason: "No language-model provider is configured." };
  }

  const db = getFirebaseAdminDb();
  if (!db) return { status: "skipped", reason: "No database connection." };

  const source = getMtosDataSource(context);
  const touch = await source.getMonthlyTouchById(touchId);
  if (!touch) return { status: "skipped", reason: "The touch could not be read." };
  if (!touch.qc) return { status: "skipped", reason: "This touch is not with QC." };
  if (touch.qc.ai) return { status: "skipped", reason: "A pre-read already exists." };
  if (touch.qc.score !== undefined) {
    return { status: "skipped", reason: "The touch has already been scored." };
  }

  const transcript = await readTouchTranscriptPayload(context, touchId);
  if (!transcript) {
    return { status: "skipped", reason: "There is no transcript for this call." };
  }

  const client = await source.getClientById(touch.clientId);

  const system = [
    "You pre-read a recorded client call for a QC specialist at a local-SEO agency, who will then",
    "score it against a 17-point rubric. You are preparing their work, not doing it.",
    "",
    "Hard rules, in order of importance:",
    "- Invent nothing. Every timestamp, quote, number and name must come from the transcript or",
    "  the follow-through evidence you are given. A plausible timestamp is worse than none: the",
    "  reviewer will click it, find nothing there, and stop trusting every other line.",
    "- One evidence line per criterion, formatted `hh:mm:ss — what happened`, or a plain fact from",
    "  the follow-through evidence for the criteria about prep and post-touch actions.",
    "- If the transcript does not show you enough to judge a criterion, return null for its score",
    "  AND an empty string for its evidence. Do not guess, and do not pad the line.",
    "- Score 5 model, 4 solid, 3 acceptable, 2 below standard, 1 missing. Use null for a criterion",
    "  that genuinely did not apply to this call, not for one you could not assess.",
    "- Write in plain English, short sentences, for a reader who was not on the call. Many readers",
    "  read English as a second language. No internal codes, no rubric jargon, no criterion numbers",
    "  inside the prose.",
    "- Coaching items are proposals the account manager may decline. Each one needs a reason that",
    "  names the moment and what it cost, and a situation where it should be skipped.",
  ].join("\n");

  const userText = [
    "Return a JSON object with exactly these keys:",
    `  crit: an array of ${QC_RUBRIC.length} values, in criterion order, each 1-5 or null.`,
    `  evidence: an array of ${QC_RUBRIC.length} strings, in the same order. "" where you have none.`,
    "  goal: one of Yes / Partial / No / N/A — whether a numeric goal was agreed AND documented.",
    "    Yes needs a number and a time frame. Mentioned without a number is Partial.",
    "  strengths: two or three sentences on what the account manager did well.",
    "  focus: one or two sentences on what to work on, naming the moments.",
    "  coaching: at most 3 items { idea, why, how, skip }, drawn from the lowest scores.",
    "",
    "The criteria, in order:",
    ...QC_RUBRIC.map((criterion) => `  ${criterion.n}. ${criterion.name} — ${criterion.description}`),
    "",
    "Follow-through evidence, gathered when the account manager finished their post-call work:",
    ...(touch.qc.evidence || []).map(
      (row: QcEvidenceRow) => `  ${row.ok ? "done" : "NOT DONE"} · ${row.label}: ${row.detail}`,
    ),
    "",
    JSON.stringify({
      client: { name: client?.name, industry: client?.industry },
      callLengthMinutes: touch.qc.callLengthMin,
      ticketsCreated: touch.qc.tickets,
      approvedBrief: briefText(touch),
      postTouchNotes: touch.followThrough?.notes ? renderNotesMarkdown(touch.followThrough.notes) : undefined,
    }),
    "",
    "Transcript:",
    transcript,
  ].join("\n");

  let data: Record<string, unknown>;
  let model: string;
  try {
    const answer = await callLlmForJson({ env, system, userText, maxTokens: 4000 });
    data = answer.data;
    model = answer.model;
  } catch (error) {
    return {
      status: "skipped",
      reason: `The pre-read call failed: ${error instanceof Error ? error.message : "unknown error"}.`,
    };
  }

  const parsed = prereadSchema.safeParse(data);
  if (!parsed.success) {
    return { status: "skipped", reason: "The pre-read came back in a shape we could not read." };
  }

  const { crit, evidence } = pairUp(parsed.data.crit, parsed.data.evidence);
  if (!evidence.some((line) => line)) {
    // Nothing traceable came back, which is the same situation as no pre-read at all. Writing an
    // empty one would put "AI pre-read ready" on the queue row for a record that helps nobody.
    return { status: "skipped", reason: "The pre-read returned no usable evidence." };
  }

  const goal = GOALS.includes((parsed.data.goal || "") as QcGoal)
    ? ((parsed.data.goal || "") as QcGoal)
    : "N/A";

  const ai: QcAiPreread = {
    crit,
    evidence,
    goal,
    strengths: (parsed.data.strengths || "").trim(),
    focus: (parsed.data.focus || "").trim(),
    coaching: cleanCoaching(parsed.data.coaching),
    generatedAt: getNowIso(),
    model,
  };

  // One field, and only if nothing has been written there since we read it. The condition matters:
  // a reviewer may have opened the touch and started scoring while the model was still answering.
  await db.runTransaction(async (tx) => {
    const ref = db.doc(monthlyTouchPath(context.tenantId, touchId));
    const snapshot = await tx.get(ref);
    const current = snapshot.data() as Partial<MonthlyTouchRecord> | undefined;
    if (!current?.qc || current.qc.ai || current.qc.score !== undefined) return;
    tx.set(ref, { qc: { ...current.qc, ai } }, { mergeFields: ["qc"] });
  });

  return { status: "written", ai };
}

/** The approved brief as plain text, or undefined. The pre-read checks numbers said on the call
 *  against it, so a touch with no readable brief simply has criterion 9 judged without one. */
function briefText(touch: MonthlyTouchRecord): string | undefined {
  const brief = touch.executiveBrief?.trim();
  return brief || undefined;
}
