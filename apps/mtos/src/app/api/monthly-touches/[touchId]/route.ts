import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { monthlyTouchWorkspaceResponse } from "@/src/lib/api/mtos-query";
import { prepareMonthlyTouch } from "@/src/lib/server/services/monthly-touch-prep-service";
import { runResearchStage } from "@/src/lib/server/services/prep-workflow-service";
import { generatePresentation } from "@/src/lib/server/services/presentation-service";
import { generateLiveCallGuide } from "@/src/lib/server/services/live-call-guide-service";
import {
  analyzePostMeetingTranscript,
  applyPostMeetingDecisions,
} from "@/src/lib/server/services/post-meeting-service";
import {
  applyClientIntelligenceDecisions,
  recordClientHealth,
  retryClientIntelligence,
} from "@/src/lib/server/services/client-intelligence-service";
import {
  applyPostMeetingReview,
  PostMeetingReviewIncompleteError,
} from "@/src/lib/server/services/post-meeting-review-service";
import { generateQaReview, recordVictorDecision } from "@/src/lib/server/services/qa-review-service";
import { advanceTouchProgress, saveTouchDraft } from "@/src/lib/server/services/touch-state-service";
import { agendaEmailPatch } from "@/src/lib/server/services/agenda-email-service";
import { approveAndPrepareCall } from "@/src/lib/server/services/touch-approval-service";
import {
  attachTouchTranscript,
  watchTouchTranscript,
} from "@/src/lib/server/services/transcript-watch-service";

// One Generate now runs the prep pack and the live call guide back to back -- several
// model calls plus the dashboard pulls. Matches the ceiling the other long-running
// routes already use so the combined run isn't cut off mid-generation.
export const maxDuration = 300;

const yesNoSchema = z.enum(["Yes", "No"]);
const riskRegisterSchema = z.object({
  accountManager: z.string().optional(),
  clientType: z.enum(["Direct", "White Label"]).optional(),
  caseStatus: z.enum(["Watching", "Working", "Requested Cancellation", "Resolved-Healthy"]).optional(),
  dateFlagged: z.string().optional(),
  money: yesNoSchema.optional(),
  responsiveness: yesNoSchema.optional(),
  lifeChange: z.enum(["Yes", "No", "maybe"]).optional(),
  technical: yesNoSchema.optional(),
  otherAgency: z.enum(["Yes", "No", "kind of"]).optional(),
  performance: yesNoSchema.optional(),
  riskScore: z.number().optional(),
  riskTier: z.enum(["Healthy", "Low", "Medium", "High", "Critical"]).optional(),
  primaryCategory: z.enum(["Communication", "Expectations", "Gen. Business", "Product", "Onboarding"]).optional(),
  nextAction: z.string().optional(),
  nextActionOwner: z.string().optional(),
  dueDate: z.string().optional(),
  lastMonthlyTouch: z.string().optional(),
  latestComments: z.string().optional(),
  decision: z.enum(["approved", "declined"]),
});
const stakeholderMapSchema = z.object({
  clientName: z.string().optional(),
  assignee: z.string().optional(),
  clientType: z.enum(["Direct", "White Label"]).optional(),
  services: z.array(z.string()).optional(),
  role: z.string().optional(),
  communicationPreference: z.enum(["Phone", "Email", "Face-to-Face", "Text/Chat"]).optional(),
  marketingLiteracy: z.enum(["Low", "Medium", "High"]).optional(),
  personality: z.string().optional(),
  whatTheyCareAbout: z.string().optional(),
  knownHistory: z.string().optional(),
  decision: z.enum(["approved", "declined"]),
});

const touchRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare") }),
  z.object({ action: z.literal("prepare_with_ai") }),
  z.object({ action: z.literal("prepare_and_generate") }),
  z.object({ action: z.literal("generate_call_guide") }),
  z.object({ action: z.literal("generate_presentation") }),
  z.object({ action: z.literal("analyze_transcript"), transcript: z.string().min(1) }),
  // The one-minute poll the Live step runs after "End call". A POST rather than the read-only
  // GET beside it because a GET route handler can be prerendered or cached under Cache
  // Components, and a cached answer to "has the transcript arrived yet" would say no forever.
  z.object({ action: z.literal("watch_transcript") }),
  // The AM pasting the dialogue themselves: a call on Zoom, a call hosted by the client, a call
  // nobody transcribed. Stored as attached, so no later poll overrules it.
  z.object({ action: z.literal("attach_transcript"), transcript: z.string().min(1) }),
  z.object({
    action: z.literal("apply_post_meeting_decisions"),
    tickets: z.array(
      z.object({
        id: z.string().min(1),
        title: z.string(),
        description: z.string(),
        department: z.enum(["SEO", "Web Design", "Ads", "Account Manager", "Other"]),
        assigneeId: z.number().optional(),
        assignee: z.string().optional(),
        businessOptionId: z.string().optional(),
        businessName: z.string().optional(),
        priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
        timeEstimateMinutes: z.number().optional(),
        dueDate: z.string().optional(),
        ticketType: z.enum(["regular", "billing"]).optional(),
        billingChangeType: z
          .enum(["Upsell", "Downsell", "New Sale", "Pause", "Cancel", "Payment Failed"])
          .optional(),
        dateRequested: z.string().optional(),
        decision: z.enum(["approved", "declined"]),
      }),
    ),
    email: z.object({ subject: z.string(), body: z.string(), approve: z.boolean() }),
  }),
  /**
   * The whole review in one submission: the score, every ticket decision, the two register
   * entries and the client email. This is the one the screen uses -- the three narrower actions
   * above stay for older clients and for re-applying a single piece.
   */
  z.object({
    action: z.literal("apply_post_meeting_review"),
    nps: z.number().int().min(0).max(10).nullable(),
    npsReason: z.string(),
    riskTier: z.enum(["Healthy", "Low", "Medium", "High", "Critical"]).optional(),
    riskReason: z.string().optional(),
    tickets: z.array(
      z.object({
        id: z.string().min(1),
        title: z.string(),
        description: z.string(),
        department: z.enum(["SEO", "Web Design", "Ads", "Account Manager", "Other"]),
        assigneeId: z.number().optional(),
        assignee: z.string().optional(),
        businessOptionId: z.string().optional(),
        businessName: z.string().optional(),
        priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
        timeEstimateMinutes: z.number().optional(),
        dueDate: z.string().optional(),
        ticketType: z.enum(["regular", "billing"]).optional(),
        billingChangeType: z
          .enum(["Upsell", "Downsell", "New Sale", "Pause", "Cancel", "Payment Failed"])
          .optional(),
        dateRequested: z.string().optional(),
        decision: z.enum(["approved", "declined"]),
      }),
    ),
    email: z.object({ subject: z.string(), body: z.string(), approve: z.boolean() }),
    riskRegister: riskRegisterSchema.optional(),
    stakeholderMap: stakeholderMapSchema.optional(),
  }),
  z.object({ action: z.literal("retry_client_intelligence") }),
  z.object({
    action: z.literal("apply_client_intelligence"),
    riskRegister: riskRegisterSchema.optional(),
    stakeholderMap: stakeholderMapSchema.optional(),
  }),
  z.object({
    action: z.literal("record_client_health"),
    // NPS is the standard 0-10 scale; null when the AM genuinely couldn't get one.
    nps: z.number().int().min(0).max(10).nullable(),
    npsReason: z.string(),
    riskTier: z.enum(["Healthy", "Low", "Medium", "High", "Critical"]).optional(),
    riskReason: z.string().optional(),
  }),
  z.object({ action: z.literal("generate_qa_review") }),
  z.object({
    action: z.literal("record_victor_decision"),
    decision: z.enum(["approved", "changes_requested"]),
    note: z.string().optional(),
  }),
  // The one approval at the end of the review step. Everything it does leaves MTOS, so it happens
  // only on this explicit request and never as a side effect of loading a screen.
  z.object({
    action: z.literal("approve_and_go_live"),
    format: z.enum(["guide", "deck"]).optional(),
    makeDefault: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("advance_progress"),
    step: z.enum(["prep", "review", "live", "follow", "qa"]),
  }),
  // The autosave behind the review, the agenda email and the live screens. Every field is
  // optional because the screens send only what changed; at least one of the three groups must be
  // present, which the service enforces rather than the schema so the message can say so plainly.
  z.object({
    action: z.literal("save_touch_draft"),
    review: z
      .object({
        declinedSections: z.array(z.string()).optional(),
        sectionEdits: z.record(z.string(), z.string()).optional(),
        coaching: z
          .record(
            z.string(),
            z.object({ choice: z.enum(["use", "adapt", "skip"]), reason: z.string().optional() }),
          )
          .optional(),
        approvedAt: z.string().optional(),
        approvedBy: z.string().optional(),
      })
      .optional(),
    // `sentAt`, `sentVia` and the Intercom conversation id are deliberately NOT accepted here.
    // They are the record that the client actually received something, and only the approval
    // service writes them, from Intercom's own answer. A screen that could set them could make a
    // touch claim an email went out that never did.
    agendaEmail: z
      .object({
        subject: z.string().optional(),
        html: z.string().optional(),
        declined: z.boolean().optional(),
        recipient: z.string().optional(),
      })
      .optional(),
    live: z
      .object({
        format: z.enum(["guide", "deck"]).optional(),
        readyAt: z.string().optional(),
        callStartedAt: z.string().optional(),
        callEndedAt: z.string().optional(),
        notes: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
  }),
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ touchId: string }> },
) {
  const context = await resolveTenantContext(request);
  const { touchId } = await params;
  const payload = await monthlyTouchWorkspaceResponse(context, touchId);

  if (!payload) {
    return NextResponse.json({ error: "Monthly touch not found" }, { status: 404 });
  }

  return NextResponse.json(payload);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ touchId: string }> },
) {
  const context = await resolveTenantContext(request);

  try {
    const rawPayload = await request.json().catch(() => ({}));
    const payload = touchRequestSchema.parse(
      typeof rawPayload === "object" && rawPayload && "action" in rawPayload
        ? rawPayload
        : { ...rawPayload, action: "prepare_and_generate" },
    );
    const { touchId } = await params;

    let result: unknown;

    switch (payload.action) {
      case "prepare":
        result = await prepareMonthlyTouch(context, touchId, { includeClaude: false });
        break;
      case "prepare_with_ai":
        // Half of what Generate used to do in one request. The prep pack and the call guide are
        // each a full model call on top of the dashboard pulls, and together they ran past the
        // 300s function ceiling and were killed mid-run. Split across two requests each half gets
        // its own budget, and a failure in the second half leaves the prep pack already saved.
        //
        // Routed through the workflow's research stage so that whichever screen an AM starts from,
        // the account review is recorded as stage 1 with the sources it reached -- and judged
        // honestly, rather than reporting success when the analysis half failed.
        result = await runResearchStage(context, touchId);
        break;
      case "prepare_and_generate":
        // One Generate action produces both halves of the workspace: the preparation
        // pack and the interactive live call guide built from it. The AM scrolls from
        // preparing straight into presenting, so the guide is never a second step.
        await runResearchStage(context, touchId);
        {
          // The guide re-reads the touch the prep just persisted, so its copy carries
          // the fresh prep pack too -- keep the response shape prep callers expect.
          const generated = await generateLiveCallGuide(context, touchId);
          result = { touch: generated.touch, prepPack: generated.touch.prepPack };
        }
        break;
      case "generate_call_guide":
        result = await generateLiveCallGuide(context, touchId);
        break;
      case "generate_presentation":
        // The other delivery format. Deliberately its own action rather than part of
        // Generate: the AM picks a format after reading the prep, and building both
        // every time would double the model spend on a deck half of them never open.
        result = await generatePresentation(context, touchId);
        break;
      case "watch_transcript":
        result = await watchTouchTranscript(context, touchId);
        break;
      case "attach_transcript":
        result = await attachTouchTranscript(context, touchId, payload.transcript);
        break;
      case "analyze_transcript":
        result = await analyzePostMeetingTranscript(context, touchId, payload.transcript);
        break;
      case "apply_post_meeting_decisions":
        result = await applyPostMeetingDecisions(context, touchId, {
          tickets: payload.tickets,
          email: payload.email,
        });
        break;
      case "apply_post_meeting_review":
        result = await applyPostMeetingReview(context, touchId, {
          nps: payload.nps,
          npsReason: payload.npsReason,
          riskTier: payload.riskTier,
          riskReason: payload.riskReason,
          tickets: payload.tickets,
          email: payload.email,
          ...(payload.riskRegister
            ? { riskRegister: { decision: payload.riskRegister.decision, entry: payload.riskRegister } }
            : {}),
          ...(payload.stakeholderMap
            ? { stakeholderMap: { decision: payload.stakeholderMap.decision, entry: payload.stakeholderMap } }
            : {}),
        });
        break;
      case "retry_client_intelligence":
        result = await retryClientIntelligence(context, touchId);
        break;
      case "apply_client_intelligence":
        result = await applyClientIntelligenceDecisions(context, touchId, {
          riskRegister: payload.riskRegister,
          stakeholderMap: payload.stakeholderMap,
        });
        break;
      case "record_client_health":
        result = await recordClientHealth(context, touchId, {
          nps: payload.nps,
          npsReason: payload.npsReason,
          riskTier: payload.riskTier,
          riskReason: payload.riskReason,
        });
        break;
      case "generate_qa_review":
        result = await generateQaReview(context, touchId);
        break;
      case "record_victor_decision":
        result = await recordVictorDecision(context, touchId, payload.decision, payload.note);
        break;
      case "advance_progress":
        result = await advanceTouchProgress(context, touchId, payload.step);
        break;
      case "save_touch_draft":
        result = await saveTouchDraft(context, touchId, {
          ...(payload.review ? { review: payload.review } : {}),
          // The HTML comes out of a rich-text editor, so it is cleaned here rather than only in
          // the browser: this is the copy that is stored and the copy that is sent.
          ...(payload.agendaEmail ? { agendaEmail: agendaEmailPatch(payload.agendaEmail) } : {}),
          ...(payload.live ? { live: payload.live } : {}),
        });
        break;
      case "approve_and_go_live":
        result = await approveAndPrepareCall(context, touchId, {
          ...(payload.format ? { format: payload.format } : {}),
          ...(payload.makeDefault !== undefined ? { makeDefault: payload.makeDefault } : {}),
        });
        break;
    }

    return NextResponse.json({
      context,
      data: result,
    });
  } catch (error) {
    // An incomplete review is the AM having more to decide, not a bad request. 409 and the list of
    // what is left keeps the screen's state intact so nothing they typed has to be retyped.
    if (error instanceof PostMeetingReviewIncompleteError) {
      return NextResponse.json(
        { error: error.blockers[0], blockers: error.blockers },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Monthly touch action failed",
      },
      { status: 400 },
    );
  }
}
