import { GoogleMeetingPanel } from "@/src/components/mtos/google-meeting-panel";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ClipboardCheck, ExternalLink, FileText, Sparkles } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { DataError } from "@/src/components/mtos/data-error";
import { Linkified } from "@/src/components/mtos/annotate";
import { LiveModeLauncher } from "@/src/components/mtos/live-mode";
import { PrepWorkflowPanel } from "@/src/components/mtos/prep-workflow-panel";
import { RunSheetStages } from "@/src/components/mtos/run-sheet-stages";
import { ScoreBreakdown } from "@/src/components/mtos/score-breakdown";
import { CallGuideActions } from "@/src/components/mtos/call-guide-actions";
import { PresentationViewer } from "@/src/components/mtos/presentation-viewer";
import { LeadVerificationSummary } from "@/src/components/mtos/lead-verification-summary";
import { RecommendationCard } from "@/src/components/mtos/recommendation-card";
import {
  AdsPerformancePanel,
  DataGapsBanner,
  IssuesSolutionsList,
  ParticipationChecklist,
  ScorecardGrid,
  SeoPerformancePanel,
  StrategicActionPanel,
} from "@/src/components/mtos/prep-pack-sections";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getMonthlyTouchWorkspaceView } from "@/src/lib/server/services/monthly-touch-service";
import {
  RUN_SHEET_PRIMARY_ACTION,
  deriveRunSheetStage,
  type RunSheetStage,
} from "@/src/lib/server/services/prep-readiness-service";
import { readPrepWorkflow } from "@/src/lib/server/services/prep-workflow-service";

/**
 * Run-sheet v2.
 *
 * The v1 run-sheet put preparation, the live call and the after-call work on one page, so an AM
 * scrolled past the whole month to find the thing they needed now, and its primary action never
 * changed -- `Capture & close out` sat at the top of a touch whose meeting had not happened.
 *
 * This one has the five stages across the top, one primary action that belongs to the stage the
 * touch is actually in, and the page shows that stage's work. The other stages stay one click away
 * rather than being hidden, because an AM does sometimes want to re-read the preparation mid-call.
 *
 * Built alongside v1 rather than replacing it: everything it uses is the existing data model, the
 * existing panels and the existing integrations, so the two can run side by side while this is
 * tried on real touches.
 */

const VIEWS: { id: RunSheetStage; label: string }[] = [
  { id: "prep", label: "Prep" },
  { id: "review", label: "Review" },
  { id: "live", label: "Live" },
  { id: "follow_through", label: "Follow-through" },
  { id: "qa", label: "QA" },
];

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

export default async function RunSheetV2Page({
  params,
  searchParams,
}: {
  params: Promise<{ touchId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { touchId } = await params;
  const { view: requestedView } = await searchParams;

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
  const workflow = readPrepWorkflow(touch);
  const stage = deriveRunSheetStage(touch);
  const primary = RUN_SHEET_PRIMARY_ACTION[stage];

  // The AM can look at any stage; the default is the one the touch is in. A stage they chose is
  // theirs, so the view never jumps back on its own.
  const view: RunSheetStage = VIEWS.some((entry) => entry.id === requestedView)
    ? (requestedView as RunSheetStage)
    : stage;

  const liveLauncher = (
    <LiveModeLauncher
      touch={touch}
      clientId={client.id}
      clientName={client.name}
      label={stage === "live" ? primary.label : "Open Live mode"}
    />
  );

  /**
   * The one action for the stage the touch is in.
   *
   * Prep and Review scroll to the workflow rather than duplicating its buttons: there is exactly
   * one Generate Preparation in the application, and it is the one inside step 1, so the two can
   * never disagree about whether it is allowed to run.
   */
  const primaryAction =
    stage === "live" ? (
      liveLauncher
    ) : stage === "follow_through" ? (
      <Link href={`/monthly-touch/${touch.id}/summary`} className="btn btn-primary">
        <Sparkles />
        {primary.label}
      </Link>
    ) : stage === "qa" ? (
      <Link href={`/qa/${client.id}/${touch.id}`} className="btn btn-primary">
        <ClipboardCheck />
        {primary.label}
      </Link>
    ) : (
      <Link href={`/monthly-touch/${touch.id}/v2?view=${stage}#workflow`} className="btn btn-primary">
        <FileText />
        {primary.label}
      </Link>
    );

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/monthly-touch" className="ilink inline-flex items-center gap-1.5 text-[0.8rem]">
            <ArrowLeft style={{ width: 14, height: 14 }} />
            All Monthly Touches
          </Link>
          <h1 className="h2 mt-2.5">{client.name}</h1>
          <p className="muted mt-1.5 text-[0.84rem]">
            {client.industry}
            {client.location ? ` · ${client.location}` : ""} · meeting {client.touchDate}
            {client.accountManager ? ` · ${client.accountManager}` : ""}
          </p>
        </div>
        <Link href={`/monthly-touch/${touch.id}`} className="btn btn-ghost btn-sm">
          Open the original run-sheet
        </Link>
      </div>

      <GoogleMeetingPanel touchId={touch.id} emails={client.googleMeetingEmails} />

      <div className="mt-4">
        <RunSheetStages current={stage} action={primaryAction} note={primary.hint} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <nav className="seg" aria-label="Which stage to show">
          {VIEWS.map((entry) => (
            <Link
              key={entry.id}
              href={`/monthly-touch/${touch.id}/v2?view=${entry.id}`}
              className={`seg-btn ${view === entry.id ? "on" : ""}`}
              aria-current={view === entry.id ? "page" : undefined}
            >
              {entry.label}
            </Link>
          ))}
        </nav>
        {view !== stage ? (
          <span className="muted text-[0.78rem]">
            You are looking at {VIEWS.find((entry) => entry.id === view)?.label}; this touch is in{" "}
            {VIEWS.find((entry) => entry.id === stage)?.label}.
          </span>
        ) : null}
      </div>

      {/* ---------- Prep and Review: the ordered workflow plus what it produced ---------- */}
      {view === "prep" || view === "review" ? (
        <>
          <div className="mt-4">
            <ScoreBreakdown readiness={workflow.readiness!} confidence={workflow.confidence!} />
          </div>

          <div id="workflow" className="mt-5">
            <PrepWorkflowPanel touchId={touch.id} workflow={workflow} clientName={client.name} />
          </div>

          {prepPack ? (
            <div className="mt-5">
              <DataGapsBanner gaps={prepPack.dataGaps} />
            </div>
          ) : null}

          {view === "review" && prepPack ? (
            <>
              {touch.executiveBrief ? (
                <Section
                  eyebrow="The month"
                  title="What the account review found"
                  subtitle="The findings the preparation notes and the client email were both written from."
                >
                  <p className="text-[0.88rem] leading-7" style={{ color: "var(--text-2)" }}>
                    <Linkified text={touch.executiveBrief} clientId={client.id} />
                  </p>
                </Section>
              ) : null}

              {touch.leadVerification ? (
                <Section
                  eyebrow="Lead & call verification"
                  title="Leads, calls and forms — vetted and reconciled"
                  subtitle="Run during the account review: each lead vetted, attributed, and reconciled against Google Ads and the Google profile."
                >
                  <LeadVerificationSummary review={touch.leadVerification} clientId={client.id} />
                </Section>
              ) : null}

              <Section
                eyebrow="Scorecard"
                title="Business scorecard"
                subtitle="The business numbers, read before the services. A dash means the number was not available, not zero."
              >
                <ScorecardGrid scorecard={prepPack.businessScorecard} clientId={client.id} />
              </Section>

              <Section eyebrow="SEO & GBP" title="Keyword heatmaps and profile performance">
                <SeoPerformancePanel seo={prepPack.seoPerformance} />
              </Section>

              <Section eyebrow="Paid media" title="Google Ads and Meta Ads">
                <AdsPerformancePanel ads={prepPack.adsPerformance} />
              </Section>

              <Section
                eyebrow="Issues"
                title="Issues, business impact and what we are doing"
                subtitle="Every issue arrives with a proposed solution, an owner and a date."
              >
                <IssuesSolutionsList items={prepPack.issuesAndSolutions} />
              </Section>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div className="card">
                  <div className="card-head">
                    <div className="card-title">Strategic action</div>
                  </div>
                  <StrategicActionPanel action={prepPack.strategicAction} />
                </div>
                <div className="card">
                  <div className="card-head">
                    <div className="card-title">Client participation</div>
                  </div>
                  <ParticipationChecklist participation={prepPack.clientParticipation} />
                </div>
              </div>

              <Section
                eyebrow="AI assistance"
                title="Evidence-backed recommendations"
                subtitle="What to say, why it matters, and the evidence behind it."
              >
                {touch.aiRecommendations.length ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {touch.aiRecommendations.map((item) => (
                      <RecommendationCard key={item.id} item={item} />
                    ))}
                  </div>
                ) : (
                  <p className="muted text-[0.86rem]">
                    The account review has not produced recommendations for this touch yet.
                  </p>
                )}
              </Section>
            </>
          ) : null}
        </>
      ) : null}

      {/* ---------- Live: one full-screen view, with the two delivery formats behind it ---------- */}
      {view === "live" ? (
        <>
          <div className="card mt-4">
            <div className="card-head">
              <div className="card-title">Live mode</div>
              {touch.callGuide?.status === "generated" ? (
                <span className="chip good">
                  <span className="sig-dot good" />
                  Call guide ready
                </span>
              ) : (
                <span className="chip watch">
                  <span className="sig-dot watch" />
                  No call guide generated
                </span>
              )}
            </div>
            <p className="text-[0.88rem] leading-7" style={{ color: "var(--text-2)" }}>
              One full-screen view for the call: the five opening questions as the agenda, the call guide&apos;s talking
              points and questions beside each one, a timer per segment, and your own notes. The client-facing slides
              open separately — your notes and the internal recommendations are never in them.
            </p>
            {touch.liveSession ? (
              <p className="muted mt-3 text-[0.8rem]">
                You have notes on {touch.liveSession.segments.filter((segment) => segment.notes.trim()).length}{" "}
                segments from {new Date(touch.liveSession.startedAt).toLocaleString()}, and{" "}
                {touch.liveSession.recapStepsDone.length} of 6 close steps marked done. Opening Live mode picks up where
                you left off.
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2.5">{liveLauncher}</div>
          </div>

          <Section
            eyebrow="Live meeting"
            title="Live call guide"
            subtitle="The same guide Live mode reads from. Generate or regenerate it here."
          >
            <CallGuideActions
              touchId={touch.id}
              clientId={client.id}
              callGuide={touch.callGuide}
              screenOverrides={touch.callGuideScreens}
            />
          </Section>

          <Section
            eyebrow="Live meeting"
            title="Client presentation"
            subtitle="The client-facing deck, built from the same preparation, with private presenter notes. Live mode opens it in its own view for screen sharing."
          >
            <PresentationViewer touchId={touch.id} presentation={touch.presentation} />
          </Section>
        </>
      ) : null}

      {/* ---------- Follow-through ---------- */}
      {view === "follow_through" ? (
        <div className="card mt-4">
          <div className="card-head">
            <div className="card-title">After the call</div>
            <span className={`chip ${touch.postMeeting?.status === "approved" ? "good" : "watch"}`}>
              {touch.postMeeting?.status === "approved"
                ? "Decisions applied"
                : touch.postMeeting?.status === "draft_ready"
                  ? "Drafts waiting for you"
                  : "Not started"}
            </span>
          </div>
          <p className="text-[0.88rem] leading-7" style={{ color: "var(--text-2)" }}>
            The recording and transcript become the recap, the draft tickets, the client email and the post-meeting
            notes. Nothing is sent and nothing is written to ClickUp until you have decided each item.
          </p>
          {touch.liveSession?.closeNotes?.trim() ? (
            <div className="quick-ref mt-4">
              <div className="quick-ref-label">What you wrote down during the close</div>
              <p className="mt-1.5 whitespace-pre-wrap text-[0.84rem]">{touch.liveSession.closeNotes}</p>
              <p className="field-hint mt-2">
                These go to the follow-through with the transcript, so the recap and the tickets are built from what you
                actually agreed.
              </p>
            </div>
          ) : null}
          <div className="mt-4">
            <Link href={`/monthly-touch/${touch.id}/summary`} className="btn btn-primary">
              <Sparkles />
              Open Follow-through
            </Link>
          </div>
        </div>
      ) : null}

      {/* ---------- QA ---------- */}
      {view === "qa" ? (
        <div className="card mt-4">
          <div className="card-head">
            <div className="card-title">QA and coaching</div>
            <span className={`chip ${touch.qaReview ? "info" : "muted"}`}>
              {touch.qaReview ? "Review available" : "No review yet"}
            </span>
          </div>
          <p className="text-[0.88rem] leading-7" style={{ color: "var(--text-2)" }}>
            The QA review reads the preparation and the post-meeting notes and scores the touch, and the approval is
            recorded against this touch.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Link href={`/qa/${client.id}/${touch.id}`} className="btn btn-primary">
              <ClipboardCheck />
              Open the QA review
            </Link>
            {workflow.filing?.links?.prepPageUrl ? (
              <a
                className="btn btn-ghost"
                href={workflow.filing.links.prepPageUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink />
                This touch in the Client&apos;s Book
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
