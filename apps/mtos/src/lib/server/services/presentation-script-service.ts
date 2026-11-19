import { z } from "zod";

import { CLIENT_CONTENT_RULE } from "@/src/lib/contracts/client-content";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import { SCRIPT_LIMITS } from "@/src/lib/contracts/presenter-script";
import type { MonthlyTouchRecord, Presentation, PresentationSlide } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getServerEnv } from "@/src/lib/server/env";
import { callLlmForJson, getNowIso, hasAnyLlmProvider } from "@/src/lib/server/services/mtos-ai";
import { getModelRouteForPrompt } from "@/src/lib/server/prompt-model-route";
import { getPromptText } from "@/src/lib/server/prompt-store";
import { getAccountManagerProfile } from "@/src/lib/server/services/user-service";
import { presentationIdentity, withPresentationIdentity } from "./presentation-identity-service";

/**
 * Writing what the account manager actually says, slide by slide.
 *
 * The deck answers "what is true this month". The presenter notes answer "what must I remember
 * about this slide". Neither answers the question an AM has three seconds after a slide appears
 * on a client's screen, which is "what do I say". That gap is what this fills, and it is why the
 * script is verbatim rather than a list of points to hit: a bulleted reminder still has to be
 * turned into sentences live, in front of the client, which is exactly where a number gets
 * overstated or a caveat gets dropped.
 *
 * Written as a separate pass rather than inside the deck generation for two reasons. The deck
 * call already runs at the model's output ceiling with presenter notes on every slide, and the
 * script must be written against the FINAL slides -- including the ones the AM edited by hand and
 * the rank comparisons inserted server-side afterwards. A script written at generation time would
 * describe slides that no longer exist.
 *
 * What the script may contain is the same as what a slide may contain, for the obvious reason
 * that it is said to the client's face: the client-visibility rule is passed in with it, and the
 * presenter notes go in as context the model may use to stay accurate but must never repeat --
 * those carry internal reconciliation, QC and coaching text.
 */

const scriptSchema = z.object({
  scripts: z
    .array(
      z.object({
        slide: z.number().int().min(1),
        script: z.string().min(1),
      }),
    )
    .min(1),
});

/**
 * The instructions, used when the Prompt Engine has no entry for this key yet.
 *
 * The Prompt Engine remains the source of truth: if `monthly_touch_presentation_script_prompt` is
 * defined there it wins, so the wording can be tuned without a deploy. This constant exists so the
 * feature works the moment it ships rather than after someone remembers to paste a prompt in.
 */
const BUILT_IN_SCRIPT_PROMPT = `You write what an account manager says out loud to a client, slide by slide, during a Monthly Touch call.

WHAT YOU PRODUCE
For each slide, the exact words to say. Verbatim. The account manager reads your sentences as they stand, so anything that is not meant to be spoken must not appear: no stage directions, no "mention that...", no "[insert name]", no headings, no bullet characters, no markdown, no slide numbers, no labels like "Opening:" or "Transition:".

HOW IT MUST SOUND
- Spoken English, not written English. Short sentences. Contractions. The rhythm of somebody talking.
- Address the client directly as "you" and "your business". Use the client's first name only where a person would naturally say it, which is the opening and the close, not every slide.
- Natural, not scripted-sounding. No marketing superlatives, no "we're excited to share", no "as you can see on this slide".
- 60 to 140 words for a normal content slide. Shorter for the cover, the agenda and the closing. Never longer than 200.

WHAT EVERY SLIDE MUST DO
Say what the figure or finding IS, then immediately what it MEANS FOR THEIR BUSINESS, in their terms: more calls, more booked jobs, more of the work they said is profitable, less money spent on what is not working, ground gained or lost against the competitors near them. A number with no consequence for the owner is the single most common failure here. "Calls are up 32%" is half a sentence; "calls are up 32%, which is about fifteen more people a month reaching you directly from Google, and those convert better than form fills" is the whole one.
Where a figure is down, say so plainly, say what it does and does not mean for them, and say what is being done about it. Never spin a decline, never bury it, never apologise at length.

HARD RULES
- Use ONLY the figures, dates, names and facts present in the slide you are writing for. Do not carry numbers between slides, do not round them differently, do not invent a comparison, a percentage, a cause or a result that is not there.
- Never claim one action caused a ranking or revenue change unless the slide itself says so.
- The presenter notes given to you are INTERNAL. Use them to stay accurate and to respect their caveats. Never repeat their content aloud, never mention internal tooling, dashboards, task names, ticket names, QC, scores, coaching or anything about how the agency works internally.
- Follow the client-visibility rule given in the request exactly. Unfinished, pending, proposed or in-progress work is never spoken about.
- On a questions slide, ask the questions and then stop: the next words are the client's.
- Write in the deck's language. If the deck language is "es", write the script in Spanish.

Return JSON: {"scripts":[{"slide":1,"script":"..."}]} with one entry per slide, in order, covering every slide you were given.`;

async function systemPrompt(): Promise<string> {
  try {
    return await getPromptText("monthly_touch_presentation_script_prompt");
  } catch {
    return BUILT_IN_SCRIPT_PROMPT;
  }
}

/** What the model is shown of one slide: everything the client will see, and nothing else. */
function slideForScript(slide: PresentationSlide, index: number) {
  return {
    slide: index + 1,
    layout: slide.layout,
    section: slide.section,
    title: slide.title,
    subtitle: slide.subtitle,
    bullets: slide.bullets,
    stats: slide.stats,
    columns: slide.columns,
    table: slide.table,
    items: slide.items,
    footnote: slide.footnote,
    ...(slide.rankComparison
      ? {
          keywordComparison: {
            keyword: slide.rankComparison.keyword,
            business: slide.rankComparison.businessName,
            previousScan: slide.rankComparison.previous?.grid.scanDate,
            currentScan: slide.rankComparison.current.grid.scanDate,
            previousAverageRank: slide.rankComparison.previous?.grid.averageRankPosition,
            currentAverageRank: slide.rankComparison.current.grid.averageRankPosition,
            sameCoverage: slide.rankComparison.sameGrid,
          },
        }
      : {}),
    internalNotesDoNotSpeak: slide.presenterNotes,
  };
}

export type ScriptTarget = "touch" | "loom";

export interface PresenterScriptResult {
  slides: PresentationSlide[];
  written: number;
  scriptsGeneratedAt: string;
}

/**
 * Write (or rewrite) the spoken script for every slide of a generated deck.
 *
 * Always writes all of them rather than filling the gaps: the slides are presented in sequence and
 * a deck half-written by one model pass and half by another reads as two different people talking.
 * An AM who has hand-edited one script and wants to keep it edits it back afterwards, which the
 * slide editor supports.
 */
export async function generatePresenterScripts(
  context: TenantContext,
  touchId: string,
  target: ScriptTarget = "touch",
): Promise<PresenterScriptResult> {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firestore is not configured, so the presenter scripts cannot be saved.");
  }
  const touch = await getMtosDataSource(context).getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  let presentation = target === "loom" ? touch.noShow?.presentation : touch.presentation;
  if (!presentation || presentation.status !== "generated" || !presentation.slides?.length) {
    throw new Error("Generate the presentation first — the script is written from the slides it will be presenting.");
  }

  const env = getServerEnv();
  if (!hasAnyLlmProvider(env)) {
    throw new Error("No LLM provider is configured, so the presenter scripts cannot be written.");
  }

  const client = await getMtosDataSource(context).getClientById(touch.clientId);
  if (!client) throw new Error("The client for this Monthly Touch is not available.");
  presentation = withPresentationIdentity(presentation, await presentationIdentity(context, client, touch))!;
  const profile = await getAccountManagerProfile(context);
  const system = await systemPrompt();

  const userText = [
    "Write the spoken script for each slide of this client presentation.",
    CLIENT_CONTENT_RULE,
    "",
    `Client: ${presentation.clientName || client?.name || "this client"}.`,
    `Client contact the deck is addressed to: ${presentation.preparedFor || "the business owner"}.`,
    `Account manager speaking: ${presentation.preparedBy || profile.name || "the account manager"}.`,
    `Period: ${presentation.periodLabel || "this month"}. Deck language: ${presentation.language || "en"}.`,
    ...(client?.industry ? [`What the business does: ${client.industry}.`] : []),
    ...(touch.presentationInstructions
      ? [
          "Internal direction from the account manager for this call. Follow it where the slides support it; never quote it aloud:",
          touch.presentationInstructions,
        ]
      : []),
    "",
    `Write one script per slide, for all ${presentation.slides.length} slides, numbered from 1 in the order given.`,
    `Keep each script under ${SCRIPT_LIMITS.perSlide} characters.`,
    "",
    "The slides, exactly as the client will see them. `internalNotesDoNotSpeak` is context for your accuracy only and must never be said aloud:",
    JSON.stringify(presentation.slides.map(slideForScript), null, 2),
  ].join("\n");

  const result = await callLlmForJson({ env, system, userText, maxTokens: 16000, route: await getModelRouteForPrompt(env, "monthly_touch_presentation_script_prompt") });
  const parsed = scriptSchema.parse(result.data);

  const byNumber = new Map(parsed.scripts.map((entry) => [entry.slide, entry.script]));
  const scriptsGeneratedAt = getNowIso();
  const slides = presentation.slides.map((slide, index) => {
    const script = (byNumber.get(index + 1) || "").trim().slice(0, SCRIPT_LIMITS.perSlide);
    // A slide the model skipped keeps whatever script it had rather than losing one.
    return script ? { ...slide, presenterScript: script } : slide;
  });

  const written = slides.filter((slide, index) => slide.presenterScript !== presentation.slides[index]?.presenterScript).length;
  const next: Presentation = { ...presentation, slides, scriptsGeneratedAt };

  await db
    .doc(monthlyTouchPath(context.tenantId, touch.id))
    .set(
      target === "loom"
        ? ({ noShow: { ...touch.noShow, presentation: next }, updatedAt: scriptsGeneratedAt } as Partial<MonthlyTouchRecord>)
        : ({ presentation: next, updatedAt: scriptsGeneratedAt } as Partial<MonthlyTouchRecord>),
      { merge: true },
    );

  return { slides, written, scriptsGeneratedAt };
}
