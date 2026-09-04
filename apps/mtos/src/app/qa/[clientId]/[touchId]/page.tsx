import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/src/components/mtos/app-shell";
import { ScorePill } from "@/src/components/mtos/score-pill";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getQaMeetingDetailView } from "@/src/lib/server/services/qa-service";

function toneForScore(score: number | null) {
  if (score === null) return "neutral" as const;
  if (score >= 85) return "positive" as const;
  if (score >= 70) return "warning" as const;
  return "danger" as const;
}

function starsForScore(score: number) {
  return "★".repeat(Math.max(1, Math.min(5, score)));
}

export default async function QaMeetingDetailPage({
  params,
}: {
  params: Promise<{ clientId: string; touchId: string }>;
}) {
  const { touchId } = await params;
  const payload = await getQaMeetingDetailView(await resolveTenantContext(), touchId);

  if (!payload) {
    notFound();
  }

  const qaReview = payload.touch.qaReview;

  return (
    <AppShell
      title={`${payload.client.name} — Monthly Touch QA Review`}
      subtitle="Review this specific Monthly Touch through a cleaner score-focused layout with expandable evaluation cards and meeting-level context."
    >
      <SectionCard
        eyebrow="Meeting summary"
        title="Overall Monthly Touch result"
        subtitle="The AM should immediately see the total meeting result, sentiment outcome, and whether this review needs attention."
        aside={
          <div className="flex flex-wrap gap-2">
            <ScorePill label="Overall score" value={payload.overallScore ?? "--"} tone={toneForScore(payload.overallScore)} />
            <ScorePill label="Grade" value={qaReview?.overallGrade || "--"} tone="neutral" />
            <ScorePill label="Sentiment" value={payload.sentimentScore} tone={toneForScore(payload.sentimentScore)} />
          </div>
        }
      >
        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[24px] border border-white/8 bg-white/4 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">QA summary</p>
            <p className="mt-3 text-sm leading-7 text-slate-200">{qaReview?.summary || payload.touch.executiveBrief}</p>
            {qaReview?.victorNote ? (
              <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-slate-200">
                {qaReview.victorNote}
              </div>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[24px] border border-white/8 bg-white/4 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Prep status</p>
              <p className="mt-3 text-lg font-semibold text-white">{payload.touch.prepPack ? "Prepared" : "Missing"}</p>
            </div>
            <div className="rounded-[24px] border border-white/8 bg-white/4 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Post-call analysis</p>
              <p className="mt-3 text-lg font-semibold text-white">{payload.touch.postMeeting?.analyzedAt ? "Ready" : "Pending"}</p>
            </div>
            <div className="rounded-[24px] border border-white/8 bg-white/4 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">QA review</p>
              <p className="mt-3 text-lg font-semibold text-white">{qaReview?.status.replaceAll("_", " ") || "not started"}</p>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Evaluation breakdown"
        title="QA dimensions"
        subtitle="Each evaluation point is separated into its own card so the score, stars, and notes are readable without everything feeling bunched together."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(qaReview?.scorecard || []).map((item) => (
            <details key={item.category} className="rounded-[24px] border border-white/8 bg-white/4 p-5">
              <summary className="cursor-pointer list-none">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{item.category}</p>
                    <p className="mt-2 text-lg text-[#d7f5ec]">{starsForScore(item.score)}</p>
                  </div>
                  <ScorePill label="Score" value={`${item.score}/5`} tone={item.score >= 4 ? "positive" : item.score >= 3 ? "warning" : "danger"} />
                </div>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-300">{item.notes}</p>
              </summary>
              <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm leading-6 text-slate-200">
                {item.notes}
              </div>
            </details>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Navigation"
        title="Continue reviewing this client"
        subtitle="Move back to the client-level history or into the original Monthly Touch workspace."
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Link href={`/qa/${payload.client.id}`} style={{ color: "#0d1625" }} className="rounded-2xl border border-slate-300/60 bg-white px-4 py-4 text-sm font-semibold text-[#0d1625] transition hover:bg-[#d7f5ec]">
            Back to client QA history
          </Link>
          <Link href={`/monthly-touch/${payload.touch.id}`} style={{ color: "#0d1625" }} className="rounded-2xl border border-slate-300/60 bg-white px-4 py-4 text-sm font-semibold text-[#0d1625] transition hover:bg-[#d7f5ec]">
            Open Monthly Touch workspace
          </Link>
          <Link href={`/monthly-touch/${payload.touch.id}/summary`} style={{ color: "#0d1625" }} className="rounded-2xl border border-slate-300/60 bg-white px-4 py-4 text-sm font-semibold text-[#0d1625] transition hover:bg-[#d7f5ec]">
            Open post-meeting summary
          </Link>
        </div>
      </SectionCard>
    </AppShell>
  );
}
