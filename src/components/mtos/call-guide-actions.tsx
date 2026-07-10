"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";

import type { CallGuide } from "@/src/lib/mtos-data";

interface CallGuideActionsProps {
  touchId: string;
  callGuide?: CallGuide;
}

interface CallGuideResponse {
  data?: {
    touch?: {
      callGuide?: CallGuide;
    };
  };
  error?: string;
}

export function CallGuideActions({ touchId, callGuide }: CallGuideActionsProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function generate() {
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch(`/api/monthly-touches/${touchId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "generate_call_guide" }),
        });
        const payload = (await response.json()) as CallGuideResponse;

        if (!response.ok) {
          throw new Error(payload.error || "Unable to generate the call guide");
        }

        globalThis.location.reload();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to generate the call guide");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-white/8 bg-black/20 p-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Live call guide</p>
          <p className="mt-1 text-sm text-slate-300">
            {callGuide?.status === "generated"
              ? `Generated ${callGuide.source === "claude" ? "with Claude" : "from the prep pack"} -- follow the timed sections below during the call.`
              : "Generate a timed, 60-minute guide from the prep pack before the call starts."}
          </p>
          {callGuide?.errorMessage ? <p className="mt-1 text-xs text-amber-200">{callGuide.errorMessage}</p> : null}
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={isPending}
          style={{ color: "#0d1625" }}
          className="inline-flex items-center gap-2 rounded-full border border-[#d7f5ec]/20 bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0d1625] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {callGuide?.status === "generated" ? "Regenerate guide" : "Generate call guide"}
        </button>
      </div>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      {callGuide?.status === "generated" ? (
        <div className="space-y-3">
          {callGuide.sections.map((section, index) => (
            <div key={`${section.title}-${index}`} className="rounded-2xl border border-white/8 bg-white/4 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">{section.title}</p>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
                  {section.minutes} min
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {section.talkingPoints.map((point) => (
                  <div key={point} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-sm text-slate-200">
                    {point}
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                {section.clientPrompts.map((prompt) => (
                  <div
                    key={prompt}
                    className="rounded-xl border border-[#d7f5ec]/15 bg-[#d7f5ec]/5 px-3 py-2 text-sm text-[#d7f5ec]"
                  >
                    Ask the client: {prompt}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
