import { notFound } from "next/navigation";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { CallGuideActions } from "@/src/components/mtos/call-guide-actions";
import { MonthlyTouchPrepActions } from "@/src/components/mtos/monthly-touch-prep-actions";
import {
  AdsPerformancePanel,
  DataGapsBanner,
  IssuesSolutionsList,
  LeadQualityQuestionList,
  ParticipationChecklist,
  RecapQuestionList,
  ScorecardGrid,
  SeoPerformancePanel,
  StrategicActionPanel,
} from "@/src/components/mtos/prep-pack-sections";
import { RecommendationCard } from "@/src/components/mtos/recommendation-card";
import { ScorePill } from "@/src/components/mtos/score-pill";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getMonthlyTouchWorkspaceView } from "@/src/lib/server/services/monthly-touch-service";
import { healthTone } from "@/src/lib/utils";

export default async function MonthlyTouchPage({
  params,
}: {
  params: Promise<{ touchId: string }>;
}) {
  const { touchId } = await params;
  const payload = await getMonthlyTouchWorkspaceView(await resolveTenantContext(), touchId);

  if (!payload) {
    notFound();
  }

  const { touch, client } = payload;
  const prepPack = touch.prepPack;
  const readinessChecks = [
    {
      label: "Client context compiled into a stored prep pack",
      done: Boolean(prepPack),
    },
    {
      label: "Historical commitments reviewed",
      done: Boolean(prepPack?.openCommitments.length),
    },
    {
      label: "Top growth opportunities reviewed",
      done: Boolean(prepPack?.activeOpportunities.length),
    },
    {
      label: "Connected integration evidence attached",
      done: Boolean(prepPack?.integrationSources.length),
    },
    {
      label: "Google Calendar next-touch mapping detected",
      done: Boolean(touch.scheduledAt || touch.calendarEventId),
    },
    {
      label: "Claude recommendations generated",
      done: prepPack?.claude.status === "generated",
    },
  ];

  const isOaklineTouch = touch.id === "touch-oakline-july";
  const oaklineRingSurfaceStyle = isOaklineTouch
    ? {
        backgroundColor: "var(--tw-ring-offset-color)",
      }
    : undefined;
  const oaklineSummaryButtonStyle = isOaklineTouch
    ? {
        backgroundColor: "var(--tw-ring-offset-color)",
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "var(--tw-ring-color)",
        color: "#223554",
      }
    : undefined;

  return (
    <AppShell
      title={`${client.name} Monthly Touch`}
      subtitle="Preparation, live support, and post-meeting execution live in a single operational environment so the Account Manager never has to reassemble context."
    >
      <div className="grid gap-6 xl:grid-cols-[1.3fr_minmax(0,0.9fr)]">
        <SectionCard
          eyebrow="Preparation"
          title="Executive brief"
          subtitle="Readable in under five minutes, evidence-backed, and directly tied to the client's growth and relationship health."
          aside={
            <div className="flex flex-wrap gap-2">
              <ScorePill label="Readiness" value={touch.readinessScore} tone={healthTone(touch.readinessScore)} />
              <ScorePill
                label="Meeting confidence"
                value={touch.confidenceScore}
                tone={healthTone(touch.confidenceScore)}
              />
            </div>
          }
        >
          <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
            {touch.executiveBrief.split("\n\n").map((paragraph, index) => (
              <p key={index} className="text-sm leading-7 text-slate-200 [&:not(:first-child)]:mt-4">
                {paragraph}
              </p>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Readiness"
          title={`${touch.status} status`}
          subtitle="Preparation quality, source coverage, and Claude generation remain visible before the conversation begins."
        >
          <div className="space-y-3">
            <MonthlyTouchPrepActions
              touchId={touch.id}
              preparedAt={prepPack?.preparedAt}
              claudeStatus={prepPack?.claude.status}
              claudeError={prepPack?.claude.errorMessage}
            />
            {readinessChecks.map((item) => (
              <div key={item.label} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3">
                <CheckCircle2 className={`h-4 w-4 ${item.done ? "text-emerald-300" : "text-slate-500"}`} />
                <span className="text-sm text-slate-200">{item.label}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {prepPack ? <DataGapsBanner gaps={prepPack.dataGaps} /> : null}

      {prepPack ? (
        <SectionCard
          eyebrow="Scorecard"
          title="Business scorecard"
          subtitle="Leads, calls, bookings, and visibility -- the business numbers, reviewed before the services."
        >
          <ScorecardGrid scorecard={prepPack.businessScorecard} />
        </SectionCard>
      ) : null}

      {prepPack ? (
        <SectionCard
          eyebrow="SEO & GBP"
          title="Keyword heatmaps & profile performance"
          subtitle="Pulled from the connected Rank Tracker and Google Business Profile syncs -- read Average Ranking, Map Pack %, and Market Share together, never Average Ranking alone."
        >
          <SeoPerformancePanel seo={prepPack.seoPerformance} />
        </SectionCard>
      ) : null}

      {prepPack ? (
        <SectionCard
          eyebrow="Paid media"
          title="Google Ads & Meta Ads"
          subtitle="Only run this section of the call if the channel is active for this client."
        >
          <AdsPerformancePanel ads={prepPack.adsPerformance} />
        </SectionCard>
      ) : null}

      {prepPack ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <SectionCard
            eyebrow="Strategic action"
            title="Agreed action & implementation %"
            subtitle="The high-impact action from last cycle -- report what it produced and the next step."
          >
            <StrategicActionPanel action={prepPack.strategicAction} />
          </SectionCard>

          <SectionCard
            eyebrow="Readiness"
            title="Client participation"
            subtitle="Confirm the basics before recommending advanced strategy."
          >
            <ParticipationChecklist participation={prepPack.clientParticipation} />
          </SectionCard>
        </div>
      ) : null}

      {prepPack ? (
        <SectionCard
          eyebrow="Issues"
          title="Issues, business impact & solutions"
          subtitle="Every issue arrives with a proposed solution, an owner, and a date -- anticipate the client."
        >
          <IssuesSolutionsList items={prepPack.issuesAndSolutions} />
        </SectionCard>
      ) : null}

      {prepPack ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <SectionCard
            eyebrow="Lead quality"
            title="Questions to ask live"
            subtitle="Separate marketing performance from sales / operations."
          >
            <LeadQualityQuestionList questions={prepPack.leadQualityQuestions} />
          </SectionCard>

          <SectionCard
            eyebrow="Recap"
            title="Five-question close"
            subtitle="Use this framework to close the meeting -- fill it in during the recap."
          >
            <RecapQuestionList questions={prepPack.recapQuestions} />
          </SectionCard>
        </div>
      ) : null}

      <SectionCard
        eyebrow="Agenda"
        title="Meeting structure"
        subtitle="The platform drives clarity through a sequenced agenda so every Monthly Touch feels deliberate and evidence-backed."
      >
        <div className="space-y-3">
          {touch.agenda.map((item, index) => (
            <div key={item} className="flex gap-4 rounded-[24px] border border-white/8 bg-white/4 p-4">
              <div
                style={oaklineRingSurfaceStyle}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-slate-950"
              >
                {index + 1}
              </div>
              <div>
                <p className="text-sm font-medium text-white">{item}</p>
                <p className="mt-1 text-sm text-slate-400">
                  Keep the conversation tied to evidence, action, and business value.
                </p>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Live meeting"
        title="Live call guide"
        subtitle="A timed, section-by-section guide generated from the prep pack -- built for the AM to follow live, with client prompts that keep the client engaged as a co-pilot rather than an audience."
      >
        <CallGuideActions touchId={touch.id} callGuide={touch.callGuide} />
      </SectionCard>

      <SectionCard
        eyebrow="Prep pack"
        title="Repeatable preparation bundle"
        subtitle="This bundle turns upcoming Monthly Touches into a reusable operating package built from MTOS workflow data and the latest connected integration snapshots."
      >
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Focus areas</p>
              <div className="mt-3 space-y-3">
                {(prepPack?.focusAreas.length ? prepPack.focusAreas : ["Run the prep engine to generate the first preparation bundle."]).map((item) => (
                  <div key={item} className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-200">
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Key facts</p>
              <div className="mt-3 space-y-3">
                {(prepPack?.keyFacts.length ? prepPack.keyFacts : ["No prepared facts are stored yet."]).map((item) => (
                  <div key={item} className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-200">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Connected sources</p>
                <p className="text-xs text-slate-500">
                  {prepPack?.preparedAt ? `Prepared ${new Date(prepPack.preparedAt).toLocaleString("en-US")}` : "Not prepared"}
                </p>
              </div>
              <div className="mt-3 space-y-3">
                {prepPack?.integrationSources.length ? (
                  prepPack.integrationSources.map((source) => (
                    <div key={source.providerId} className="rounded-2xl border border-white/8 bg-white/4 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{source.label}</p>
                          <p className="mt-1 text-sm text-slate-300">{source.summary}</p>
                        </div>
                        <p className="text-xs text-slate-500">{new Date(source.syncedAt).toLocaleString("en-US")}</p>
                      </div>
                      <div className="mt-3 space-y-2">
                        {source.bullets.map((bullet) => (
                          <div key={bullet} className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-sm text-slate-300">
                            {bullet}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-300">
                    No integration snapshots are attached yet. Connect and sync providers, then refresh the prep pack.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr_1.1fr]">
        <SectionCard eyebrow="Wins" title="What to celebrate" subtitle="Wins without measurable value should not be surfaced.">
          <div className="space-y-3">
            {touch.wins.slice(0, 3).map((win) => (
              <div key={win} className="rounded-2xl border border-emerald-400/10 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {win}
              </div>
            ))}
            {touch.wins.length > 3 ? (
              <details className="group rounded-2xl border border-white/8 bg-white/4 px-4 py-3">
                <summary className="cursor-pointer text-xs uppercase tracking-[0.2em] text-slate-400 [&::-webkit-details-marker]:hidden">
                  View all {touch.wins.length} wins
                </summary>
                <div className="mt-3 space-y-2">
                  {touch.wins.slice(3).map((win) => (
                    <div key={win} className="rounded-2xl border border-emerald-400/10 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-100/90">
                      {win}
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard eyebrow="Risks" title="What requires attention" subtitle="Risks stay visible and actionable.">
          <div className="space-y-3">
            {touch.risks.slice(0, 2).map((risk) => (
              <div key={risk} className="rounded-2xl border border-rose-400/10 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {risk}
              </div>
            ))}
            {touch.risks.length > 2 ? (
              <details className="group rounded-2xl border border-white/8 bg-white/4 px-4 py-3">
                <summary className="cursor-pointer text-xs uppercase tracking-[0.2em] text-slate-400 [&::-webkit-details-marker]:hidden">
                  View all {touch.risks.length} risks
                </summary>
                <div className="mt-3 space-y-2">
                  {touch.risks.slice(2).map((risk) => (
                    <div key={risk} className="rounded-2xl border border-rose-400/10 bg-rose-500/5 px-4 py-3 text-sm text-rose-100/90">
                      {risk}
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard eyebrow="Action planning" title="Talking points and commitments" subtitle="Recommendations must create confident delivery and accountable follow-through.">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Talking points</p>
              {touch.talkingPoints.map((point) => (
                <div key={point} className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-200">
                  {point}
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Commitments to confirm</p>
              {touch.commitments.map((item) => (
                <div key={item} className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-slate-200">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        eyebrow="AI assistance"
        title="Evidence-backed recommendations"
        subtitle="AI supports preparation by showing what to say, why it matters, and what evidence supports the recommendation."
      >
        {touch.aiRecommendations.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {touch.aiRecommendations.map((item) => (
              <RecommendationCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="rounded-[24px] border border-white/8 bg-black/20 px-5 py-4 text-sm text-slate-300">
            Run the preparation engine to generate deterministic recommendations, then use Claude to upgrade them with a sharper executive brief and meeting guidance.
          </div>
        )}
      </SectionCard>

      <SectionCard
        eyebrow="Post-meeting"
        title="Complete the follow-through workflow"
        subtitle="Preparation should flow directly into summary, ownership, and execution once the meeting ends."
      >
        <Link
          href={`/monthly-touch/${touch.id}/summary`}
          style={oaklineSummaryButtonStyle}
          className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white px-4 py-3 text-sm font-semibold text-[#0c1524] transition hover:bg-[#d7f5ec]"
        >
          Open post-meeting summary
        </Link>
      </SectionCard>
    </AppShell>
  );
}
