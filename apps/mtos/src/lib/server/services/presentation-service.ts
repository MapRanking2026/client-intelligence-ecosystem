import { agreedAgendaItems, agreedAgendaRule, withAgreedAgenda } from "@/src/lib/contracts/agreed-agenda";
import { withRankComparisons } from "@/src/lib/contracts/rank-comparison";
import { presentationRankComparisons } from "./presentation-rank-service";
import { CLIENT_CONTENT_RULE, clientPresentation } from "@/src/lib/contracts/client-content";
import { z } from "zod";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import { BRIEF_SECTIONS } from "@/src/lib/contracts/prep-brief";
import type { BriefSectionId } from "@/src/lib/contracts/prep-brief";
import type { MonthlyTouchRecord, Presentation } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getServerEnv } from "@/src/lib/server/env";
import { callLlmForJson, getNowIso, hasAnyLlmProvider, stripUndefinedDeep } from "@/src/lib/server/services/mtos-ai";
import { getModelRouteForPrompt } from "@/src/lib/server/prompt-model-route";
import { buildTouchEvidence } from "@/src/lib/server/services/live-call-guide-service";
import { getPromptText } from "@/src/lib/server/prompt-store";
import { presentationIdentity, withPresentationIdentity } from "./presentation-identity-service";

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

const BRIEF_SECTION_IDS = BRIEF_SECTIONS.map((section) => section.id) as [BriefSectionId, ...BriefSectionId[]];

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
  /**
   * Which brief section this slide presents. Optional because the cover, the agenda and the
   * closing slides present none, and because a deck that answers without it is still a deck --
   * it simply cannot have its slides dropped when a section is declined after it was built.
   */
  sectionId: z.enum(BRIEF_SECTION_IDS).optional(),
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
    const dataSource = getMtosDataSource(context);
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
  delivery: "live" | "loom" = "live",
): Promise<{ touch: MonthlyTouchRecord }> {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firestore is not configured");
  }

  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  // The prep pack is the only precondition. The deck is the findings of the
  // preparation, so it is built before the meeting, not after it -- nothing here
  // waits on a transcript, a QA review or anything else the touch itself produces.
  if (!touch.prepPack) {
    throw new Error(
      "Run the preparation for this touch first — the deck is written from the prep findings, " +
        "so there is nothing to present until the prep exists.",
    );
  }

  const env = getServerEnv();
  if (!hasAnyLlmProvider(env)) {
    throw new Error("No LLM provider is configured, so the presentation cannot be written.");
  }

  const history = await recentFormats(context, touch.clientId, touch.id);
  const client = await dataSource.getClientById(touch.clientId);
  if (!client) throw new Error("The client for this Monthly Touch is not available.");
  const identity = await presentationIdentity(context, client, touch, true);
  if (!identity.preparedBy) throw new Error("Add the Account Manager's name to this client's record or your profile before generating the presentation.");
  const rankComparisons = await presentationRankComparisons(context, touch);

  // What the confirmation email already told the client this call would cover. The deck is built
  // after that email is approved, so it is the deck's job to match it rather than the other way.
  const agreedAgenda = agreedAgendaItems(touch);

  const system = await getPromptText("monthly_touch_presentation_prompt");
  const userText = [
    "Build the client-facing deck for this Monthly Touch.",
    "Use these verified identity fields exactly. Do not invent names or print placeholders such as UNCONFIRMED or name needed:",
    JSON.stringify(identity),
    CLIENT_CONTENT_RULE,
    "Optional AM presentation direction (internal input, never quote it on a client slide). Follow it when supported by evidence. Preserve the whole-account overview, prioritize the requested location/keyword and keep other active profiles in the summary. This direction cannot override evidence or client privacy rules:",
    touch.presentationInstructions || "No additional direction.",
    ...(delivery === "loom" ? ["This is a recorded Loom update after a client no-show. Write presenterNotes as a complete speaking script for asynchronous delivery. Use only active services and verified relevant metrics in the reviewed evidence. Do not ask live questions, imply client attendance, invent client feedback, or expose internal coaching. Cover supported performance highlights, completed work, challenges, recommendations and next steps. Invite questions by email."] : []),
    "",
    `Give every content slide a sectionId -- the brief section it presents, one of ${BRIEF_SECTION_IDS.join(", ")}.`,
    "Leave sectionId off the cover, the agenda and the closing slides. It is how a section the",
    "account manager declines is kept out of the deck shown on the call.",
    "",
    history.length
      ? `Experience formats already used for this client, newest first: ${history.join("; ")}. Choose a different one, per the rotation rule.`
      : "No presentation history is recorded for this client, so non-repetition cannot be verified. Choose a format that fits the evidence and say so in formatRationale.",
    "",
    "VISUAL DIRECTION: Use a clear evidence-led story with varied layouts: a strong headline, two or three large metrics, concise takeaways and restrained blue/teal accents. Avoid long paragraphs and repeated tables. Keep declines and missing evidence visible; do not invent improvements.",
    "Server-verified keyword comparison slides will be inserted beside relevant keyword discussions. Introduce those keywords using their exact names; do not manufacture rank numbers or map imagery.",
    JSON.stringify(rankComparisons.map(item => ({ keyword: item.keyword, business: item.businessName, currentDate: item.current.grid.scanDate, previousDate: item.previous?.grid.scanDate, baseline: item.baselineLabel, sameGrid: item.sameGrid }))),
    ...(agreedAgenda.length ? [agreedAgendaRule(agreedAgenda)] : []),
    "The reviewed preparation and its full evidence bundle:",
    JSON.stringify(buildTouchEvidence(touch), null, 2),
  ].join("\n");

  // A 20-slide deck with presenter notes on every slide is the largest single
  // answer MTOS asks for, and the thinking is charged to the same ceiling.
  const result = await callLlmForJson({ env, system, userText, maxTokens: 32000, route: await getModelRouteForPrompt(env, "monthly_touch_presentation_prompt") });
  const parsed = presentationSchema.parse(result.data);

  const presentation: Presentation = {
    status: "generated",
    ...(touch.presentationInstructions ? { instructionsUsed: touch.presentationInstructions } : {}),
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

  const safePresentation = clientPresentation(withRankComparisons(withAgreedAgenda(withPresentationIdentity(presentation, identity)!, agreedAgenda), rankComparisons), touch)!;
  if (!safePresentation.slides.some((slide) => !["cover", "agenda", "closing"].includes(slide.layout))) throw new Error("The generated presentation contained no client-safe account results or completed work. Review the evidence and regenerate it.");
  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    presentation: safePresentation,
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}
