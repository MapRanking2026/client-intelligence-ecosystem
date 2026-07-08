import { z } from "zod";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { CallGuide, CallGuideSection, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getServerEnv } from "@/src/lib/server/env";
import { callClaudeForJson, getNowIso, stripUndefinedDeep } from "@/src/lib/server/services/mtos-ai";
import { getPrompt } from "@/src/lib/server/prompt-store";

const callGuideSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(1),
        minutes: z.number().min(1).max(30),
        talkingPoints: z.array(z.string().min(1)).min(1).max(5),
        clientPrompts: z.array(z.string().min(1)).min(1).max(3),
      }),
    )
    .min(4)
    .max(7),
});

/**
 * Deterministic fallback: turns the already-prepared agenda into a timed
 * structure so an AM always has a usable call guide even if Claude is
 * unavailable. Real wins/risks/talking points feed the cues, nothing invented.
 */
function buildDeterministicSections(touch: MonthlyTouchRecord): CallGuideSection[] {
  const segments = touch.agenda.length ? touch.agenda : ["Open the call and confirm the agenda"];
  const minutesPerSection = Math.max(Math.floor(60 / segments.length), 5);

  return segments.map((title, index) => {
    const talkingPoints =
      index === 0
        ? touch.wins.slice(0, 2).length
          ? touch.wins.slice(0, 2)
          : ["Open with the current account health picture."]
        : touch.talkingPoints.slice(index - 1, index + 1).length
          ? touch.talkingPoints.slice(index - 1, index + 1)
          : touch.risks.slice(0, 1);

    return {
      title,
      minutes: minutesPerSection,
      talkingPoints: talkingPoints.length ? talkingPoints : ["Keep the conversation evidence-first."],
      clientPrompts: ["What's your read on this so far?"],
    };
  });
}

async function generateClaudeSections(
  env: ReturnType<typeof getServerEnv>,
  touch: MonthlyTouchRecord,
): Promise<CallGuideSection[] | null> {
  if (!env.anthropicApiKey) {
    return null;
  }

  const system = await getPrompt(
    "growth_review_structure_prompt",
    [
      "You turn an already-prepared Growth Pilot monthly touch prep pack into a live, timed call guide",
      "for the Account Manager to follow during the meeting.",
      "",
      "The AM acts as a business-growth coach, not a report reader. The client is an active co-pilot in",
      "the room. Every section must include at least one client prompt -- a genuine question that pulls",
      "the client into the conversation instead of talking at them.",
      "",
      "Sections must sum to roughly 60 minutes. Use ONLY the wins, risks, talking points, and agenda",
      "already in the prep pack below -- never invent a metric, win, or risk that isn't already there.",
      "",
      "Return JSON only.",
    ].join("\n"),
  );

  const userText = [
    "Return a JSON object with a single key: sections.",
    "Each section needs: title, minutes (integer), talkingPoints (array of strings), clientPrompts (array of strings).",
    "",
    JSON.stringify(
      {
        agenda: touch.agenda,
        wins: touch.wins,
        risks: touch.risks,
        talkingPoints: touch.talkingPoints,
        executiveBrief: touch.executiveBrief,
      },
      null,
      2,
    ),
  ].join("\n");

  const parsed = callGuideSchema.parse(await callClaudeForJson({ env, system, userText, maxTokens: 1200 }));
  return parsed.sections;
}

export async function generateLiveCallGuide(context: TenantContext, touchId: string) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before the call guide can be generated");
  }

  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }

  const env = getServerEnv();
  const deterministicSections = buildDeterministicSections(touch);

  let callGuide: CallGuide = {
    status: "generated",
    source: "deterministic",
    sections: deterministicSections,
    generatedAt: getNowIso(),
  };

  try {
    const claudeSections = await generateClaudeSections(env, touch);
    if (claudeSections) {
      callGuide = {
        status: "generated",
        source: "claude",
        sections: claudeSections,
        generatedAt: getNowIso(),
        model: env.anthropicModel,
      };
    }
  } catch (error) {
    callGuide = {
      status: "generated",
      source: "deterministic",
      sections: deterministicSections,
      generatedAt: getNowIso(),
      errorMessage:
        error instanceof Error
          ? error.message
          : "Claude call guide generation failed; used the deterministic fallback instead.",
    };
  }

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    callGuide,
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}
