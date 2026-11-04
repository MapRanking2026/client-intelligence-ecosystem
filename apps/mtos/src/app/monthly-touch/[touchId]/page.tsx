import { GoogleMeetingPanel } from "@/src/components/mtos/google-meeting-panel";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ClipboardCheck, ExternalLink, FileText, Sparkles } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { DataError } from "@/src/components/mtos/data-error";
import { Linkified } from "@/src/components/mtos/annotate";
import { JoinMeetButton, LiveModeLauncher } from "@/src/components/mtos/live-mode";
import { LiveCallStep } from "@/src/components/mtos/live-call-step";
import { TranscriptWaitPanel } from "@/src/components/mtos/transcript-wait-panel";
import { PrepWorkflowPanel } from "@/src/components/mtos/prep-workflow-panel";
import { TouchProgressRail } from "@/src/components/mtos/touch-progress-rail";
import { ReviewBrief } from "@/src/components/mtos/review-brief";
import { BriefHeader } from "@/src/components/mtos/brief-header";
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
import { getAccountManagerProfile } from "@/src/lib/server/services/user-service";
import {
  isTouchStep,
  resolveOpeningStep,
  resumeNotice,
  type TouchStep,
} from "@/src/lib/contracts/touch-progress";
import { EMPTY_PREP_BRIEF, approvalSummary } from "@/src/lib/contracts/prep-brief";
import { AgendaApprovalPanel } from "@/src/components/mtos/agenda-approval-panel";
import { readAgendaEmail } from "@/src/lib/server/services/agenda-email-service";
import { touchPageName } from "@/src/lib/server/services/client-book-pages";
import { getAccountManagerPreferences } from "@/src/lib/server/services/user-service";
import { callLengthMinutes } from "@/src/lib/contracts/live-call";

/**
 * Rendered per request, never prerendered.
 *
 * This page reads one tenant's data behind a session cookie, so a build-time copy of it would
 * be the wrong tenant's page for everyone -- and the build would have to reach Firestore to
 * make it, which is what failed the deploys of 2026-11-02 when the daily read quota ran out.
 * Next cannot infer this on its own here: the session read calls `cookies()` inside a
 * try/catch and skips it entirely when the cookie secret is absent, so on a build without
 * that secret nothing marks the route dynamic and it is prerendered.
 */
export const dynamic = "force-dynamic";

/**
 * The Monthly Touch run-sheet: the screen every route into a touch now opens.
 *
 * The screen it replaced put preparation, the live call and the after-call work on one page, so an
 * AM scrolled past the whole month to find the thing they needed now, and its primary action never
 * changed -- `Capture & close out` sat at the top of a touch whose meeting had not happened.
 *
 * This one has the five stages across the top, one primary action that belongs to the stage the
 * touch is actually in, and the page shows that stage's work. The other stages stay one click away
 * rather than being hidden, because an AM does sometimes want to re-read the preparation mid-call.
 *
 * It was built alongside the old one and lived at `/v2` while it was tried on real touches. It is
 * the default here now; the old screen is still readable at `/legacy`, and `/v2` still answers
 * (see the alias there) because that address was handed out.
 */

/**
 * The stored step and the stage read off the touch's real state are the same five steps under two
 * names: `follow_through` is the stage, `follow` is the step. Mapped rather than renamed because
 * the stage name is already in the board, the command centre and the primary-action table.
 */
const STEP_FOR_STAGE: Record<RunSheetStage, TouchStep> = {
  prep: "prep",
  review: "review",
  live: "live",
  follow_through: "follow",
  qa: "qa",
};

const STAGE_FOR_STEP: Record<TouchStep, RunSheetStage> = {
  prep: "prep",
  review: "review",
  live: "live",
  follow: "follow_through",
  qa: "qa",
};

/**
 * When this touch was last written to, for the "last saved" line on the resume banner.
 *
 * The latest of the per-screen autosaves and the document's own timestamp, because an AM who spent
 * an hour in the review and an hour in the live notes should be told about the hour they were in
 * last, not whichever field happens to be read first.
 */
function lastSavedAt(touch: { progressUpdatedAt?: string; updatedAt?: string; review?: { savedAt?: string }; agendaEmail?: { savedAt?: string }; live?: { savedAt?: string } }) {
  const stamps = [
    touch.progressUpdatedAt,
    touch.review?.savedAt,
    touch.agendaEmail?.savedAt,
    touch.live?.savedAt,
    touch.updatedAt,
  ].filter((value): value is string => Boolean(value) && !Number.isNaN(Date.parse(value as string)));
  if (!stamps.length) return undefined;
  return stamps.reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest));
}

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

export default async function MonthlyTouchRunSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ touchId: string }>;
  // `stage` is the parameter the handoff and the deep links use; `view` is kept working so links
  // already pasted into ClickUp tickets and Slack threads do not break.
  searchParams: Promise<{ stage?: string; view?: string }>;
}) {
  const { touchId } = await params;
  const { stage: requestedStage, view: requestedView } = await searchParams;
  const context = await resolveTenantContext();

  let payload: Awaited<ReturnType<typeof getMonthlyTouchWorkspaceView>>;
  try {
    payload = await getMonthlyTouchWorkspaceView(context, touchId);
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

  /**
   * Where this touch resumes.
   *
   * `touch.progress` is the stored marker. A touch that predates it has none, so the stage read
   * off its real state stands in -- an existing touch mid-follow-through must not reopen at prep
   * just because a field was added after it started.
   *
   * A requested step is honoured only up to the furthest one reached: a link to the follow-through
   * on a touch whose call hasn't happened would open a screen with no transcript, which reads as a
   * broken page rather than as work that hasn't happened yet.
   */
  const progress: TouchStep = isTouchStep(touch.progress) ? touch.progress : STEP_FOR_STAGE[stage];
  const legacyStep =
    requestedView && requestedView in STEP_FOR_STAGE
      ? STEP_FOR_STAGE[requestedView as RunSheetStage]
      : undefined;
  const step = resolveOpeningStep(progress, requestedStage || legacyStep);
  const view: RunSheetStage = STAGE_FOR_STEP[step];
  const profile = await getAccountManagerProfile(context);
  const resume = resumeNotice({
    progress,
    lastSavedAt: lastSavedAt(touch),
    timeZone: profile.timeZone,
  });
  // The agenda email and the format preference are read for the review step: both are facts about
  // this touch and this user that the screen states rather than a model restating them.
  const [agendaEmail, preferences] = await Promise.all([
    readAgendaEmail(context, touch, client),
    getAccountManagerPreferences(context),
  ]);
  const sectionSummary = approvalSummary(touch.review);

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
      <Link href={`/monthly-touch/${touch.id}?view=${stage}#workflow`} className="btn btn-primary">
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
        <Link href={`/monthly-touch/${touch.id}/legacy`} className="btn btn-ghost btn-sm">
          Open the original run-sheet
        </Link>
      </div>

      <GoogleMeetingPanel touchId={touch.id} emails={client.googleMeetingEmails} />

      <TouchProgressRail
        touchId={touch.id}
        progress={progress}
        current={step}
        resume={resume}
        followThroughDueAt={touch.followThrough?.dueAt}
        timeZone={profile.timeZone}
      />

      <div className="card mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="muted max-w-xl text-[0.84rem]">{primary.hint}</p>
        {primaryAction}
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

          {view === "review" ? (
            <>
              {/*
                The full Pre-Monthly Touch brief: the same fifteen sections that are posted to the
                Client's Book, replacing the five-question summary. The AM edits or declines them
                here and approves the lot once, in the agenda card at the bottom.

                Rendered even before the preparation has written a brief, so the screen says which
                sections are missing instead of hiding the step until a model call succeeds.
              */}
              <ReviewBrief
                touchId={touch.id}
                clientId={client.id}
                brief={touch.prepBrief || EMPTY_PREP_BRIEF}
                review={touch.review}
                header={
                  <BriefHeader
                    client={client}
                    touch={touch}
                    accountManager={{ name: profile.name, email: profile.email }}
                    timeZone={profile.timeZone}
                  />
                }
                agendaEmail={
                  <AgendaApprovalPanel
                    touchId={touch.id}
                    email={agendaEmail.state}
                    sent={agendaEmail.sent}
                    availableCc={agendaEmail.availableCc}
                    ccEnabled={agendaEmail.ccEnabled}
                    format={touch.live?.format || preferences.liveCallFormat || "guide"}
                    approval={touch.approval}
                    approving={sectionSummary.approving}
                    declined={sectionSummary.declined}
                    pageName={touchPageName(
                      touch.scheduledAt || prepPack?.schedule.scheduledAt || client.touchDate,
                      profile.timeZone,
                    )}
                  />
                }
              />
            </>
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

      {/* ---------- Live: the call itself, with the two generators behind it ---------- */}
      {view === "live" ? (
        <>
          <LiveCallStep
            touchId={touch.id}
            clientId={client.id}
            clientName={client.name}
            {...(touch.live ? { live: touch.live } : {})}
            plannedMinutes={callLengthMinutes(preferences.callLengthMinutes)}
            {...(touch.callGuide?.sections ? { sections: touch.callGuide.sections } : {})}
            {...(touch.presentation ? { presentation: touch.presentation } : {})}
            {...(touch.review?.declinedSections ? { declinedSections: touch.review.declinedSections } : {})}
            showQaChips={preferences.qaChipsInPresenterView ?? true}
          />

          {/*
            After "End call" the AM stays here, and this is what they wait on. Sticky at the bottom
            of the content column rather than a separate screen: the guide and their own capture
            notes are what they re-read while the transcript is being published.
          */}
          <TranscriptWaitPanel
            touchId={touch.id}
            {...(touch.live?.callEndedAt ? { callEndedAt: touch.live.callEndedAt } : {})}
            {...(touch.transcript ? { transcript: touch.transcript } : {})}
            followThroughHref={`/monthly-touch/${touch.id}/follow-through`}
          />

          <div className="card mt-4">
            <div className="card-head">
              <div className="card-title">The call itself</div>
            </div>
            <p className="text-[0.88rem] leading-7" style={{ color: "var(--text-2)" }}>
              Open the client&apos;s Google Meet here, then start the clock above when they join. Everything you type
              on this screen is saved against the part of the call you were in, and goes to the follow-through with
              the transcript.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <JoinMeetButton touch={touch} />
            </div>
            {touch.liveSession ? (
              <p className="muted mt-3 text-[0.8rem]">
                This touch also has notes from the older full-screen Live mode:{" "}
                {touch.liveSession.segments.filter((segment) => segment.notes.trim()).length} segments from{" "}
                {new Date(touch.liveSession.startedAt).toLocaleString()}. They are kept and go to the follow-through
                too — nothing was moved.
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2.5">{liveLauncher}</div>
          </div>

          <Section
            eyebrow="Live meeting"
            title="Live call guide"
            subtitle="The guide the call above reads from. Regenerate it here if the preparation changed."
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
            subtitle="The client-facing deck, built from the same preparation, with private presenter notes. On the call it opens in its own window, which is the window you share."
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
