import { z } from "zod";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";
import {
  RED_FLAGS,
  fallbackJustification,
  isScoreValue,
  recommendedCap,
  redFlagRule,
  scoreGateBlockers,
  type RedFlagFinding,
  type RedFlagId,
  type ScoreGateState,
} from "@/src/lib/contracts/follow-through-score";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getServerEnv } from "@/src/lib/server/env";
import { getPromptText } from "@/src/lib/server/prompt-store";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { callLlmForJson, getNowIso, hasAnyLlmProvider } from "@/src/lib/server/services/mtos-ai";
import { readTouchTranscriptPayload } from "@/src/lib/server/services/transcript-watch-service";

/**
 * Reading the call for the six red flags, so the AM scores against evidence rather than a mood.
 *
 * Narrower on purpose than the client intelligence step beside it. That one answers Yes or No to
 * the same six signals for the Risk Register row, and that answer is all the register needs. The
 * gate needs more: what in the call says so, where in the call it was said, and whether this case
 * of the flag is the harsher one -- because those three things are what an AM argues with, and a
 * cap nobody can see the reason for is a cap that gets ignored.
 *
 * Every finding is a draft. The AM ticks, unticks, rewrites the evidence and picks the score; this
 * service never records one. Nothing here writes outside the touch document.
 */

const FLAG_IDS = RED_FLAGS.map((flag) => flag.id) as [RedFlagId, ...RedFlagId[]];

const findingSchema = z.object({
  id: z.enum(FLAG_IDS),
  found: z.boolean(),
  evidence: z.string().optional(),
  timestamps: z.array(z.string()).optional(),
  severe: z.boolean().optional(),
});

const analysisSchema = z.object({
  findings: z.array(findingSchema).max(6),
  suggestedScore: z.number().int().min(1).max(10).nullable().optional(),
  justificationsByScore: z.record(z.string(), z.string()).optional(),
});

export interface ScoreGateAnalysis {
  findings: RedFlagFinding[];
  suggested?: number;
  /** One justification per score the AM might pick, keyed "1".."10". */
  justifications: Record<string, string>;
  /** Named when the analysis came from somewhere other than a model read of the transcript. */
  note?: string;
}

/**
 * A timestamp as the transcript writes them -- "12:04" or "1:02:17".
 *
 * Anything else is dropped rather than shown. A chip that does not point at a moment in the
 * recording is worse than no chip: the AM clicks it expecting the quote and finds nothing.
 */
function cleanTimestamps(values: string[] | undefined): string[] {
  return (values || [])
    .map((value) => value.trim())
    .filter((value) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(value))
    .slice(0, 4);
}

/** Every flag, in the guideline's order, with whatever the read found for it. */
function completeFindings(partial: RedFlagFinding[]): RedFlagFinding[] {
  return RED_FLAGS.map((rule) => {
    const match = partial.find((finding) => finding.id === rule.id);
    if (!match?.found) {
      return { id: rule.id, found: false };
    }
    const timestamps = cleanTimestamps(match.timestamps);
    return {
      id: rule.id,
      found: true,
      ...(match.evidence?.trim() ? { evidence: match.evidence.trim() } : {}),
      ...(timestamps.length ? { timestamps } : {}),
      // Severity can only mean the harsher case on a rule that has one; a model marking
      // "Money, severe" would otherwise read as a cap that does not exist.
      ...(match.severe && rule.severe ? { severe: true } : {}),
    };
  });
}

/**
 * What the red-flag check falls back to when no model answered.
 *
 * It reuses the Yes/No the client intelligence step already recorded for the same six signals, so
 * the AM is not handed a blank sheet when the Risk Register already says Money is a Yes. What it
 * cannot do is supply the evidence -- that came from a read it did not make -- so each flag it
 * carries forward arrives unevidenced and the gate asks the AM to say what was said. That is the
 * honest outcome: the check is marked, and the sentence behind it is still owed.
 */
function findingsFromIntelligence(touch: MonthlyTouchRecord): {
  findings: RedFlagFinding[];
  note: string;
} {
  const entry = touch.postMeeting?.clientIntelligence?.riskRegister;
  const answered = (value: unknown) => typeof value === "string" && value.trim().toLowerCase() === "yes";
  const findings = completeFindings(
    entry
      ? RED_FLAGS.filter((rule) => answered(entry[rule.id])).map((rule) => ({
          id: rule.id,
          found: true,
        }))
      : [],
  );

  return {
    findings,
    note: entry
      ? "No AI provider answered, so the red flags below are the ones already recorded for the Risk Register. Add what was said for each before you confirm."
      : "No AI provider answered and nothing has been recorded for this client yet, so the red-flag check starts empty. Tick what came up on the call.",
  };
}

/**
 * Read the transcript for the six flags and a suggested score.
 *
 * Returns a draft for the AM, never a decision. A failure to reach a model is not an error here:
 * the gate still has to open, so it falls back and says in `note` what it fell back to.
 */
export async function analyzeScoreGate(
  context: TenantContext,
  touchId: string,
): Promise<ScoreGateAnalysis> {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  const client = await dataSource.getClientById(touch.clientId);
  const clientName = client?.name || "this client";

  const env = getServerEnv();
  const transcript = await readTouchTranscriptPayload(context, touchId);

  if (!transcript) {
    const { findings, note } = findingsFromIntelligence(touch);
    return {
      findings,
      justifications: {},
      note: "There is no transcript on this touch yet, so nothing has been read from the call. Tick what you remember and say what was said. " + note,
    };
  }

  if (!hasAnyLlmProvider(env)) {
    const { findings, note } = findingsFromIntelligence(touch);
    return { findings, justifications: {}, note };
  }

  // The flag list and the ceiling each flag puts on the score stay in code because the parser and
  // the score cap are built from them; the engine's prompt receives them as a variable rather than
  // restating them, so changing a flag cannot leave the prompt describing the old one.
  const system = await getPromptText("retention_red_flags_prompt", {
    red_flags: RED_FLAGS.map((rule) => {
      const severe = rule.severe ? ` Harsher case -- ${rule.severe.label} -- ceiling ${rule.severe.cap}.` : "";
      return `  ${rule.id} (${rule.label}): ${rule.hint} Ceiling ${rule.cap}.${severe}`;
    }).join("\n"),
  });

  const userText = [
    // Evidence only. The answer's keys, the six flags with their ceilings and the bands are the
    // engine row's contract, resolved above.
    `Client: ${clientName}.`,
    "",
    "Transcript:",
    transcript,
  ].join("\n");

  const { data } = await callLlmForJson({ env, system, userText, maxTokens: 4000 });
  const parsed = analysisSchema.safeParse(data);
  if (!parsed.success) {
    const { findings, note } = findingsFromIntelligence(touch);
    return {
      findings,
      justifications: {},
      note: `The transcript read came back in a shape MTOS could not use (${parsed.error.issues[0]?.message || "unexpected fields"}). ${note}`,
    };
  }

  const justifications: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.data.justificationsByScore || {})) {
    const score = Number(key);
    if (isScoreValue(score) && typeof value === "string" && value.trim()) {
      justifications[String(score)] = value.trim();
    }
  }

  return {
    findings: completeFindings(parsed.data.findings),
    ...(isScoreValue(parsed.data.suggestedScore) ? { suggested: parsed.data.suggestedScore } : {}),
    justifications,
  };
}

/**
 * The justification to show for a score.
 *
 * The model's line for that exact score when it wrote one, and MTOS's own plain sentence when it
 * did not -- so moving the picker always lands on wording about THIS call rather than a blank box
 * or, worse, the sentence that was written for a different number.
 */
export function justificationForScore(
  score: number | null,
  analysis: Pick<ScoreGateAnalysis, "justifications" | "findings">,
  clientName: string,
): string {
  if (score !== null) {
    const written = analysis.justifications[String(score)];
    if (written?.trim()) return written.trim();
  }
  return fallbackJustification(score, analysis.findings, clientName);
}

// ---------------------------------------------------------------------------
// Storing what the AM decided
// ---------------------------------------------------------------------------

async function persist(context: TenantContext, touchId: string, state: ScoreGateState) {
  const db = getFirebaseAdminDb();
  if (db) {
    // `mergeFields` on the one nested field: the follow-through document also carries the
    // deadline and, later, every drafted item, and a whole-document merge from here would write
    // back whatever this request happened to have read.
    await db.doc(monthlyTouchPath(context.tenantId, touchId)).set(
      { followThrough: { score: state } },
      { mergeFields: ["followThrough.score"] },
    );
  }
  return state;
}

/** Save the gate as the AM leaves it, without confirming it. */
export async function saveScoreGate(
  context: TenantContext,
  touchId: string,
  patch: ScoreGateState,
): Promise<ScoreGateState> {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  const previous = touch.followThrough?.score || {};
  // A confirmed gate stays confirmed through an edit. Re-opening it is what `reopenScoreGate` is
  // for, and it is a decision with consequences -- the drafts below were written from this score.
  return persist(context, touchId, { ...previous, ...patch });
}

export class ScoreGateIncompleteError extends Error {
  readonly blockers: string[];
  constructor(blockers: string[]) {
    super(blockers.join(" "));
    this.name = "ScoreGateIncompleteError";
    this.blockers = blockers;
  }
}

/**
 * Confirm the score, which opens the rest of the follow-through.
 *
 * Checked here against the same rules the screen checks, because the screen's copy of them can be
 * bypassed and this one cannot. Scoring above the recommended cap is explicitly not a refusal --
 * see the note at the top of the contract.
 */
export async function confirmScoreGate(
  context: TenantContext,
  touchId: string,
  patch: ScoreGateState,
): Promise<ScoreGateState> {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }

  const state: ScoreGateState = { ...(touch.followThrough?.score || {}), ...patch };
  const blockers = scoreGateBlockers(state);
  if (blockers.length) {
    throw new ScoreGateIncompleteError(blockers);
  }

  return persist(context, touchId, { ...state, confirmedAt: getNowIso() });
}

/** Re-open a confirmed gate so the score can be changed. */
export async function reopenScoreGate(
  context: TenantContext,
  touchId: string,
): Promise<ScoreGateState> {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  const { confirmedAt: _dropped, ...rest } = touch.followThrough?.score || {};
  void _dropped;
  return persist(context, touchId, rest);
}

/** The cap sentence for a stored gate, for screens that only hold the record. */
export function storedCap(state: ScoreGateState | undefined) {
  return recommendedCap(state?.findings || []);
}

/** The flag's own label, for a screen that holds an id and no rules. */
export function flagLabel(id: RedFlagId): string {
  return redFlagRule(id)?.label || id;
}
