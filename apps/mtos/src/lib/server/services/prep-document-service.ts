import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ConfirmationEmailState, PrepDocumentState } from "@/src/lib/contracts/prep-workflow";
import type { ClientRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { getServerEnv } from "@/src/lib/server/env";
import { getPromptText } from "@/src/lib/server/prompt-store";
import {
  PREP_DOCUMENT_PROMPT_KEY,
  PREP_DOCUMENT_SECTIONS,
  PREP_DOCUMENT_SYSTEM_PROMPT,
  REQUIRED_PREP_SECTION_IDS,
  type PrepSectionSpec,
} from "@/src/lib/server/prompts/prep-document-prompt";
import {
  appliesToThisTouch,
  assembleMarkdown,
  buildSections,
  resolveApplicability,
  type ModelSection,
} from "@/src/lib/server/services/prep-document-builder";
import { buildTouchEvidence } from "@/src/lib/server/services/live-call-guide-service";
import { callLlmForJson, getNowIso, hasAnyLlmProvider } from "@/src/lib/server/services/mtos-ai";
import { retrieveKnowledge } from "@/src/lib/server/services/knowledge-service";

/**
 * Writing the Pre-Monthly Touch Preparation & Agenda document.
 *
 * This is step 3 of the preparation workflow, and the only place the full document is produced. It
 * reads the findings the account review already established -- it does not go back to the
 * integrations, because the document must describe what the research actually found, not a second
 * and possibly different pull.
 *
 * The document is generated in two halves rather than one call. Sixteen sections of usable prose is
 * well past what any provider returns in one response: asked for all of them at once, models stop
 * somewhere around section 8 and the tail arrives empty. Each half gets its own request and its own
 * output budget, and a half that fails is reported as a failure of the stage instead of being
 * silently filed as a short document.
 */

/** Where the document splits. Section 8 ends the look-back and the SEO review; 9 opens the channels. */
const FIRST_PASS_IDS = ["0", "R", "1", "2", "3", "4", "5", "6", "7", "8"];
const SECOND_PASS_IDS = ["9", "10", "11", "12", "13", "14", "15", "16"];

/** The section brief the model receives: its number, its title, and what it must contain. */
function renderSectionBrief(spec: PrepSectionSpec): string {
  const header = `SECTION ${spec.id} — ${spec.title}${spec.required ? " (required)" : " (conditional)"}`;
  const when = spec.appliesWhen ? `Include when: ${spec.appliesWhen}.` : "";
  return [header, when, spec.guidance].filter(Boolean).join("\n");
}

/**
 * The confirmation email as section 15 must reproduce it.
 *
 * Section 15 is the client-facing agenda, and by the time the document is written the AM has
 * already approved the wording the client receives. Passing it in is what keeps the document and
 * the client's inbox saying the same thing; its real send status goes with it so the document can
 * never claim the agenda was sent when it was only approved.
 */
function renderConfirmationEmail(email: ConfirmationEmailState | undefined): string {
  if (!email) {
    return "CONFIRMATION EMAIL: none has been approved in MTOS. Write section 15 as a fresh draft and say it has not been sent yet.";
  }
  const sent =
    email.status === "sent"
      ? `It was sent on ${email.sentAt} via ${email.sentVia || "the configured channel"}.`
      : email.status === "sent_manually"
        ? `The account manager sent it themselves on ${email.sentAt}.`
        : "It has been approved but NOT sent yet. Say so plainly in section 15.";
  return [
    "CONFIRMATION EMAIL (already approved by the account manager — reproduce this wording in section 15):",
    `Channel: ${email.channel}`,
    `To: ${email.recipient || "— (no address on file)"}`,
    `Meeting time as the client will read it: ${email.meetingWhen} (${email.timeZone})`,
    `Subject: ${email.subject}`,
    "Body:",
    email.body,
    sent,
  ].join("\n");
}

/** Which sources the account review actually reached, so the document cannot overstate its evidence. */
function renderSourceDiscipline(touch: MonthlyTouchRecord): string {
  const research = touch.prepWorkflow?.research;
  if (!research) {
    return "SOURCES CHECKED: not recorded for this touch. Do not state that any email was sent, received or unanswered.";
  }
  const lines = research.sourceChecks.map(
    (check) =>
      `- ${check.label}: ${check.checked ? (check.reachable ? "checked" : "checked but did not answer") : "not connected, so not checked"} — ${check.detail}`,
  );
  return [
    "SOURCES CHECKED DURING THE ACCOUNT REVIEW:",
    ...lines,
    `Client email verification: ${research.commsVerification.note}`,
  ].join("\n");
}

/** One request to the model for one half of the document. */
async function generatePass(
  system: string,
  specs: PrepSectionSpec[],
  bundle: string,
  passLabel: string,
): Promise<{ sections: ModelSection[]; missing: string[]; model: string; provider: string }> {
  const userText = [
    bundle,
    "",
    `WRITE THESE SECTIONS NOW (${passLabel}). Return one entry per section id, in this order:`,
    specs.map(renderSectionBrief).join("\n\n"),
  ].join("\n");

  const { data, model, provider } = await callLlmForJson({
    env: getServerEnv(),
    system,
    userText,
    // Eight to ten sections of usable prose. Measured against real accounts: the first pass runs
    // 6-9k tokens on a client with full data, and a tighter ceiling truncated section 8.
    maxTokens: 16000,
    temperature: 0.3,
  });

  const rawSections = Array.isArray(data.sections) ? data.sections : [];
  const sections: ModelSection[] = rawSections
    .map((entry) => {
      const record = (entry || {}) as Record<string, unknown>;
      const id = String(record.id ?? "").trim();
      const markdown = typeof record.markdown === "string" ? record.markdown.trim() : "";
      const skippedReason = typeof record.skippedReason === "string" ? record.skippedReason.trim() : "";
      return { id, markdown, ...(skippedReason ? { skippedReason } : {}) };
    })
    .filter((entry) => entry.id);

  const missing = Array.isArray(data.missing)
    ? data.missing.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];

  return { sections, missing, model, provider };
}

/**
 * Write the preparation document for a touch whose account review has already completed.
 *
 * Returns a state rather than throwing: a half that fails, a required section that comes back
 * empty, or a missing model are all recorded on the document so the stage can report exactly what
 * went wrong and the AM can retry. The caller decides whether the stage failed -- a document with
 * any `missingSections` is not a complete preparation.
 */
export async function generatePrepDocument(
  context: TenantContext,
  touch: MonthlyTouchRecord,
  client: ClientRecord,
): Promise<PrepDocumentState> {
  const generatedAt = getNowIso();
  const env = getServerEnv();

  if (!touch.prepPack) {
    return {
      markdown: "",
      sections: [],
      generatedAt,
      missing: [],
      missingSections: REQUIRED_PREP_SECTION_IDS,
      errorMessage:
        "The account review has not produced a preparation pack for this touch, so there are no findings to write the document from.",
    };
  }

  if (!hasAnyLlmProvider(env)) {
    return {
      markdown: "",
      sections: [],
      generatedAt,
      missing: [],
      missingSections: REQUIRED_PREP_SECTION_IDS,
      errorMessage: "No AI provider is configured, so the preparation notes can't be written.",
    };
  }

  // The editable Prompt Engine row is layered on top of the built-in contract, never instead of it:
  // the section catalogue is structural, and a settings edit must not be able to remove it.
  const editable = await getPromptText(PREP_DOCUMENT_PROMPT_KEY).catch(() => "");
  const system = editable ? `${PREP_DOCUMENT_SYSTEM_PROMPT}\n\n---\n\n${editable}` : PREP_DOCUMENT_SYSTEM_PROMPT;

  const applicability = resolveApplicability(client, touch);
  const evidence = buildTouchEvidence(touch);

  // Map Ranking's own standards (writing standard, SOPs, question bank) when the knowledge base
  // has them, so the document follows the house rules rather than a generic idea of good practice.
  const knowledge = await retrieveKnowledge(
    context,
    `Monthly Touch preparation standards, account manager writing standard, marketing content question bank, client retention warning signs, ${client.industry}`,
    6,
  ).catch(() => [] as Awaited<ReturnType<typeof retrieveKnowledge>>);

  const touchDateIso = touch.scheduledAt || touch.prepPack.schedule.scheduledAt || touch.prepPack.schedule.touchDate || generatedAt;

  const bundle = [
    "CLIENT AND MEETING",
    JSON.stringify(
      {
        client: {
          name: client.name,
          industry: client.industry,
          contact: client.contact,
          location: client.location,
          lifecycleStage: client.lifecycleStage,
          accountManager: client.accountManager,
          tenure: client.tenure,
          mrr: client.mrr,
          goals: client.goals ?? [],
          topRisks: client.topRisks ?? [],
          topOpportunities: client.topOpportunities ?? [],
          churnSignals: client.churnSignals ?? [],
          riskNote: client.riskNote ?? "",
          contextNotes: client.contextNotes ?? "",
          // Health is a three-state ClickUp label, not a measured score. Say so, so the document
          // never reports it as a precise number.
          healthLabel: client.tone,
          participationChecklist: client.participationChecklist ?? null,
          strategicAction: client.strategicAction ?? null,
        },
        meeting: {
          touchDate: client.touchDate,
          scheduledAt: touch.scheduledAt ?? null,
          calendarEventId: touch.calendarEventId ?? null,
          meetingFormat: touch.prepPack.meetingFormat ?? null,
          varietyNote: touch.prepPack.varietyNote ?? "",
          decisionsTogether: touch.prepPack.decisionsTogether ?? [],
        },
      },
      null,
      1,
    ),
    "",
    "FINDINGS FROM THE ACCOUNT REVIEW (this is the evidence; do not go beyond it)",
    JSON.stringify(evidence, null, 1),
    "",
    renderSourceDiscipline(touch),
    "",
    renderConfirmationEmail(touch.prepWorkflow?.confirmationEmail),
    "",
    knowledge.length
      ? `MAP RANKING STANDARDS AND SOPs (quote these rules, not your own):\n${knowledge
          .map((chunk) => `- ${chunk.title}: ${chunk.text}`)
          .join("\n")}`
      : "MAP RANKING STANDARDS: none are loaded in the knowledge base. Follow the writing and evidence rules in your instructions.",
    "",
    "CONDITIONAL SECTIONS FOR THIS TOUCH",
    `- Retention (section R): ${applicability.retention ? "applies" : "does not apply"}`,
    `- Google Ads (section 9): ${applicability.googleAds ? "active" : "not connected"}`,
    `- Meta Ads (section 10): ${applicability.metaAds ? "active" : "not connected"}`,
  ].join("\n");

  const specsFor = (ids: string[]) =>
    PREP_DOCUMENT_SECTIONS.filter((spec) => ids.includes(spec.id) && appliesToThisTouch(spec, applicability));

  const firstSpecs = specsFor(FIRST_PASS_IDS);
  const secondSpecs = specsFor(SECOND_PASS_IDS);

  const collected = new Map<string, ModelSection>();
  const missing: string[] = [];
  const failures: string[] = [];
  let model: string | undefined;
  let provider: string | undefined;

  for (const [specs, label] of [
    [firstSpecs, "first half: the look-back, the month and the SEO review"],
    [secondSpecs, "second half: the channels, the goal, the close and the two closing sections"],
  ] as const) {
    if (!specs.length) continue;
    try {
      const pass = await generatePass(system, specs, bundle, label);
      for (const section of pass.sections) collected.set(section.id, section);
      for (const item of pass.missing) if (!missing.includes(item)) missing.push(item);
      model = pass.model;
      provider = pass.provider;
    } catch (error) {
      failures.push(
        `${label}: ${error instanceof Error ? error.message : "the model did not answer"}`,
      );
    }
  }

  // Every section the document should contain, in the original order, whether or not the model
  // returned it. A required section the model skipped is reported, never quietly dropped.
  const { sections, missingSections } = buildSections([...collected.values()], applicability);

  const errorParts: string[] = [];
  if (failures.length) errorParts.push(`Part of the document could not be generated — ${failures.join("; ")}.`);
  if (missingSections.length) {
    errorParts.push(
      `These required sections came back empty and have to be regenerated: ${missingSections.join(", ")}.`,
    );
  }

  return {
    markdown: assembleMarkdown(client.name, touchDateIso, sections, missing),
    sections,
    generatedAt,
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    missing,
    missingSections,
    ...(errorParts.length ? { errorMessage: errorParts.join(" ") } : {}),
  };
}

