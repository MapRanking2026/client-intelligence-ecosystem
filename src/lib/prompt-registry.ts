/**
 * Runtime bindings between Prompt Engine keys and the MTOS modules that execute
 * them. This is deliberately code-side metadata: it records *where* a prompt is
 * consumed so the Prompt Engine can show operators what a change will affect.
 * It never contains prompt text -- the Prompt Engine store is the only source of
 * truth for instructions.
 */

export interface PromptBinding {
  /** Human-readable MTOS module or workflow that executes this prompt. */
  module: string;
  /** Repo path of the consumer, so an engineer can trace it. */
  source: string;
}

export const PROMPT_BINDINGS: Record<string, PromptBinding[]> = {
  monthly_touch_preparation_prompt: [
    {
      module: "Monthly Touch preparation (prep pack generation)",
      source: "src/lib/server/services/monthly-touch-prep-service.ts",
    },
  ],
  meeting_structure_run_sheet_prompt: [
    {
      module: "Live call guide (timed run-sheet)",
      source: "src/lib/server/services/live-call-guide-service.ts",
    },
  ],
  meeting_transcript_analysis_prompt: [
    {
      module: "Post-meeting workflow (recap, commitments, tickets, follow-up email)",
      source: "src/lib/server/services/post-meeting-service.ts",
    },
  ],
  qa_evaluation_prompt: [
    {
      module: "QA review scorecard",
      source: "src/lib/server/services/qa-review-service.ts",
    },
  ],
  lead_verification_prompt: [
    {
      module: "Lead & call verification (client card + Monthly Touch prep)",
      source: "src/lib/server/services/lead-verification-service.ts",
    },
  ],
  retention_brief_prompt: [
    {
      module: "Emergency Retention (internal save-the-account brief)",
      source: "src/lib/server/services/retention-service.ts",
    },
  ],
  retention_report_narrative_prompt: [
    {
      module: "Client report generation (retention & performance reports)",
      source: "src/lib/server/services/retention-service.ts",
    },
  ],
  meeting_variety_prompt: [
    {
      module: "Meeting variety & client-copilot (Monthly Touch preparation)",
      source: "src/lib/server/services/meeting-variety-service.ts",
    },
  ],
};

export function getPromptBindings(key: string): PromptBinding[] {
  return PROMPT_BINDINGS[key] || [];
}
