import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Play, CheckCircle2, Sparkles } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { DataError } from "@/src/components/mtos/data-error";
import { Linkified, SmartText } from "@/src/components/mtos/annotate";
import { SectionAdditions } from "@/src/components/mtos/section-additions";
import { FiveQuestions, type QStep } from "@/src/components/mtos/five-questions";
import { CallGuideActions } from "@/src/components/mtos/call-guide-actions";
import { LeadVerificationSummary } from "@/src/components/mtos/lead-verification-summary";
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
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getMonthlyTouchWorkspaceView } from "@/src/lib/server/services/monthly-touch-service";

function Section({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="card mt-4">
      <div className="mb-4">
        <div className="eyebrow muted">{eyebrow}</div>
        <div className="h4 mt-1.5">{title}</div>
        {subtitle ? <p className="muted mt-1 text-[0.82rem]">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Bullets({ items, tone, clientId }: { items: string[]; tone: "good" | "risk" | "info"; clientId?: string }) {
  if (!items.length) return <p className="muted text-[0.86rem]">Nothing recorded yet.</p>;
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((it) => (
        <div
          key={it}
          className="flex items-start gap-2.5 rounded-[10px] p-3 text-[0.88rem]"
          style={{ background: "var(--surface-2)", border: "1px solid var(--hair)", color: "var(--text)" }}
        >
          <span className={`sig-dot ${tone === "info" ? "" : tone}`} style={{ marginTop: 6, background: tone === "info" ? "var(--info)" : undefined }} />
          <span>
            <Linkified text={it} clientId={clientId} />
          </span>
        </div>
      ))}
    </div>
  );
}

export default async function MonthlyTouchPage({
  params,
}: {
  params: Promise<{ touchId: string }>;
}) {
  const { touchId } = await params;
  let payload: Awaited<ReturnType<typeof getMonthlyTouchWorkspaceView>>;
  try {
    payload = await getMonthlyTouchWorkspaceView(await resolveTenantContext(), touchId);
  } catch {
    return (
      <AppShell>
        <DataError title="Couldn't load this Monthly Touch" />
      </AppShell>
    );
  }
  if (!payload) notFound();

  const { touch, client } = payload;
  const prepPack = touch.prepPack;

  const steps: QStep[] = [
    {
      n: 1,
      title: "What happened?",
      tone: "good",
      summary: touch.wins.length ? `${touch.wins.length} measurable wins this period` : "Review the period's results",
      content: (
        <div>
          <Bullets items={touch.wins} tone="good" clientId={client.id} />
          {prepPack ? <p className="muted mt-3 text-[0.8rem]">Full business scorecard is below.</p> : null}
          <SectionAdditions clientId={client.id} sectionKey="q1-what-happened" />
        </div>
      ),
    },
    {
      n: 2,
      title: "What caused it?",
      tone: "risk",
      summary: touch.risks.length ? `${touch.risks.length} risks / drivers identified` : "Identify the drivers",
      content: (
        <div>
          <Bullets items={touch.risks} tone="risk" clientId={client.id} />
          <SectionAdditions clientId={client.id} sectionKey="q2-what-caused" />
        </div>
      ),
    },
    {
      n: 3,
      title: "What does this mean?",
      tone: "info",
      summary: "Translate the numbers into business meaning",
      content: (
        <div className="flex flex-col gap-3">
          <SmartText text={touch.executiveBrief} clientId={client.id} />
          {touch.talkingPoints.length ? (
            <div>
              <div className="eyebrow muted mb-2 mt-1">How to say it</div>
              <Bullets items={touch.talkingPoints} tone="info" clientId={client.id} />
            </div>
          ) : null}
          <SectionAdditions clientId={client.id} sectionKey="q3-what-means" />
        </div>
      ),
    },
    {
      n: 4,
      title: "What opportunities do we see?",
      tone: "good",
      summary: touch.opportunities.length ? `${touch.opportunities.length} opportunities to raise` : "Surface the next opportunities",
      content: (
        <div>
          <Bullets items={touch.opportunities} tone="good" clientId={client.id} />
          <SectionAdditions clientId={client.id} sectionKey="q4-opportunities" />
        </div>
      ),
    },
    {
      n: 5,
      title: "What are we doing next?",
      tone: "good",
      summary: "The committed plan and owners",
      content: (
        <div className="flex flex-col gap-4">
          <Bullets items={touch.commitments} tone="info" clientId={client.id} />
          {prepPack?.strategicAction?.nextSteps ? (
            <div className="rounded-[10px] p-3" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
              <div className="eyebrow" style={{ color: "var(--accent-ink)" }}>
                Strategic next step
              </div>
              <p className="mt-1.5 text-[0.88rem]">{prepPack.strategicAction.nextSteps}</p>
            </div>
          ) : null}
          <SectionAdditions clientId={client.id} sectionKey="q5-next" />
        </div>
      ),
    },
  ];

  return (
    <AppShell>
      <Link
        href={`/clients/${client.id}`}
        className="mb-4 inline-flex items-center gap-2 text-[0.82rem]"
        style={{ color: "var(--slate-400)" }}
      >
        <ArrowLeft style={{ width: 15, height: 15 }} />
        Back to {client.name}
      </Link>

      {/* Header */}
      <div className="card glow" style={{ padding: 24 }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="eyebrow">
              <Play />
              <span>Monthly Touch run-sheet</span>
            </div>
            <h2 className="h2 mt-3" style={{ fontSize: "var(--t-h3)" }}>
              {client.name}
            </h2>
            <p className="muted mt-1.5 text-[0.86rem]">
              The five strategic questions, pre-answered from the prep pack. Walk the client top to bottom.
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex flex-wrap gap-2">
              <span className="chip">
                Readiness <b style={{ color: "var(--text)" }}>{touch.readinessScore}</b>
              </span>
              <span className="chip">
                Confidence <b style={{ color: "var(--text)" }}>{touch.confidenceScore}</b>
              </span>
              <span className={`chip ${touch.status === "Ready" ? "good" : "watch"}`}>{touch.status}</span>
            </div>
            <Link href={`/monthly-touch/${touch.id}/summary`} className="btn btn-primary btn-sm">
              <CheckCircle2 style={{ width: 16, height: 16 }} />
              Capture &amp; close out
            </Link>
          </div>
        </div>
        <div className="mt-4">
          <MonthlyTouchPrepActions
            touchId={touch.id}
            preparedAt={prepPack?.preparedAt}
            claudeStatus={prepPack?.claude.status}
            claudeError={prepPack?.claude.errorMessage}
            claudeProvider={prepPack?.claude.provider}
          />
        </div>
      </div>

      {prepPack ? (
        <div className="mt-4">
          <DataGapsBanner gaps={prepPack.dataGaps} />
        </div>
      ) : null}

      {prepPack?.meetingFormat ? (
        <div className="card mt-4" style={{ borderLeft: "3px solid var(--accent)" }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="eyebrow muted">This month&apos;s format · keep it fresh</div>
              <div className="h4 mt-1">{prepPack.meetingFormat.name}</div>
              <p className="muted mt-1 text-[0.85rem]">{prepPack.meetingFormat.angle}</p>
            </div>
            <span className="chip info">
              <span className="sig-dot" style={{ background: "var(--info)" }} />
              Fresh angle
            </span>
          </div>
          {prepPack.varietyNote ? (
            <div className="mt-3 rounded-[10px] p-3 text-[0.85rem]" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
              {prepPack.varietyNote}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* The five questions */}
      <div className="mt-5">
        <FiveQuestions steps={steps} />
      </div>

      {prepPack?.decisionsTogether?.length ? (
        <Section
          eyebrow="Client as copilot"
          title="Decisions to make together"
          subtitle="Put these to the client live and let them choose — it makes them a copilot, not a passenger. Record what they pick so it flows into next month's prep and the report."
        >
          <div className="flex flex-col gap-3">
            {prepPack.decisionsTogether.map((d, i) => (
              <div key={i} className="rounded-[12px] p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--hair)" }}>
                <div className="h4" style={{ fontSize: "0.95rem" }}>{d.question}</div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {d.options.map((o) => (
                    <span key={o} className="chip" style={{ background: "var(--surface)", borderColor: "var(--hair-strong)" }}>{o}</span>
                  ))}
                </div>
                <p className="muted mt-2 text-[0.8rem]">{d.why}</p>
                <SectionAdditions clientId={client.id} sectionKey={`decision-${i}-next`} label="Record what they chose" />
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Supporting detail — real prep-pack panels (styled via the global compatibility layer) */}
      <div>
      {touch.leadVerification ? (
        <Section
          eyebrow="Lead & call verification"
          title="Leads, calls & forms — vetted and reconciled"
          subtitle="Auto-run during prep: each lead vetted, attributed to a channel, and reconciled against Google Ads and GBP."
        >
          <LeadVerificationSummary review={touch.leadVerification} clientId={client.id} />
        </Section>
      ) : null}

      {prepPack ? (
        <Section eyebrow="Scorecard" title="Business scorecard" subtitle="The business numbers, reviewed before the services.">
          <ScorecardGrid scorecard={prepPack.businessScorecard} clientId={client.id} />
        </Section>
      ) : null}

      {prepPack ? (
        <Section eyebrow="SEO & GBP" title="Keyword heatmaps & profile performance" subtitle="Read Average Ranking, Map Pack %, and Market Share together.">
          <SeoPerformancePanel seo={prepPack.seoPerformance} />
        </Section>
      ) : null}

      {prepPack ? (
        <Section eyebrow="Paid media" title="Google Ads & Meta Ads" subtitle="Only run this section if the channel is active for this client.">
          <AdsPerformancePanel ads={prepPack.adsPerformance} />
        </Section>
      ) : null}

      {prepPack ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="card">
            <div className="mb-4">
              <div className="eyebrow muted">Strategic action</div>
              <div className="h4 mt-1.5">Agreed action &amp; implementation %</div>
            </div>
            <StrategicActionPanel action={prepPack.strategicAction} />
          </div>
          <div className="card">
            <div className="mb-4">
              <div className="eyebrow muted">Readiness</div>
              <div className="h4 mt-1.5">Client participation</div>
            </div>
            <ParticipationChecklist participation={prepPack.clientParticipation} />
          </div>
        </div>
      ) : null}

      {prepPack ? (
        <Section eyebrow="Issues" title="Issues, business impact & solutions" subtitle="Every issue arrives with a proposed solution, an owner, and a date.">
          <IssuesSolutionsList items={prepPack.issuesAndSolutions} />
        </Section>
      ) : null}

      {prepPack ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="card">
            <div className="mb-4">
              <div className="eyebrow muted">Lead quality</div>
              <div className="h4 mt-1.5">Questions to ask live</div>
            </div>
            <LeadQualityQuestionList questions={prepPack.leadQualityQuestions} />
          </div>
          <div className="card">
            <div className="mb-4">
              <div className="eyebrow muted">Recap</div>
              <div className="h4 mt-1.5">Five-question close</div>
            </div>
            <RecapQuestionList questions={prepPack.recapQuestions} />
          </div>
        </div>
      ) : null}

      <Section eyebrow="Live meeting" title="Live call guide" subtitle="A timed, section-by-section guide generated from the prep pack.">
        <CallGuideActions touchId={touch.id} clientId={client.id} callGuide={touch.callGuide} screenOverrides={touch.callGuideScreens} />
      </Section>

      <Section eyebrow="AI assistance" title="Evidence-backed recommendations" subtitle="What to say, why it matters, and the evidence behind it.">
        {touch.aiRecommendations.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {touch.aiRecommendations.map((item) => (
              <RecommendationCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <p className="muted text-[0.86rem]">Run the preparation engine to generate recommendations.</p>
        )}
      </Section>

      <Section eyebrow="Post-meeting" title="Complete the follow-through" subtitle="Flow directly into summary, ownership, and execution once the meeting ends.">
        <div className="flex items-center gap-3">
          <span className="insight-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <Sparkles />
          </span>
          <Link href={`/monthly-touch/${touch.id}/summary`} className="btn btn-primary btn-sm">
            Open post-meeting summary
          </Link>
        </div>
      </Section>
      </div>
    </AppShell>
  );
}
