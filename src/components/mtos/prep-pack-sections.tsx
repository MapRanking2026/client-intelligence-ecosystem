import type {
  AdsPerformancePack,
  BusinessScorecard,
  ClientParticipation,
  IssueSolutionItem,
  ScorecardMetric,
  SeoPerformancePack,
  StrategicActionStatus,
} from "@/src/lib/mtos-data";

function formatMetric(metric: ScorecardMetric) {
  if (metric.value === null) {
    return "Not available";
  }
  if (metric.unit === "currency") {
    return `$${metric.value.toLocaleString()}`;
  }
  if (metric.unit === "percent") {
    return `${metric.value}%`;
  }
  return metric.value.toLocaleString();
}

function deltaLabel(value: number | null, previousValue: number | null) {
  if (value === null || previousValue === null) {
    return null;
  }
  const diff = value - previousValue;
  if (diff === 0) {
    return "Flat vs. prior period";
  }
  return `${diff > 0 ? "+" : ""}${diff} vs. prior period`;
}

export function ScorecardGrid({ scorecard }: { scorecard: BusinessScorecard }) {
  const metrics = [
    scorecard.totalLeads,
    scorecard.qualifiedLeads,
    scorecard.bookedJobs,
    scorecard.formSubmissions,
    scorecard.callsAnswered,
    scorecard.callsMissed,
    scorecard.costPerLead,
    scorecard.shareOfLocalVoice,
    scorecard.top3Coverage,
    scorecard.mapCheckIns,
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {metrics.map((item) => {
        const delta = deltaLabel(item.value, item.previousValue);
        return (
          <div
            key={item.label}
            className={`rounded-2xl border px-4 py-3 ${
              item.availability === "available" ? "border-white/8 bg-white/4" : "border-white/8 bg-black/20"
            }`}
          >
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{item.label}</p>
            <p
              className={`mt-2 text-lg font-semibold ${
                item.availability === "available" ? "text-white" : "text-slate-500"
              }`}
            >
              {formatMetric(item)}
            </p>
            {delta ? <p className="mt-1 text-xs text-slate-400">{delta}</p> : null}
            <p className="mt-1 text-[11px] text-slate-500">{item.source}</p>
          </div>
        );
      })}
    </div>
  );
}

export function SeoPerformancePanel({ seo }: { seo: SeoPerformancePack }) {
  return (
    <div className="space-y-4">
      {seo.matchedBusinesses.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {seo.matchedBusinesses.map((business) => (
            <div key={`${business.businessName}-${business.placeId}`} className="rounded-2xl border border-white/8 bg-white/4 p-4">
              <p className="text-sm font-semibold text-white">{business.businessName}</p>
              <p className="mt-1 text-xs text-slate-400">{business.address || "Address not on file"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-300">
                <span>{business.rating ?? "n/a"}★ rating</span>
                <span>{business.reviews ?? "n/a"} reviews</span>
                <span>{business.keywords.length} keywords tracked</span>
              </div>
              {business.keywords.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {business.keywords.slice(0, 6).map((keyword) => (
                    <span key={keyword} className="rounded-full border border-white/8 bg-black/20 px-2 py-1 text-[11px] text-slate-300">
                      {keyword}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {seo.gbpPerformance.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {seo.gbpPerformance.map((row) => (
            <div key={row.locationId} className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                GBP performance -- {row.periodStart} to {row.periodEnd}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-200">
                <span>
                  Calls: {row.calls} ({row.previous.calls} prior)
                </span>
                <span>
                  Directions: {row.directionRequests} ({row.previous.directionRequests} prior)
                </span>
                <span>
                  Website clicks: {row.websiteClicks} ({row.previous.websiteClicks} prior)
                </span>
                <span>
                  Searches: {row.searches} ({row.previous.searches} prior)
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {seo.notes.length ? (
        <div className="space-y-2">
          {seo.notes.map((note) => (
            <div key={note} className="rounded-2xl border border-amber-400/15 bg-amber-500/8 px-4 py-3 text-sm text-amber-100">
              {note}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AdsPerformancePanel({ ads }: { ads: AdsPerformancePack[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {ads.map((channel) => (
        <div key={channel.channel} className="rounded-2xl border border-white/8 bg-white/4 p-4">
          <p className="text-sm font-semibold text-white">{channel.channel}</p>
          {channel.connected ? (
            <div className="mt-2 text-sm text-slate-200">
              Spend ${channel.spend ?? "n/a"} -- {channel.leads ?? "n/a"} leads -- CPL ${channel.costPerLead ?? "n/a"}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-400">{channel.benchmarkNote}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function StrategicActionPanel({ action }: { action: StrategicActionStatus }) {
  if (!action.hasAgreedAction) {
    return (
      <div className="rounded-2xl border border-white/8 bg-black/20 p-5 text-sm text-slate-300">
        {action.nextSteps}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 p-5">
      <p className="text-sm font-semibold text-white">{action.title}</p>
      <p className="mt-1 text-xs text-slate-400">Agreed {action.agreedAt}</p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full bg-emerald-400"
          style={{ width: `${Math.min(Math.max(action.implementationPercent, 0), 100)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-slate-400">{action.implementationPercent}% implemented</p>
      {action.resultsSoFar ? <p className="mt-3 text-sm text-slate-200">{action.resultsSoFar}</p> : null}
      {action.nextSteps ? <p className="mt-2 text-sm text-slate-300">Next: {action.nextSteps}</p> : null}
    </div>
  );
}

export function ParticipationChecklist({ participation }: { participation: ClientParticipation }) {
  return (
    <div className="space-y-2">
      {participation.items.map((item) => (
        <div
          key={item.label}
          className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/4 px-4 py-3"
        >
          <span className="text-sm text-slate-200">{item.label}</span>
          <span
            className={`text-xs font-semibold uppercase tracking-[0.2em] ${
              item.inPlace ? "text-emerald-300" : "text-rose-300"
            }`}
          >
            {item.inPlace ? "In place" : "Gap"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function IssuesSolutionsList({ items }: { items: IssueSolutionItem[] }) {
  if (!items.length) {
    return (
      <div className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-300">
        No issues identified for this cycle.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.issue} className="rounded-2xl border border-rose-400/10 bg-rose-500/8 p-4">
          <p className="text-sm font-semibold text-rose-100">{item.issue}</p>
          <p className="mt-1 text-sm text-slate-200">{item.businessImpact}</p>
          <p className="mt-2 text-sm text-emerald-200">Solution: {item.solution}</p>
          <p className="mt-1 text-xs text-slate-400">
            Owner: {item.owner} -- Due: {item.dueDate}
          </p>
        </div>
      ))}
    </div>
  );
}

export function LeadQualityQuestionList({ questions }: { questions: string[] }) {
  return (
    <div className="space-y-2">
      {questions.map((question) => (
        <div key={question} className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-200">
          {question}
        </div>
      ))}
    </div>
  );
}

export function RecapQuestionList({ questions }: { questions: { question: string; answer: string }[] }) {
  return (
    <div className="space-y-2">
      {questions.map((item) => (
        <div key={item.question} className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
          <p className="text-sm font-semibold text-white">{item.question}</p>
          <p className="mt-1 text-xs text-slate-500">Capture live during the recap (Step 6).</p>
        </div>
      ))}
    </div>
  );
}

export function DataGapsBanner({ gaps }: { gaps: string[] }) {
  if (!gaps.length) {
    return null;
  }

  return (
    <div className="space-y-2 rounded-[24px] border border-amber-400/15 bg-amber-500/8 p-5">
      <p className="text-[11px] uppercase tracking-[0.24em] text-amber-200">Missing before the call</p>
      {gaps.map((gap) => (
        <p key={gap} className="text-sm text-amber-100">
          {gap}
        </p>
      ))}
    </div>
  );
}
