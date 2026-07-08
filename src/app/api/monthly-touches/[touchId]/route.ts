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
import { generateQaReview, recordVictorDecision } from "@/src/lib/server/services/qa-review-service";

const touchRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare") }),
  z.object({ action: z.literal("prepare_and_generate") }),
  z.object({ action: z.literal("generate_call_guide") }),
  z.object({ action: z.literal("analyze_transcript"), transcript: z.string().min(1) }),
  z.object({
    action: z.literal("apply_post_meeting_decisions"),
    ticketDecisions: z.record(z.string(), z.enum(["approved", "declined"])),
    approveEmail: z.boolean(),
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
      case "prepare_and_generate":
        result = await prepareMonthlyTouch(context, touchId, {
          includeClaude: payload.action === "prepare_and_generate",
        });
        break;
      case "generate_call_guide":
        result = await generateLiveCallGuide(context, touchId);
        break;
      case "analyze_transcript":
        result = await analyzePostMeetingTranscript(context, touchId, payload.transcript);
        break;
      case "apply_post_meeting_decisions":
        result = await applyPostMeetingDecisions(context, touchId, {
          ticketDecisions: payload.ticketDecisions,
          approveEmail: payload.approveEmail,
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
