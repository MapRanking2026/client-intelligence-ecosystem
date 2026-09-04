"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, Sparkles, MonitorPlay, ArrowUpRight } from "lucide-react";

import type { CallGuide, CallGuideSection } from "@/src/lib/mtos-data";

interface CallGuideActionsProps {
  touchId: string;
  clientId: string;
  callGuide?: CallGuide;
  /** AM overrides: section index → screen key. */
  screenOverrides?: Record<string, string>;
}

interface CallGuideResponse {
  data?: { touch?: { callGuide?: CallGuide } };
  error?: string;
}

type ScreenKey = "performance" | "leads" | "intelligence" | "plan" | "promises" | "overview" | "runsheet";

const SCREENS: Record<ScreenKey, { label: string; tab?: string }> = {
  performance: { label: "Performance & rankings", tab: "performance" },
  leads: { label: "Leads & Calls", tab: "leads" },
  intelligence: { label: "Opportunities & risks", tab: "intelligence" },
  plan: { label: "The plan", tab: "plan" },
  promises: { label: "Commitments", tab: "promises" },
  overview: { label: "Client overview", tab: "overview" },
  runsheet: { label: "Run-sheet (five questions)" },
};
const SCREEN_KEYS = Object.keys(SCREENS) as ScreenKey[];

function hrefFor(key: ScreenKey, clientId: string, touchId: string): string {
  const s = SCREENS[key];
  return s.tab ? `/clients/${clientId}?tab=${s.tab}` : `/monthly-touch/${touchId}`;
}

/** Deterministic default screen for a section, scanned from its own text so it works
 *  regardless of how the section was titled. The AM can override it. */
function suggestScreenKey(section: CallGuideSection): ScreenKey {
  const text = [section.title, ...section.talkingPoints, ...section.clientPrompts].join(" ").toLowerCase();
  if (/(missed call|lead quality|\bleads?\b|\bcalls?\b|phone|response time|speed to lead)/.test(text)) return "leads";
  if (/(ranking|visibility|map pack|geo|grid|heatmap|scorecard|performance|\bwins?\b|\bresults?\b|\bseo\b|\bgbp\b|keyword|traffic|market share)/.test(text)) return "performance";
  if (/(opportunit|growth|expansion|upsell|proposal|upgrade|new service)/.test(text)) return "intelligence";
  if (/(\brisk|issue|concern|problem|delay|blocker|churn)/.test(text)) return "intelligence";
  if (/(commitment|promise|action item|deliverable|owe|follow[- ]?up)/.test(text)) return "promises";
  if (/(next|plan|strategy|roadmap|30[- ]?day|next month|going forward)/.test(text)) return "plan";
  if (/(welcome|open|intro|recap|agenda|relationship|rapport|check[- ]?in|who they are)/.test(text)) return "overview";
  return "runsheet";
}

export function CallGuideActions({ touchId, clientId, callGuide, screenOverrides }: CallGuideActionsProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [overrides, setOverrides] = useState<Record<string, string>>(screenOverrides || {});

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
        if (!response.ok) throw new Error(payload.error || "Unable to generate the call guide");
        globalThis.location.reload();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to generate the call guide");
      }
    });
  }

  async function setScreen(index: number, key: ScreenKey) {
    const prev = overrides[String(index)];
    setOverrides((o) => ({ ...o, [String(index)]: key }));
    try {
      const res = await fetch(`/api/monthly-touches/${touchId}/call-guide-screen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sectionIndex: index, screenKey: key }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // revert on failure
      setOverrides((o) => ({ ...o, [String(index)]: prev ?? "" }));
      setError("Couldn't save that screen choice.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-white/8 bg-black/20 p-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Live call guide</p>
          <p className="mt-1 text-sm text-slate-300">
            {callGuide?.status === "generated"
              ? `Generated ${callGuide.source === "claude" ? "with Claude" : "from the prep pack"} -- each section shows the screen to present. Tap a link to open it in a new tab.`
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
          {callGuide.sections.map((section, index) => {
            const key = (overrides[String(index)] as ScreenKey) || suggestScreenKey(section);
            return (
              <div key={`${section.title}-${index}`} className="rounded-2xl border border-white/8 bg-white/4 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{section.title}</p>
                  <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
                    {section.minutes} min
                  </span>
                </div>

                {/* Present-now link + editable screen choice */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <a
                    href={hrefFor(key, clientId, touchId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-[#2dd4bf]/25 bg-[#2dd4bf]/10 px-3 py-2 text-sm font-semibold text-[#2dd4bf] transition hover:bg-[#2dd4bf]/20"
                    title={`Open ${SCREENS[key].label} in a new tab to present`}
                  >
                    <MonitorPlay className="h-4 w-4" />
                    Present now: {SCREENS[key].label}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                    <span className="hidden sm:inline">change screen</span>
                    <select
                      value={key}
                      onChange={(e) => void setScreen(index, e.target.value as ScreenKey)}
                      className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-slate-200 outline-none"
                    >
                      {SCREEN_KEYS.map((k) => (
                        <option key={k} value={k} style={{ color: "#0d1625" }}>{SCREENS[k].label}</option>
                      ))}
                    </select>
                  </label>
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
                    <div key={prompt} className="rounded-xl border border-[#d7f5ec]/15 bg-[#d7f5ec]/5 px-3 py-2 text-sm text-[#d7f5ec]">
                      Ask the client: {prompt}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {callGuide.anticipatedObjections?.length ? (
            <div className="rounded-2xl border border-amber-300/15 bg-amber-300/5 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-200">
                Anticipated objections
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Grounded, non-defensive responses -- ready before the client raises them.
              </p>
              <div className="mt-3 space-y-3">
                {callGuide.anticipatedObjections.map((item, index) => (
                  <div
                    key={`objection-${index}`}
                    className="rounded-xl border border-white/8 bg-black/20 px-3 py-2"
                  >
                    <p className="text-sm font-semibold text-amber-100">&ldquo;{item.objection}&rdquo;</p>
                    <p className="mt-1 text-sm text-slate-200">{item.response}</p>
                    {item.evidence ? (
                      <p className="mt-1 text-xs text-slate-400">Evidence: {item.evidence}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {callGuide.valueTranslations?.length ? (
            <div className="rounded-2xl border border-[#2dd4bf]/15 bg-[#2dd4bf]/5 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#2dd4bf]">
                Say it in business terms
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Translate each metric into what it means for their business.
              </p>
              <div className="mt-3 space-y-2">
                {callGuide.valueTranslations.map((item, index) => (
                  <div
                    key={`value-${index}`}
                    className="rounded-xl border border-white/8 bg-black/20 px-3 py-2"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{item.metric}</p>
                    <p className="mt-1 text-sm text-slate-200">{item.meaning}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
