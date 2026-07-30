import { z } from "zod";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { MonthlyTouchRecord, QaReview } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getServerEnv } from "@/src/lib/server/env";
import { callClaudeForJson, getNowIso, hasAnyLlmProvider, stripUndefinedDeep } from "@/src/lib/server/services/mtos-ai";
import { getPromptText } from "@/src/lib/server/prompt-store";

export const QA_SCORECARD_CATEGORIES = [
  "Preparation and evidence use",
  "Wins delivered with business impact",
  "Risk transparency",
  "Client engagement (copilot, not audience)",
  "Commitment clarity and ownership",
  "Growth conversation quality",
  "Next-step clarity",
] as const;

const qaSchema = z.object({
  scorecard: z
    .array(
      z.object({
        category: z.string().min(1),
        score: z.number().min(1).max(5),
        notes: z.string().min(1),
      }),
    )
    .length(QA_SCORECARD_CATEGORIES.length),
  overallGrade: z.enum(["A", "B", "C", "D", "F"]),
  summary: z.string().min(1),
});

async function evaluateWithClaude(
  env: ReturnType<typeof getServerEnv>,
  touch: MonthlyTouchRecord,
  transcript: string,
) {
  // The category list stays in code because the response parser depends on it;
  // the engine's prompt receives it as a variable rather than restating it.
  const system = await getPromptText("qa_evaluation_prompt", {
    qa_scorecard_categories: QA_SCORECARD_CATEGORIES.join("; "),
  });

  const userText = [
    "Return a JSON object with keys: scorecard (array of {category, score, notes} for every category",
    "above, in the same order), overallGrade (A-F), summary.",
    "",
    JSON.stringify(
      {
        touchExecutiveBrief: touch.executiveBrief,
        transcript,
      },
      null,
      2,
    ),
  ].join("\n");

  return qaSchema.parse(await callClaudeForJson({ env, system, userText, maxTokens: 1400 }));
}

export async function generateQaReview(context: TenantContext, touchId: string) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before a QA review can run");
  }

  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }

  if (!touch.postMeeting?.transcript) {
    throw new Error("Run the post-meeting transcript analysis before generating a QA review");
  }

  const env = getServerEnv();
  if (!hasAnyLlmProvider(env)) {
    throw new Error("No AI provider is configured (set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY), so the QA review can't be generated.");
  }

  const evaluation = await evaluateWithClaude(env, touch, touch.postMeeting.transcript);

  const qaReview: QaReview = {
    status: "pending_victor_approval",
    scorecard: evaluation.scorecard,
    overallGrade: evaluation.overallGrade,
    summary: evaluation.summary,
    generatedAt: getNowIso(),
  };

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    qaReview,
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}

export async function recordVictorDecision(
  context: TenantContext,
  touchId: string,
  decision: "approved" | "changes_requested",
  note?: string,
) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before Victor's decision can be recorded");
  }

  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }

  if (!touch.qaReview || touch.qaReview.status !== "pending_victor_approval") {
    throw new Error("Generate the QA review before recording Victor's decision");
  }

  const qaReview: QaReview = {
    ...touch.qaReview,
    status: decision,
    victorDecisionAt: getNowIso(),
    victorNote: note,
  };

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    qaReview,
    status: decision === "approved" ? "Completed" : touch.status,
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}
