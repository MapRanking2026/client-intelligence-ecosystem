import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { monthlyTouchWorkspaceResponse } from "@/src/lib/api/mtos-query";
import { prepareMonthlyTouch } from "@/src/lib/server/services/monthly-touch-prep-service";
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
import { generateQaReview, recordVictorDecision } from "@/src/lib/server/services/qa-review-service";

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
  z.object({ action: z.literal("prepare_and_generate") }),
  z.object({ action: z.literal("generate_call_guide") }),
  z.object({ action: z.literal("analyze_transcript"), transcript: z.string().min(1) }),
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
      case "prepare_and_generate":
        // One Generate action produces both halves of the workspace: the preparation
        // pack and the interactive live call guide built from it. The AM scrolls from
        // preparing straight into presenting, so the guide is never a second step.
        await prepareMonthlyTouch(context, touchId, { includeClaude: true });
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
      case "analyze_transcript":
        result = await analyzePostMeetingTranscript(context, touchId, payload.transcript);
        break;
      case "apply_post_meeting_decisions":
        result = await applyPostMeetingDecisions(context, touchId, {
          tickets: payload.tickets,
          email: payload.email,
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
    }

    return NextResponse.json({
      context,
      data: result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Monthly touch action failed",
      },
      { status: 400 },
    );
  }
}
