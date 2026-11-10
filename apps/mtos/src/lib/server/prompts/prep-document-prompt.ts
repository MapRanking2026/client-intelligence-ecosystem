import bundledPromptsJson from "@/src/prompts/mtos-prompts.json";
import { getPromptRecord } from "@/src/lib/server/prompt-store";

/**
 * The preparation document's section catalogue, resolved from the Prompt Engine.
 *
 * MTOS carries the full Monthly Touch preparation prompt in the engine
 * (`monthly_touch_preparation_prompt`, the account-review instructions), but its output contract
 * only ever allowed a small JSON object -- one `executiveBrief` string plus a few lists. So the
 * document the original prompt actually specifies, with its numbered sections, its conditional
 * Retention section and its two closing sections, had nowhere to go. This module is the missing
 * half: the section catalogue and the instructions that produce it.
 *
 * Until 9 November 2026 that catalogue, and the document's whole writing standard, were module
 * constants here. They were the largest block of model instructions left in application code, and
 * the engine row for this document described itself as a "house layer" on top of a standard that
 * "cannot be edited away here" -- so the screen the owner is told is the single source of truth was
 * showing him a tenth of the prompt actually in force. Both halves now live in the engine
 * (`monthly_touch_prep_document_prompt` and `monthly_touch_prep_document_sections_prompt`) and are
 * read per request, so an edit is in force on the next document with no deploy.
 *
 * What stays in code is the shape, not the words: which ids make up each half of the document, and
 * how the catalogue's text is read back into specs. The ids are the AM's and the QC's shared
 * vocabulary ("Section 14, the Live Recap & Close") and the filing addresses them, so they are
 * stable identifiers rather than display decoration.
 */

export const PREP_DOCUMENT_PROMPT_KEY = "monthly_touch_prep_document_prompt";
export const PREP_DOCUMENT_SECTIONS_PROMPT_KEY = "monthly_touch_prep_document_sections_prompt";

export interface PrepSectionSpec {
  /** The original prompt's own number. "R" is the conditional Retention section. */
  id: string;
  title: string;
  /**
   * Required sections are written even when the inputs are sparse -- the document explains the
   * limitation instead of omitting the section. A conditional section is omitted only when it
   * genuinely does not apply (no retention level; the channel is not active).
   */
  required: boolean;
  /** When a conditional section applies, in words the model is given. */
  appliesWhen?: string;
  /** What this section must contain. */
  guidance: string;
}

/**
 * The section brief the model receives, and the shape the engine row is written in:
 *
 *     SECTION 3 — Look-Back: Last Touch Follow-Through (required)
 *     Include when: ...            <- conditional sections only
 *     <the section's instructions>
 *
 * One function for both directions, so what an operator edits in the engine is exactly what the
 * model is sent. `parsePrepDocumentSections` reads it back; round-tripping is checked in
 * `scripts/check-prep-workflow.ts`.
 */
export function renderSectionBrief(spec: PrepSectionSpec): string {
  const header = `SECTION ${spec.id} — ${spec.title}${spec.required ? " (required)" : " (conditional)"}`;
  const when = spec.appliesWhen ? `Include when: ${spec.appliesWhen}.` : "";
  return [header, when, spec.guidance].filter(Boolean).join("\n");
}

const SECTION_HEADER = /^SECTION (\S+) — (.+) \((required|conditional)\)$/;
const APPLIES_WHEN = /^Include when: (.+)\.$/;

/**
 * Read the catalogue text back into specs.
 *
 * Deliberately strict and loud. A document that silently loses section 14 is not a usable
 * preparation, and the AM would have no way to tell that a typo in a settings screen was the
 * reason -- so a block that does not start with a `SECTION <id> — <title> (required|conditional)`
 * line, or that carries no instructions, throws and stops the stage with the id named.
 */
export function parsePrepDocumentSections(text: string): PrepSectionSpec[] {
  const blocks = (text || "")
    .split(/\n(?=SECTION \S+ — )/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (!blocks.length) {
    throw new Error(
      `Prompt "${PREP_DOCUMENT_SECTIONS_PROMPT_KEY}" has no sections. Each one starts with a line like "SECTION 3 — Title (required)".`,
    );
  }

  const specs: PrepSectionSpec[] = [];
  for (const block of blocks) {
    const [headerLine, ...rest] = block.split("\n");
    const header = SECTION_HEADER.exec(headerLine.trim());
    if (!header) {
      throw new Error(
        `Prompt "${PREP_DOCUMENT_SECTIONS_PROMPT_KEY}" has a section that does not start with "SECTION <id> — <title> (required)" or "(conditional)": ${headerLine.trim().slice(0, 80)}`,
      );
    }

    const [, id, title, kind] = header;
    const applies = APPLIES_WHEN.exec((rest[0] || "").trim());
    const guidance = (applies ? rest.slice(1) : rest).join("\n").trim();

    if (!guidance) {
      throw new Error(
        `Section ${id} in "${PREP_DOCUMENT_SECTIONS_PROMPT_KEY}" says nothing about what it must contain.`,
      );
    }
    if (specs.some((spec) => spec.id === id)) {
      throw new Error(`Section ${id} appears twice in "${PREP_DOCUMENT_SECTIONS_PROMPT_KEY}".`);
    }

    specs.push({
      id,
      title,
      required: kind === "required",
      ...(applies ? { appliesWhen: applies[1] } : {}),
      guidance,
    });
  }

  return specs;
}

/** The ids a complete document must contain, whatever the inputs look like. */
export function requiredPrepSectionIds(specs: PrepSectionSpec[]): string[] {
  return specs.filter((spec) => spec.required).map((spec) => spec.id);
}

/**
 * The catalogue in force for the next document. Read per request -- no module-level capture --
 * so an edit in the Prompt Engine applies to the very next preparation.
 */
export async function loadPrepDocumentSections(): Promise<PrepSectionSpec[]> {
  const record = await getPromptRecord(PREP_DOCUMENT_SECTIONS_PROMPT_KEY);
  if (!record) {
    throw new Error(
      `Prompt "${PREP_DOCUMENT_SECTIONS_PROMPT_KEY}" is not defined in the Prompt Engine. Add it under Settings → Prompt Engine.`,
    );
  }
  return parsePrepDocumentSections(record.prompt);
}

/** The catalogue text exactly as the bundled library holds it. */
export function bundledPrepDocumentSectionsText(): string {
  // Only `key` and `prompt` are claimed: TypeScript infers a different object type per phase from
  // the JSON (some rows carry a `runtimeContract`, some do not) and the union of those is unusable
  // for a flatMap. The same narrowing is used in `scripts/check-prompt-store.ts`.
  const rows = (bundledPromptsJson as { prompts: { key: string; prompt: string }[] }[]).flatMap(
    (phase) => phase.prompts,
  );
  const row = rows.find((prompt) => prompt.key === PREP_DOCUMENT_SECTIONS_PROMPT_KEY);
  if (!row) {
    throw new Error(`${PREP_DOCUMENT_SECTIONS_PROMPT_KEY} is missing from src/prompts/mtos-prompts.json`);
  }
  return row.prompt;
}

/**
 * The catalogue as the bundled library ships it -- the seed Firestore boots from, and what the
 * checks exercise, since they must run without a database.
 */
export function bundledPrepDocumentSections(): PrepSectionSpec[] {
  return parsePrepDocumentSections(bundledPrepDocumentSectionsText());
}
