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
import { GOAL_STATUSES } from "@/src/lib/contracts/follow-through-notes";
import {
  CANCEL_SPLIT_CATEGORIES,
  TICKET_PRIORITIES,
} from "@/src/lib/contracts/follow-through-tickets";
import {
  buildFollowThroughItems,
  saveFollowThroughItems,
} from "@/src/lib/server/services/follow-through-items-service";
import {
  buildFollowThroughRecap,
  saveFollowThroughRecap,
} from "@/src/lib/server/services/follow-through-recap-service";
import {
  buildTrackerCards,
  saveTrackerCards,
} from "@/src/lib/server/services/follow-through-trackers-service";
import {
  draftFollowThroughNotes,
  saveFollowThroughNotes,
} from "@/src/lib/server/services/follow-through-notes-service";
import {
  ScoreGateIncompleteError,
  analyzeScoreGate,
  confirmScoreGate,
  reopenScoreGate,
  saveScoreGate,
} from "@/src/lib/server/services/follow-through-score-service";

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

/**
 * The score gate as the screen sends it back.
 *
 * `score` is nullable on purpose and the three states are all different: absent means the AM has
 * not picked yet, null means they recorded that the call did not support a score, and a number is
 * a score. Collapsing null into absent would turn a decision into an omission.
 */
const scoreGateSchema = z.object({
  score: z.number().int().min(1).max(10).nullable().optional(),
  justification: z.string().optional(),
  justificationEdited: z.boolean().optional(),
  suggested: z.number().int().min(1).max(10).optional(),
  findings: z
    .array(
      z.object({
        id: z.enum(["money", "responsiveness", "lifeChange", "technical", "otherAgency", "performance"]),
        found: z.boolean(),
        evidence: z.string().optional(),
        timestamps: z.array(z.string()).optional(),
        severe: z.boolean().optional(),
      }),
    )
    .max(6)
    .optional(),
});

const actionLineSchema = z.object({
  id: z.string().min(1),
  what: z.string(),
  team: z.string(),
  due: z.string(),
  carryOver: z.boolean().optional(),
  crossDepartment: z.string().optional(),
  dependsOn: z.string().optional(),
});

/**
 * The notes as the editor sends them back.
 *
 * `amContext` is optional and may be the empty string, and the two mean different things: absent
 * is a box the AM never opened, empty is one they opened and left blank. Section 2 renumbers to
 * 2A/2B on the second, so collapsing them would silently change the document's headings.
 */
const notesDraftSchema = z.object({
  title: z.string(),
  nps: z.number().int().min(1).max(10).nullable(),
  npsJustification: z.string(),
  goalQuarter: z.string(),
  goalText: z.string(),
  goalStatus: z.enum(GOAL_STATUSES),
  goalEvidence: z.string(),
  summary: z.string(),
  bullets: z.record(z.string(), z.string()),
  amContext: z.string().optional(),
  departments: z.array(
    z.object({
      department: z.string(),
      clientFeedback: z.string(),
      actions: z.array(actionLineSchema),
    }),
  ),
  healthRisk: z
    .object({ playbook: z.string(), registerNote: z.string(), managerTag: z.string() })
    .optional(),
  clientActions: z.array(
    z.object({
      id: z.string().min(1),
      what: z.string(),
      due: z.string(),
      tentative: z.boolean().optional(),
      blocks: z.string().optional(),
    }),
  ),
  pending: z.array(
    z.object({
      id: z.string().min(1),
      waitingOn: z.enum(["Client", "AM review"]),
      missing: z.string(),
      from: z.string(),
      team: z.string(),
      owner: z.string(),
      reminderDate: z.string(),
    }),
  ),
});

const decisionEnum = z.enum(["approved", "denied", "deleted"]);

/** The ClickUp New Ticket form as the screen sends it back. */
const ticketFormSchema = z.object({
  id: z.string().min(1),
  formType: z.literal("ticket"),
  actionId: z.string().optional(),
  taskName: z.string(),
  businessName: z.string().optional(),
  description: z.string(),
  attachments: z.array(z.string()).optional(),
  timeEstimateMinutes: z.number().int().positive().optional(),
  department: z.string().optional(),
  assignee: z.string().optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  dueDate: z.string().optional(),
  dueDateAgreedOnCall: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  decision: decisionEnum.optional(),
});

/** The Billing Change form, which is a different form rather than a ticket with extra fields. */
const billingFormSchema = z.object({
  id: z.string().min(1),
  formType: z.literal("billing"),
  actionId: z.string().optional(),
  businessName: z.string().optional(),
  changeType: z.enum(["Upsell", "Downsell", "New Sale", "Pause", "Cancel", "Payment Failed"]).optional(),
  dateRequested: z.string().optional(),
  dueDate: z.string().optional(),
  assignee: z.string().optional(),
  attachments: z.array(z.string()).optional(),
  details: z.string(),
  cancelSplit: z.record(z.enum(CANCEL_SPLIT_CATEGORIES), z.number().int().min(0).max(5)).optional(),
  decision: decisionEnum.optional(),
});

const trackerDecision = z.enum(["approved", "denied", "deleted"]);

/**
 * The three tracker rows, each with its own field set.
 *
 * Written out per kind rather than as one permissive object: the Health Tracker's Case Status and
 * the Risk Register's are different value sets under the same name, and a shared loose shape
 * would let one be written into the other's row.
 */
const healthRowSchema = z.object({
  clientName: z.string().optional(),
  startDate: z.string().optional(),
  assignee: z.string().optional(),
  clientType: z.enum(["Direct", "White Label"]).optional(),
  accountManager: z.string().optional(),
  nps: z.number().int().min(1).max(10).nullable().optional(),
  status: z.string().optional(),
  caseStatus: z.enum(["—", "Watching", "Working", "downgraded"]).optional(),
  communicationType: z.enum(["Normal", "Distant", "Needy"]).optional(),
  mrr: z.string().optional(),
  upselling: z.enum(["Yes!", "Possible", "No way"]).optional(),
  health: z.enum(["Good", "Neutral", "Risk"]).optional(),
  email: z.string().optional(),
  services: z.array(z.string()).optional(),
  servicesUpsell: z.array(z.string()).optional(),
  latestComment: z.string().optional(),
});

const riskRowSchema = z.object({
  accountManager: z.string().optional(),
  clientType: z.enum(["Direct", "White Label"]).optional(),
  caseStatus: z
    .enum(["Watching", "Working", "Requested Cancellation", "Resolved-Healthy", "Downgraded"])
    .optional(),
  dateFlagged: z.string().optional(),
  money: z.enum(["Yes", "No"]).optional(),
  responsiveness: z.enum(["Yes", "No"]).optional(),
  lifeChange: z.enum(["Yes", "No", "maybe"]).optional(),
  technical: z.enum(["Yes", "No"]).optional(),
  otherAgency: z.enum(["Yes", "No", "kind of"]).optional(),
  performance: z.enum(["Yes", "No"]).optional(),
  riskScore: z.number().int().min(0).max(6).optional(),
  riskTier: z.enum(["Healthy", "Low", "Medium", "High", "Critical"]).optional(),
  primaryCategory: z
    .enum([
      "Communication",
      "Expectations",
      "Gen. Business",
      "Product",
      "Onboarding",
      "Money flow",
      "Billing Issue",
    ])
    .optional(),
  nextAction: z.string().optional(),
  nextActionOwner: z.string().optional(),
  dueDate: z.string().optional(),
  lastMonthlyTouch: z.string().optional(),
  latestComments: z.string().optional(),
});

const stakeholderRowSchema = z.object({
  clientName: z.string().optional(),
  assignee: z.string().optional(),
  clientType: z.enum(["Direct", "White Label"]).optional(),
  services: z.array(z.string()).optional(),
  role: z.string().optional(),
  communicationPreference: z.enum(["Phone", "Email", "Face-to-Face", "Text/Chat", "WhatsApp"]).optional(),
  marketingLiteracy: z.enum(["Low", "Medium", "High"]).optional(),
  personality: z.string().optional(),
  whatTheyCareAbout: z.string().optional(),
  knownHistory: z.string().optional(),
});

const trackerCardSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    kind: z.literal("health"),
    isNewRow: z.boolean().optional(),
    current: healthRowSchema.optional(),
    next: healthRowSchema,
    decision: trackerDecision.optional(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("risk"),
    isNewRow: z.boolean().optional(),
    current: riskRowSchema.optional(),
    next: riskRowSchema,
    decision: trackerDecision.optional(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("stakeholder"),
    personName: z.string().optional(),
    isNewRow: z.boolean().optional(),
    current: stakeholderRowSchema.optional(),
    next: stakeholderRowSchema,
    decision: trackerDecision.optional(),
  }),
]);

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
  // The follow-through's first screen. `analyze_score_gate` reads the transcript for the six red
  // flags; the other three are the AM's own decisions about the score, so each is its own action
  // rather than one "save" that could not tell a draft from a confirmation.
  z.object({ action: z.literal("analyze_score_gate") }),
  z.object({ action: z.literal("save_score_gate"), gate: scoreGateSchema }),
  z.object({ action: z.literal("confirm_score_gate"), gate: scoreGateSchema }),
  z.object({ action: z.literal("reopen_score_gate") }),
  // Drafting is its own action and overwrites the AM's edits, so the screen warns before it.
  z.object({ action: z.literal("draft_notes") }),
  z.object({ action: z.literal("save_notes"), notes: notesDraftSchema }),
  // Building keeps every item the AM has already decided on; only new action lines get a form.
  z.object({ action: z.literal("build_items") }),
  z.object({ action: z.literal("build_tracker_cards") }),
  z.object({ action: z.literal("build_recap") }),
  z.object({
    action: z.literal("save_recap"),
    recap: z.object({
      subject: z.string(),
      html: z.string(),
      decision: z.enum(["approved", "denied", "deleted"]).optional(),
      edited: z.boolean().optional(),
    }),
  }),
  z.object({ action: z.literal("save_tracker_cards"), cards: z.array(trackerCardSchema) }),
  z.object({
    action: z.literal("save_items"),
    items: z.array(z.discriminatedUnion("formType", [ticketFormSchema, billingFormSchema])),
  }),
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
      case "analyze_score_gate":
        result = await analyzeScoreGate(context, touchId);
        break;
      case "save_score_gate":
        result = { gate: await saveScoreGate(context, touchId, payload.gate) };
        break;
      case "confirm_score_gate":
        result = { gate: await confirmScoreGate(context, touchId, payload.gate) };
        break;
      case "reopen_score_gate":
        result = { gate: await reopenScoreGate(context, touchId) };
        break;
      case "draft_notes":
        result = await draftFollowThroughNotes(context, touchId);
        break;
      case "save_notes":
        result = { notes: await saveFollowThroughNotes(context, touchId, payload.notes) };
        break;
      case "build_recap":
        result = await buildFollowThroughRecap(context, touchId);
        break;
      case "save_recap":
        result = { recap: await saveFollowThroughRecap(context, touchId, payload.recap) };
        break;
      case "build_tracker_cards":
        result = await buildTrackerCards(context, touchId);
        break;
      case "save_tracker_cards":
        result = { cards: await saveTrackerCards(context, touchId, payload.cards) };
        break;
      case "build_items":
        result = await buildFollowThroughItems(context, touchId);
        break;
      case "save_items":
        result = { items: await saveFollowThroughItems(context, touchId, payload.items) };
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
    // The same shape as the review's own refusal: the first sentence for the toast, the whole
    // list for the screen, and 409 because nothing is wrong with the request -- the AM has not
    // finished deciding.
    if (error instanceof ScoreGateIncompleteError) {
      return NextResponse.json(
        { error: error.blockers[0], blockers: error.blockers },
        { status: 409 },
      );
    }
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
