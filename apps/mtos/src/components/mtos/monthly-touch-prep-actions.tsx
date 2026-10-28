"use client";

import { useState } from "react";
import { LoaderCircle, RefreshCw, Sparkles } from "lucide-react";

import { AiProgressPanel, useAiRun } from "@/src/components/mtos/ai-progress";
import { readJsonResponse } from "@/src/lib/api/read-json-response";

interface MonthlyTouchPrepActionsProps {
  touchId: string;
  preparedAt?: string;
  claudeStatus?: "generated" | "not_configured" | "failed";
  claudeError?: string;
  /** Which LLM provider answered (claude/openai/gemini), when generated. */
  claudeProvider?: string;
  /** Whether the live call guide below has been generated for this touch. */
  callGuideGenerated?: boolean;
}

const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
};

interface PrepareTouchResponse {
  data?: {
    touch?: {
      prepPack?: {
        preparedAt?: string;
        claude?: {
          status?: "generated" | "not_configured" | "failed";
          errorMessage?: string;
        };
      };
    };
  };
  error?: string;
}

function formatPreparedAt(value?: string) {
  if (!value) {
    return "Not prepared yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not prepared yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * The steps Generate actually runs, in order. Named rather than counted: "step 2 of 2" says
 * nothing, while "Building the live call guide" tells the AM what is happening and roughly how
 * much is left. Each is a separate request -- see runPrepare.
 */
const GENERATE_STEPS = ["Preparing data and writing the prep pack", "Building the live call guide"];
const REFRESH_STEPS = ["Refreshing the data behind this touch"];

/** Measured on production: 9s of dashboard pulls, then ~145s of model time per half. */
const GENERATE_TYPICAL = "Usually 3-5 minutes — it reads every connected dashboard, then writes twice";
const REFRESH_TYPICAL = "Usually under a minute — this only re-reads the dashboards, no AI";

async function postTouchAction(touchId: string, action: string): Promise<PrepareTouchResponse> {
  const response = await fetch(`/api/monthly-touches/${touchId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ action }),
  });
  const payload = await readJsonResponse<PrepareTouchResponse>(response);

  if (!response.ok) {
    throw new Error(payload?.error || "Unable to prepare this monthly touch");
  }

  return payload;
}

export function MonthlyTouchPrepActions({
  touchId,
  preparedAt,
  claudeStatus,
  claudeError,
  claudeProvider,
  callGuideGenerated,
}: MonthlyTouchPrepActionsProps) {
  const [error, setError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<"prepare" | "prepare_and_generate" | null>(null);
  const ai = useAiRun();

  const isPending = activeAction !== null;

  /**
   * Deliberately NOT wrapped in startTransition. See ai-progress.tsx: an async
   * transition holds its state updates until the work finishes, so the progress
   * panel never mounted while there was anything to report.
   */
  function runPrepare(action: "prepare" | "prepare_and_generate") {
    setError(null);
    setActiveAction(action);
    ai.start(
      action === "prepare" ? REFRESH_STEPS : GENERATE_STEPS,
      action === "prepare" ? REFRESH_TYPICAL : GENERATE_TYPICAL,
    );

    void (async () => {
      try {
        if (action === "prepare") {
          await postTouchAction(touchId, "prepare");
        } else {
          // Two requests rather than one. The prep pack and the call guide are a model call each
          // on top of the dashboard pulls, and together they ran past the 300s function ceiling
          // and were killed mid-run -- the AM saw a JSON parse error and got nothing. Split, each
          // half has its own budget, and the prep pack survives a failure in the second half.
          await postTouchAction(touchId, "prepare_with_ai");

          ai.advance();
          try {
            await postTouchAction(touchId, "generate_call_guide");
          } catch (guideError) {
            const detail =
              guideError instanceof Error ? guideError.message : "the call guide could not be built";
            throw new Error(
              `${detail} The preparation itself was saved -- reload, then use "Regenerate guide only" lower down to retry just the guide.`,
            );
          }
        }

        globalThis.location.reload();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to prepare this monthly touch");
      } finally {
        ai.stop();
        setActiveAction(null);
      }
    })();
  }

  return (
    <div className="space-y-3 rounded-[24px] border border-white/8 bg-black/20 p-4">
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
          Preparation engine
        </p>
        <p className="text-sm text-slate-200">Last prepared: {formatPreparedAt(preparedAt)}</p>
        <p className="text-xs text-slate-500">
          AI status: {claudeStatus === "generated" ? "Generated" : claudeStatus === "failed" ? "Failed" : "Not configured"}
          {claudeStatus === "generated" && claudeProvider
            ? ` · via ${PROVIDER_LABEL[claudeProvider] || claudeProvider}`
            : ""}
          {` · Live call guide: ${callGuideGenerated ? "ready" : "not generated"}`}
        </p>
        <p className="text-xs text-slate-500">
          Generate builds the preparation and the live call guide together — scroll down to walk from prep
          into the call.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => runPrepare("prepare")}
          disabled={isPending}
          style={{ color: "#0d1625" }}
          className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white px-4 py-2 text-sm font-medium text-[#0d1625] transition hover:bg-[#d7f5ec] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending && activeAction === "prepare" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh data only
        </button>
        <button
          type="button"
          onClick={() => runPrepare("prepare_and_generate")}
          disabled={isPending}
          style={{ color: "#0d1625" }}
          className="inline-flex items-center gap-2 rounded-full border border-[#d7f5ec]/20 bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0d1625] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending && activeAction === "prepare_and_generate" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {callGuideGenerated ? "Regenerate prep + call guide" : "Generate prep + call guide"}
        </button>
      </div>

      {ai.run ? <AiProgressPanel run={ai.run} elapsed={ai.elapsed} /> : null}

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      {!error && claudeStatus === "failed" && claudeError ? (
        <p className="text-sm text-amber-200">{claudeError}</p>
      ) : null}
    </div>
  );
}
