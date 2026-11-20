/**
 * The models an operator can pin to a single prompt in Settings -> Prompt Engine.
 *
 * A prompt with no model pinned keeps choosing its model automatically, from its
 * provider and difficulty (see `src/lib/server/model-router.ts`). A pinned model
 * wins over that and over the MTOS_MODEL_ROUTES environment override, because the
 * choice the operator sees on the prompt is the one that has to be true.
 *
 * Pure and client-safe: the Prompt Engine screen and the API routes both import
 * it, so the dropdown and the server-side check can never drift apart. To offer
 * a newer model, add it here.
 */

export type PromptModelProvider = "claude" | "gemini";

export interface PromptModelOption {
  /** The exact model id sent to the provider's API. */
  id: string;
  /** What the operator reads in the dropdown. */
  label: string;
  /** One short phrase on when to choose it. */
  note: string;
}

export const PROMPT_MODEL_OPTIONS: Record<PromptModelProvider, PromptModelOption[]> = {
  claude: [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "most capable, slowest" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "balanced" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "fastest" },
  ],
  gemini: [
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", note: "balanced" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", note: "fastest" },
  ],
};

/** The value the dropdown and the API use for "no model pinned". */
export const AUTOMATIC_PROMPT_MODEL = "";

export function promptModelOptions(provider: string | undefined): PromptModelOption[] {
  return provider === "claude" || provider === "gemini" ? PROMPT_MODEL_OPTIONS[provider] : [];
}

/** True when `model` is one of the models offered for `provider`. */
export function isPromptModelFor(provider: string | undefined, model: string | undefined): boolean {
  return Boolean(model) && promptModelOptions(provider).some((option) => option.id === model);
}

/** Which provider serves a pinned model, or null when the id is not one we offer. */
export function providerOfPromptModel(model: string | undefined): PromptModelProvider | null {
  if (!model) return null;
  for (const provider of Object.keys(PROMPT_MODEL_OPTIONS) as PromptModelProvider[]) {
    if (PROMPT_MODEL_OPTIONS[provider].some((option) => option.id === model)) return provider;
  }
  return null;
}

export function promptModelLabel(model: string | undefined): string | null {
  if (!model) return null;
  for (const options of Object.values(PROMPT_MODEL_OPTIONS)) {
    const match = options.find((option) => option.id === model);
    if (match) return match.label;
  }
  return model;
}
