import { z } from "zod";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { MonthlyTouchRecord, Presentation } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getServerEnv } from "@/src/lib/server/env";
import { callLlmForJson, getNowIso, hasAnyLlmProvider, stripUndefinedDeep } from "@/src/lib/server/services/mtos-ai";
import { buildTouchEvidence } from "@/src/lib/server/services/live-call-guide-service";
import { getPromptText } from "@/src/lib/server/prompt-store";

/**
 * The client-facing deck: the second of the two delivery formats MT-002 prepares
 * for, alongside the timed call guide. Same reviewed prep, same evidence bundle,
 * different surface -- this one is screen-shared with the client, so everything
 * internal (QC scores, retention level, coaching) stays in presenterNotes.
 *
 * The slide shapes are fixed (see PresentationLayout) rather than free-form, for
 * three reasons: the deck cannot drift off-brand, the in-app viewer and the .pptx
 * export render from one description, and the model spends its tokens on what to
 * say rather than on inventing layout.
 */

const toneSchema = z.enum(["neutral", "good", "watch", "risk"]);

const slideSchema = z.object({
  layout: z.enum([
    "cover",
    "agenda",
    "stat_callouts",
    "bullets",
    "two_column",
    "table",
    "questions",
    "status_list",
    "timeline",
    "closing",
  ]),
  section: z.string().optional(),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  bullets: z.array(z.string().min(1)).max(7).optional(),
  stats: z
    .array(z.object({ value: z.string().min(1), caption: z.string().min(1), tone: toneSchema.optional() }))
    .max(4)
    .optional(),
  columns: z
    .array(z.object({ heading: z.string().min(1), items: z.array(z.string().min(1)).max(6) }))
    .max(2)
    .optional(),
  table: z
    .object({ headers: z.array(z.string()).min(2).max(6), rows: z.array(z.array(z.string())).max(8) })
    .optional(),
  items: z
    .array(
      z.object({
        label: z.string().min(1),
        detail: z.string().optional(),
        status: z.string().optional(),
        tone: toneSchema.optional(),
      }),
    )
    .max(6)
    .optional(),
  footnote: z.string().optional(),
  presenterNotes: z.string().optional(),
});

const presentationSchema = z.object({
  title: z.string().min(1),
  clientName: z.string().optional(),
  periodLabel: z.string().optional(),
  /** The client contact the deck is addressed to, as the cover slide shows it. */
  preparedFor: z.string().optional(),
  /** The Account Manager presenting. */
  preparedBy: z.string().optional(),
  language: z.enum(["en", "es"]).optional(),
  experienceFormat: z.string().optional(),
  formatRationale: z.string().optional(),
  slides: z.array(slideSchema).min(8).max(24),
});

/**
 * Which experience formats this client has already had, newest first, so the
 * rotation rule in the prompt has history to work from. Read off the stored decks
 * rather than a separate table: the deck itself is the record that it happened.
 */
async function recentFormats(
  context: TenantContext,
  clientId: string,
  excludeTouchId: string,
): Promise<string[]> {
  try {
    const dataSource = getMtosDataSource();
    const touches = await dataSource.getMonthlyTouches();
    return touches
      .filter(
        (touch) =>
          touch.clientId === clientId &&
          touch.id !== excludeTouchId &&
          touch.presentation?.experienceFormat,
      )
      .sort((a, b) => (b.presentation?.generatedAt || "").localeCompare(a.presentation?.generatedAt || ""))
      .map((touch) => touch.presentation!.experienceFormat!)
      .slice(0, 10);
  } catch {
    // History is an input to format choice, not a precondition for building a deck.
    return [];
  }
}

export async function generatePresentation(
  context: TenantContext,
  touchId: string,
): Promise<{ touch: MonthlyTouchRecord }> {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firestore is not configured");
  }

  const dataSource = getMtosDataSource();
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  if (!touch.prepPack || !touch.executiveBrief) {
    throw new Error(
      "Prepare this touch first — the deck is built from the reviewed prep, not from raw data.",
    );
  }

  const env = getServerEnv();
  if (!hasAnyLlmProvider(env)) {
    throw new Error("No LLM provider is configured, so the presentation cannot be written.");
  }

  const history = await recentFormats(context, touch.clientId, touch.id);

  const system = await getPromptText("monthly_touch_presentation_prompt");
  const userText = [
    "Build the client-facing deck for this Monthly Touch.",
    "",
    history.length
      ? `Experience formats already used for this client, newest first: ${history.join("; ")}. Choose a different one, per the rotation rule.`
      : "No presentation history is recorded for this client, so non-repetition cannot be verified. Choose a format that fits the evidence and say so in formatRationale.",
    "",
    "The reviewed preparation and its full evidence bundle:",
    JSON.stringify(buildTouchEvidence(touch), null, 2),
  ].join("\n");

  // A 20-slide deck with presenter notes on every slide is the largest single
  // answer MTOS asks for, and the thinking is charged to the same ceiling.
  const result = await callLlmForJson({ env, system, userText, maxTokens: 32000 });
  const parsed = presentationSchema.parse(result.data);

  const presentation: Presentation = {
    status: "generated",
    title: parsed.title,
    clientName: parsed.clientName,
    periodLabel: parsed.periodLabel,
    preparedFor: parsed.preparedFor,
    preparedBy: parsed.preparedBy,
    language: parsed.language || "en",
    experienceFormat: parsed.experienceFormat,
    formatRationale: parsed.formatRationale,
    slides: parsed.slides,
    generatedAt: getNowIso(),
    model: result.model,
    provider: result.provider,
  };

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    presentation,
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}
