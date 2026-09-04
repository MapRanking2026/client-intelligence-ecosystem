import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/src/components/mtos/app-shell";
import { ScorePill } from "@/src/components/mtos/score-pill";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getQaClientDetailView } from "@/src/lib/server/services/qa-service";

function toneForRisk(risk: "Low" | "Moderate" | "High") {
  if (risk === "Low") return "positive" as const;
  if (risk === "Moderate") return "warning" as const;
  return "danger" as const;
}

function toneForScore(score: number | null) {
  if (score === null) return "neutral" as const;
  if (score >= 85) return "positive" as const;
  if (score >= 70) return "warning" as const;
  return "danger" as const;
}

export default async function QaClientDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const payload = await getQaClientDetailView(await resolveTenantContext(), clientId);

  if (!payload) {
    notFound();
  }

  return (
    <AppShell
      title={`${payload.client.name} QA & Coaching`}
      subtitle="Review this client's Monthly Touch history, overall QA trend, sentiment movement, and meeting-level evaluations without extra clutter."
    >
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard
          eyebrow="Client overview"
          title="Quality trend and relationship view"
          subtitle="Track the average QA score, sentiment movement, and retention signal for this client across recorded Monthly Touches."
          aside={
            <div className="flex flex-wrap gap-2">
              <ScorePill label="Avg QA" value={payload.averageQaScore ?? "--"} tone={toneForScore(payload.averageQaScore)} />
              <ScorePill label="Retention risk" value={payload.retentionRisk} tone={toneForRisk(payload.retentionRisk)} />
            </div>
          }
        >
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[24px] border border-white/8 bg-white/4 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Average sentiment</p>
              <p className="mt-2 text-3xl font-semibold text-white">{payload.averageSentimentScore}</p>
              <p className="mt-2 text-sm text-slate-300">A blended relationship signal based on health, sentiment, and meeting quality.</p>
            </div>
            <div className="rounded-[24px] border border-white/8 bg-white/4 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Meetings recorded</p>
              <p className="mt-2 text-3xl font-semibold text-white">{payload.meetingsRecorded}</p>
              <p className="mt-2 text-sm text-slate-300">Recorded Monthly Touches available for quality review and coaching.</p>
            </div>
            <div className="rounded-[24px] border border-white/8 bg-white/4 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Latest grade</p>
              <p className="mt-2 text-3xl font-semibold text-white">{payload.latestGrade}</p>
              <p className="mt-2 text-sm text-slate-300">Most recent evaluated Monthly Touch for this client.</p>
            </div>
          </div>

          <div className="mt-5 rounded-[24px] border border-white/8 bg-black/20 p-5">
            <div className="flex items-end gap-3">
              {payload.touches.map((touch) => (
                <div key={touch.id} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-2xl bg-[#d7f5ec]"
                    style={{ height: `${Math.max(52, Math.round(touch.sentimentScore * 1.5))}px` }}
                  />
                  <div className="text-center">
                    <p className="text-xs font-medium text-white">{touch.sentimentLabel}</p>
                    <p className="text-[11px] text-slate-400">{touch.touchDate}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Client context"
          title="What the AM needs to watch"
          subtitle="Keep the focus on client relationship reality, not on internal background explanations."
        >
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/8 bg-white/4 p-4 text-sm text-slate-200">{payload.client.summary}</div>
            <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Top risks</p>
              <div className="mt-3 space-y-2">
                {payload.client.topRisks.map((risk) => (
                  <div key={risk} className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-sm text-slate-200">
                    {risk}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              QA engine connected
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        eyebrow="Monthly Touch history"
        title="Recorded Monthly Touch reviews"
        subtitle="Open any recorded Monthly Touch to see the final evaluation score, prep state, analysis state, and detailed QA dimension breakdown."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          {payload.touches.map((touch) => (
            <Link
              key={touch.id}
              href={`/qa/${payload.client.id}/${touch.id}`}
              className="rounded-[24px] border border-white/8 bg-white/4 p-5 transition hover:border-white/16 hover:bg-white/8"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-white">{touch.touchDate}</p>
                  <p className="text-sm text-slate-400">{touch.status} · QA {touch.qaStatus.replaceAll("_", " ")}</p>
                </div>
                <ScorePill label="Score" value={touch.overallScore ?? "--"} tone={toneForScore(touch.overallScore)} />
              </div>

              <p className="mt-4 text-sm leading-6 text-slate-300">{touch.summary}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                <ScorePill label="Grade" value={touch.overallGrade} tone="neutral" />
                <ScorePill label="Sentiment" value={touch.sentimentLabel} tone={toneForScore(touch.sentimentScore)} />
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-xs text-slate-300">
                  Prep {touch.prepReady ? "ready" : "missing"}
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-xs text-slate-300">
                  Analysis {touch.postMeetingReady ? "ready" : "pending"}
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-xs text-slate-300">
                  QA {touch.qaReady ? "scored" : "not scored"}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </SectionCard>
    </AppShell>
  );
}
