import Link from "next/link";

import { AppShell } from "@/src/components/mtos/app-shell";
import { SectionCard } from "@/src/components/mtos/section-card";
import { ScorePill } from "@/src/components/mtos/score-pill";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getQaClientIndexView } from "@/src/lib/server/services/qa-service";

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

export default async function QaPage() {
  const { cards } = await getQaClientIndexView(await resolveTenantContext());

  return (
    <AppShell
      title="Quality And Coaching"
      subtitle="Review Monthly Touch quality by client first, then drill into each recorded meeting for score trends, sentiment movement, and coaching opportunities."
    >
      <SectionCard
        eyebrow="Client quality index"
        title="Clients with recorded Monthly Touch reviews"
        subtitle="Each client card shows the average QA result, retention risk, current sentiment signal, and how many Monthly Touch reviews are already on file."
      >
        <div className="grid gap-4 xl:grid-cols-3">
          {cards.map((item) => (
            <Link
              key={item.client.id}
              href={`/qa/${item.client.id}`}
              className="rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.025))] p-5 transition hover:-translate-y-0.5 hover:border-white/16"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-white">{item.client.name}</p>
                  <p className="text-sm text-slate-400">{item.client.industry}</p>
                </div>
                <div className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-100">
                  Connected
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <ScorePill label="Avg QA" value={item.averageQaScore ?? "--"} tone={toneForScore(item.averageQaScore)} />
                <ScorePill label="Retention risk" value={item.retentionRisk} tone={toneForRisk(item.retentionRisk)} />
                <ScorePill label="Sentiment" value={item.averageSentimentScore} tone={toneForScore(item.averageSentimentScore)} />
                <ScorePill label="Meetings" value={item.meetingsRecorded} tone="neutral" />
              </div>

              <p className="mt-4 text-sm leading-6 text-slate-300">{item.client.summary}</p>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>Latest grade {item.latestGrade}</span>
                <span>•</span>
                <span>{item.latestTouchDate}</span>
              </div>
            </Link>
          ))}
        </div>
      </SectionCard>
    </AppShell>
  );
}
