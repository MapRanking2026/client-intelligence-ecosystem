"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";

import { LEAD_CHANNEL_LABEL, LEAD_WINDOW_LABEL } from "@/src/lib/mtos-data";
import type { LeadVerificationReview, LeadWindowInput, LeadWindowPreset } from "@/src/lib/mtos-data";

const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
};

const WINDOW_OPTIONS = Object.keys(LEAD_WINDOW_LABEL) as LeadWindowPreset[];

interface LeadVerificationQuickActionsProps {
  clientId: string;
  initialReview: LeadVerificationReview | null;
}

interface VerifyResponse {
  data?: LeadVerificationReview | null;
  error?: string;
}

function formatGeneratedAt(value?: string) {
  if (!value) {
    return "Not run yet";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not run yet";
  }
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function LeadVerificationQuickActions({ clientId, initialReview }: LeadVerificationQuickActionsProps) {
  const [review, setReview] = useState<LeadVerificationReview | null>(initialReview);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Pull window — defaults to a rolling last 30 days.
  const [windowPreset, setWindowPreset] = useState<LeadWindowPreset>("last_30_days");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");

  function buildWindow(): LeadWindowInput {
    if (windowPreset === "custom") {
      return { preset: "custom", since: customSince || undefined, until: customUntil || undefined };
    }
    return { preset: windowPreset };
  }

  const customIncomplete = windowPreset === "custom" && !customSince;

  function runVerify() {
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch(`/api/clients/${clientId}/lead-verification`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "verify", window: buildWindow() }),
        });
        const payload = (await response.json()) as VerifyResponse;
        if (!response.ok) {
          throw new Error(payload.error || "Unable to verify leads");
        }
        setReview(payload.data ?? null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to verify leads");
      }
    });
  }

  const totals = review?.totals;
  const warnings = review?.warnings ?? [];

  return (
    <div className="space-y-4 rounded-[24px] border border-white/8 bg-black/20 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
            Quick verify
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Last run: {formatGeneratedAt(review?.generatedAt)}
            {review?.source === "claude" && review.provider
              ? ` · via ${PROVIDER_LABEL[review.provider] || review.provider}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/4 px-3 py-2 text-xs text-slate-300">
            <span className="uppercase tracking-[0.14em] text-slate-500">Period</span>
            <select
              value={windowPreset}
              onChange={(event) => setWindowPreset(event.target.value as LeadWindowPreset)}
              className="bg-transparent text-sm font-medium text-slate-100 outline-none [&>option]:bg-[#0b1524]"
            >
              {WINDOW_OPTIONS.map((preset) => (
                <option key={preset} value={preset}>
                  {LEAD_WINDOW_LABEL[preset]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={runVerify}
            disabled={isPending || customIncomplete}
            style={{ color: "#0d1625" }}
            className="inline-flex items-center gap-2 rounded-full border border-[#d7f5ec]/20 bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0d1625] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Verify leads &amp; calls
          </button>
        </div>
      </div>

      {windowPreset === "custom" ? (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/4 px-3 py-1.5 text-xs text-slate-300">
          <input
            type="date"
            value={customSince}
            max={customUntil || undefined}
            onChange={(event) => setCustomSince(event.target.value)}
            className="bg-transparent text-sm text-slate-100 outline-none [color-scheme:dark]"
          />
          <span className="text-slate-500">→</span>
          <input
            type="date"
            value={customUntil}
            min={customSince || undefined}
            onChange={(event) => setCustomUntil(event.target.value)}
            className="bg-transparent text-sm text-slate-100 outline-none [color-scheme:dark]"
          />
        </div>
      ) : null}

      {totals ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryPill label="Valid" value={totals.valid} tone="emerald" />
          <SummaryPill label="Flagged" value={totals.flagged} tone="rose" />
          <SummaryPill label="Needs review" value={totals.needsReview} tone="amber" />
          <SummaryPill label="Missed calls" value={totals.missedCalls ?? 0} tone="sky" />
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          Run a quick check to vet this client&apos;s leads, calls, and form submissions and reconcile the
          counts across sources.
        </p>
      )}

      {review?.byChannel.length ? (
        <div className="flex flex-wrap gap-2">
          {review.byChannel.map((row) => (
            <span
              key={row.channel}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/4 px-3 py-1 text-xs text-slate-300"
            >
              {LEAD_CHANNEL_LABEL[row.channel]}
              <span className="font-semibold text-white">{row.total}</span>
            </span>
          ))}
        </div>
      ) : null}

      {warnings.length ? (
        <div className="space-y-2">
          {warnings.slice(0, 2).map((warning) => (
            <p key={warning} className="flex items-start gap-2 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{warning}</span>
            </p>
          ))}
        </div>
      ) : null}

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      <Link
        href={`/clients/${clientId}/lead-verification`}
        className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/4 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/8"
      >
        Open full verification
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "rose" | "amber" | "sky";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
      : tone === "rose"
        ? "border-rose-400/20 bg-rose-500/10 text-rose-100"
        : tone === "sky"
          ? "border-sky-400/20 bg-sky-500/10 text-sky-100"
          : "border-amber-400/20 bg-amber-500/10 text-amber-100";
  return (
    <div className={`rounded-2xl border px-4 py-3 text-center ${toneClass}`}>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-[0.18em] opacity-80">{label}</p>
    </div>
  );
}
