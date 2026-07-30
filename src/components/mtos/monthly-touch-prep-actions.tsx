"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, RefreshCw, Sparkles } from "lucide-react";

interface MonthlyTouchPrepActionsProps {
  touchId: string;
  preparedAt?: string;
  claudeStatus?: "generated" | "not_configured" | "failed";
  claudeError?: string;
  /** Which LLM provider answered (claude/openai/gemini), when generated. */
  claudeProvider?: string;
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

export function MonthlyTouchPrepActions({
  touchId,
  preparedAt,
  claudeStatus,
  claudeError,
  claudeProvider,
}: MonthlyTouchPrepActionsProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<"prepare" | "prepare_and_generate" | null>(null);

  function runPrepare(action: "prepare" | "prepare_and_generate") {
    startTransition(async () => {
      setError(null);
      setActiveAction(action);

      try {
        const response = await fetch(`/api/monthly-touches/${touchId}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ action }),
        });
        const payload = (await response.json()) as PrepareTouchResponse;

        if (!response.ok) {
          throw new Error(payload.error || "Unable to prepare this monthly touch");
        }

        globalThis.location.reload();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to prepare this monthly touch");
      } finally {
        setActiveAction(null);
      }
    });
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
          Refresh prep pack
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
          Refresh + Claude
        </button>
      </div>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      {!error && claudeStatus === "failed" && claudeError ? (
        <p className="text-sm text-amber-200">{claudeError}</p>
      ) : null}
    </div>
  );
}
