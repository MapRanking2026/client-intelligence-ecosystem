import { AlertTriangle, Radar, Sparkles } from "lucide-react";

import { cn } from "@/src/lib/utils";

interface AiVisibilityCardProps {
  compact?: boolean;
}

const metrics = [
  {
    label: "AI search visibility",
    value: "Data Not Available",
    detail: "No connected AI search signals are available yet.",
    tone: "warning" as const,
  },
  {
    label: "Review and citation signal",
    value: "Data Not Available",
    detail: "Review sources have not been connected for this client.",
    tone: "warning" as const,
  },
  {
    label: "Local ranking movement",
    value: "Data Not Available",
    detail: "Ranking data is not available from a connected tracker.",
    tone: "warning" as const,
  },
  {
    label: "Opportunity confidence",
    value: "Low confidence",
    detail: "MTOS will only surface verified opportunities with connected evidence.",
    tone: "neutral" as const,
  },
];

export function AiVisibilityCard({ compact = false }: AiVisibilityCardProps) {
  return (
    <div className={cn("rounded-[24px] border border-white/8 bg-black/20", compact ? "p-4" : "p-5") }>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-[#d7f5ec]/15 p-2.5 text-[#d7f5ec]">
            <Radar className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">AI Visibility</p>
            <h3 className="text-lg font-semibold text-white">Connected evidence only</h3>
          </div>
        </div>
        <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-slate-300">
          MTOS
        </div>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-300">
        MTOS measures what is connected. If a signal cannot be verified, the system shows “Data Not Available” instead of estimating a result.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className={cn(
              "rounded-2xl border px-4 py-3",
              metric.tone === "warning"
                ? "border-amber-400/15 bg-amber-500/10"
                : "border-white/8 bg-white/4",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-white">{metric.label}</p>
              {metric.tone === "warning" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-200" />
              ) : (
                <Sparkles className="mt-0.5 h-4 w-4 text-[#d7f5ec]" />
              )}
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-100">{metric.value}</p>
            <p className="mt-1 text-sm text-slate-400">{metric.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
