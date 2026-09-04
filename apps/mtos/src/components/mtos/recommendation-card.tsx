import type { RecommendationItem } from "@/src/lib/mtos-data";

const confidenceClasses = {
  High: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  Medium: "border-amber-400/30 bg-amber-500/10 text-amber-100",
  Low: "border-rose-400/30 bg-rose-500/10 text-rose-100",
};

export function RecommendationCard({ item }: { item: RecommendationItem }) {
  return (
    <article className="rounded-[24px] border border-white/10 bg-black/15 p-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-white">{item.title}</h3>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClasses[item.confidence]}`}
          >
            {item.confidence} confidence
          </span>
        </div>
        <p className="text-sm leading-6 text-slate-300">{item.summary}</p>
        <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Reasoning</p>
          <p className="mt-2 text-sm leading-6 text-slate-200">{item.rationale}</p>
        </div>
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Evidence</p>
          <div className="grid gap-3">
            {item.evidence.map((evidence) => (
              <div
                key={`${item.id}-${evidence.label}`}
                className="rounded-2xl border border-white/8 bg-white/3 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-white">{evidence.label}</p>
                  <span className="text-xs text-slate-400">{evidence.freshness}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{evidence.source}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
