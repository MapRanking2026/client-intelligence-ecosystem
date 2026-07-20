import type {
  AdsPerformancePack,
  BusinessScorecard,
  ClientParticipation,
  HeatmapComparison,
  HeatmapGrid,
  IssueSolutionItem,
  KeywordScanHistory,
  RankTrackerProfileEvidence,
  ScorecardMetric,
  SeoPerformancePack,
  StrategicActionStatus,
} from "@/src/lib/mtos-data";

function rankFill(rank: number | null) {
  if (rank === null) return "#475569";
  if (rank <= 3) return "#34d399";
  if (rank <= 10) return "#fbbf24";
  if (rank <= 20) return "#fb923c";
  return "#f87171";
}

function HeatmapGridSvg({ grid }: { grid: HeatmapGrid }) {
  const pins = grid.pins;
  if (!pins.length) {
    return null;
  }

  const lats = pins.map((pin) => pin.lat);
  const lngs = pins.map((pin) => pin.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const size = 200;
  const pad = 14;
  const scaleX = (lng: number) =>
    maxLng === minLng ? size / 2 : pad + ((lng - minLng) / (maxLng - minLng)) * (size - pad * 2);
  const scaleY = (lat: number) =>
    maxLat === minLat ? size / 2 : size - (pad + ((lat - minLat) / (maxLat - minLat)) * (size - pad * 2));
  const radius = Math.max(5, Math.floor((size - pad * 2) / (grid.gridSize || 9) / 2.4));

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-44 w-full rounded-xl bg-black/30" role="img" aria-label={`Heatmap for ${grid.keyword}`}>
      {pins.map((pin, index) => (
        <g key={index}>
          <circle cx={scaleX(pin.lng)} cy={scaleY(pin.lat)} r={radius} fill={rankFill(pin.rank)} fillOpacity={0.9} />
          <text
            x={scaleX(pin.lng)}
            y={scaleY(pin.lat)}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={radius}
            fill="#0b1220"
            fontWeight={700}
          >
            {pin.rank === null ? "–" : pin.rank > 20 ? "20+" : pin.rank}
          </text>
        </g>
      ))}
    </svg>
  );
}

function scanTrendArrow(scans: KeywordScanHistory["scans"]) {
  const latest = scans[0]?.averageRank;
  const previous = scans[1]?.averageRank;
  if (latest == null || previous == null) {
    return { glyph: "", color: "text-slate-400" };
  }
  if (latest < previous) return { glyph: "▲ improving", color: "text-emerald-300" };
  if (latest > previous) return { glyph: "▼ declining", color: "text-rose-300" };
  return { glyph: "— flat", color: "text-slate-400" };
}

function formatScanDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatPostDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "12 days ago" reads faster than a date when the question is whether a client has gone quiet. */
function describePostRecency(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function formatPlatform(value: string) {
  return value.replace(/_/g, " ");
}

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

function KeywordScanTable({ entries, showBusiness }: { entries: KeywordScanHistory[]; showBusiness?: boolean }) {
  if (!entries.length) {
    return null;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/8 bg-black/20">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-white/8 text-[11px] uppercase tracking-[0.2em] text-slate-400">
            <th className="px-4 py-3 font-medium">Keyword</th>
            <th className="px-4 py-3 font-medium">Avg rank</th>
            <th className="px-4 py-3 font-medium">Top-3 pins</th>
            <th className="px-4 py-3 font-medium">Market share</th>
            <th className="px-4 py-3 font-medium">Trend</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const latest = entry.scans[0];
            const previous = entry.scans[1];
            const trend = scanTrendArrow(entry.scans);
            return (
              <tr key={`${entry.businessName}-${entry.keyword}`} className="border-b border-white/4 text-slate-200">
                <td className="px-4 py-3">
                  <span className="font-medium text-white">{entry.keyword}</span>
                  {showBusiness ? <span className="ml-2 text-xs text-slate-500">{entry.businessName}</span> : null}
                  {latest?.scanDate ? (
                    <span className="ml-2 text-xs text-slate-500">scanned {formatScanDate(latest.scanDate)}</span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  {latest?.averageRank ?? "n/a"}
                  {previous?.averageRank != null ? (
                    <span className="ml-1 text-xs text-slate-500">(was {previous.averageRank})</span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  {latest?.top3Pins ?? "n/a"}
                  {previous?.top3Pins != null ? (
                    <span className="ml-1 text-xs text-slate-500">(was {previous.top3Pins})</span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  {latest?.marketSharePercent != null ? `${latest.marketSharePercent}%` : "n/a"}
                  {previous?.marketSharePercent != null ? (
                    <span className="ml-1 text-xs text-slate-500">(was {previous.marketSharePercent}%)</span>
                  ) : null}
                </td>
                <td className={`px-4 py-3 text-xs ${trend.color}`}>{trend.glyph}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function comparisonDelta(current: number | null, previous: number | null, lowerIsBetter = false) {
  if (current === null || previous === null) {
    return null;
  }
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) {
    return { text: "flat", color: "text-slate-400" };
  }
  const improved = lowerIsBetter ? diff < 0 : diff > 0;
  return {
    text: `${diff > 0 ? "+" : ""}${diff}`,
    color: improved ? "text-emerald-300" : "text-rose-300",
  };
}

function HeatmapComparisonCard({ comparison }: { comparison: HeatmapComparison }) {
  const { current, previous } = comparison;
  const solvDelta = comparisonDelta(current.shareOfLocalVoicePercent, previous?.shareOfLocalVoicePercent ?? null);
  const arpDelta = comparisonDelta(current.averageRankPosition, previous?.averageRankPosition ?? null, true);

  return (
    <div className="rounded-2xl border border-white/8 bg-white/4 p-3">
      <p className="px-1 text-sm font-semibold text-white">{comparison.keyword}</p>
      <div className={`mt-2 grid gap-2 ${previous ? "grid-cols-2" : "grid-cols-1"}`}>
        {previous ? (
          <div>
            <HeatmapGridSvg grid={previous} />
            <p className="mt-1 px-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
              Previous -- {formatScanDate(previous.scanDate)}
            </p>
            <p className="px-1 text-xs text-slate-400">
              ARP {previous.averageRankPosition ?? "n/a"} · SoLV {previous.shareOfLocalVoicePercent ?? "n/a"}%
            </p>
          </div>
        ) : null}
        <div>
          <HeatmapGridSvg grid={current} />
          <p className="mt-1 px-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Current -- {formatScanDate(current.scanDate)}
          </p>
          <p className="px-1 text-xs text-slate-300">
            ARP {current.averageRankPosition ?? "n/a"}
            {arpDelta ? <span className={`ml-1 ${arpDelta.color}`}>({arpDelta.text})</span> : null}
            {" · "}SoLV {current.shareOfLocalVoicePercent ?? "n/a"}%
            {solvDelta ? <span className={`ml-1 ${solvDelta.color}`}>({solvDelta.text})</span> : null}
          </p>
        </div>
      </div>
      {!previous ? (
        <p className="mt-1 px-1 text-[11px] text-slate-500">No earlier scan available for comparison yet.</p>
      ) : null}
      {current.topCompetitors.length ? (
        <p className="mt-2 px-1 text-[11px] text-slate-500">
          Top competitors: {current.topCompetitors.map((c) => `${c.name} (${c.rating ?? "n/a"}★, ${c.reviews ?? "n/a"} rev)`).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function ProfileEvidenceBlock({ profile }: { profile: RankTrackerProfileEvidence }) {
  const { business } = profile;
  return (
    <div className="space-y-3 rounded-[24px] border border-white/8 bg-black/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{business.businessName}</p>
          <p className="mt-1 text-xs text-slate-400">{business.address || "Address not on file"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
          <span>{business.rating ?? "n/a"}★ rating</span>
          <span>{business.reviews ?? "n/a"} reviews</span>
          <span>{profile.keywordScans.length} keywords tracked</span>
          <span className="rounded-full border border-emerald-400/25 bg-emerald-500/12 px-2 py-1 font-semibold uppercase tracking-[0.18em] text-emerald-200">
            Active
          </span>
        </div>
      </div>
      <KeywordScanTable entries={profile.keywordScans} />
      {profile.heatmapComparisons.length ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {profile.heatmapComparisons.map((comparison) => (
            <HeatmapComparisonCard key={`${comparison.keyword}-${comparison.current.scanDate}`} comparison={comparison} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SeoPerformancePanel({ seo }: { seo: SeoPerformancePack }) {
  const profiles = seo.profiles || [];
  const activeProfiles = profiles.filter((profile) => profile.status === "active");
  const inactiveProfiles = profiles.filter((profile) => profile.status === "inactive");
  const hasProfileView = profiles.length > 0;

  return (
    <div className="space-y-4">
      {inactiveProfiles.length ? (
        <div className="space-y-2 rounded-[24px] border border-rose-400/15 bg-rose-500/8 p-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-rose-200">Suspended / inactive profiles</p>
          {inactiveProfiles.map((profile) => (
            <p key={`${profile.business.businessName}-${profile.business.placeId}`} className="text-sm text-rose-100">
              <span className="font-semibold">{profile.business.businessName}</span>
              {profile.business.address ? ` — ${profile.business.address}` : ""}: {profile.statusNote}
            </p>
          ))}
        </div>
      ) : null}

      {hasProfileView ? (
        activeProfiles.map((profile) => (
          <ProfileEvidenceBlock key={`${profile.business.businessId}`} profile={profile} />
        ))
      ) : (
        <>
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
                </div>
              ))}
            </div>
          ) : null}

          <KeywordScanTable entries={seo.keywordScanHistory} showBusiness />

          {seo.heatmapGrids.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {seo.heatmapGrids.map((grid) => (
                <div key={`${grid.keyword}-${grid.scanDate}`} className="rounded-2xl border border-white/8 bg-white/4 p-3">
                  <HeatmapGridSvg grid={grid} />
                  <div className="space-y-1 px-1 pt-3">
                    <p className="text-sm font-semibold text-white">{grid.keyword}</p>
                    <p className="text-xs text-slate-400">
                      Scanned {formatScanDate(grid.scanDate)} -- {grid.gridSize}x{grid.gridSize} grid
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                      <span>ARP {grid.averageRankPosition ?? "n/a"}</span>
                      <span>SoLV {grid.shareOfLocalVoicePercent ?? "n/a"}%</span>
                      <span>Top-3 {grid.top3Percent ?? "n/a"}%</span>
                    </div>
                    {grid.topCompetitors.length ? (
                      <p className="pt-1 text-[11px] text-slate-500">
                        Top competitors: {grid.topCompetitors.map((c) => `${c.name} (${c.rating ?? "n/a"}★, ${c.reviews ?? "n/a"} rev)`).join(" · ")}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}

      {seo.checkinBusinesses.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {seo.checkinBusinesses.map((business) => (
            <div key={business.businessName} className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Map Check-Ins</p>
              <p className="mt-1 text-sm font-semibold text-white">{business.businessName}</p>
              <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-200">
                <span>{business.totalPosts} posts published</span>
                <span>{business.scheduledPosts} scheduled</span>
              </div>
              <p className="mt-2 text-sm text-slate-200">
                {business.lastPostAt ? (
                  <>
                    Last post{" "}
                    <span className="font-semibold text-white">{formatPostDate(business.lastPostAt)}</span>
                    <span className="text-slate-400">
                      {" "}
                      ({describePostRecency(business.lastPostAt)}
                      {business.lastPostPlatform ? ` · ${formatPlatform(business.lastPostPlatform)}` : ""})
                    </span>
                  </>
                ) : (
                  <span className="text-slate-400">No post published yet</span>
                )}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {business.nextScheduledPostAt
                  ? `Next scheduled ${formatPostDate(business.nextScheduledPostAt)}`
                  : "Nothing scheduled next"}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Connected: {business.connectedPlatforms.length ? business.connectedPlatforms.join(", ") : "no platforms connected"}
              </p>
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
