import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import {
  PrepStageBlockedError,
  approveConfirmationEmailStage,
  approvePrepNotesStage,
  filePrepNotesStage,
  generateConfirmationEmailStage,
  generatePrepNotesStage,
  markConfirmationEmailSentStage,
  runResearchStage,
  sendConfirmationEmailStage,
} from "@/src/lib/server/services/prep-workflow-service";

/**
 * The staged preparation workflow.
 *
 * One action per request, deliberately. The old single `prepare_and_generate` action did the data
 * pulls and the analysis in one call and ran past the function ceiling, and an AM whose request was
 * killed mid-run got a parse error and no idea what had been saved. Each stage here is its own
 * request with its own budget, and each one persists what it achieved before returning.
 *
 * The order is enforced in the service, not here: a request for a stage whose prerequisite is not
 * satisfied comes back 409 with the reason, so the rule holds for any caller, not only the screen.
 */
export const maxDuration = 300;

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run_research") }),
  z.object({
    action: z.literal("generate_confirmation_email"),
    timeZone: z.string().max(100).optional(),
    recipient: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal("approve_confirmation_email"),
    subject: z.string().min(1).max(400),
    body: z.string().min(1).max(20000),
    recipient: z.string().max(200).optional(),
    timeZone: z.string().max(100).optional(),
  }),
  z.object({ action: z.literal("send_confirmation_email") }),
  z.object({
    action: z.literal("mark_confirmation_email_sent"),
    channel: z.string().min(1).max(200),
    sentAt: z.string().max(60).optional(),
  }),
  z.object({ action: z.literal("generate_prep_notes") }),
  z.object({ action: z.literal("approve_prep_notes") }),
  z.object({ action: z.literal("file_prep_notes") }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  const context = await resolveTenantContext(request);
  const { touchId } = await params;

  let payload: z.infer<typeof requestSchema>;
  try {
    payload = requestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That isn't a preparation action MTOS knows." },
      { status: 400 },
    );
  }

  try {
    const result = await (async () => {
      switch (payload.action) {
        case "run_research":
          return runResearchStage(context, touchId);
        case "generate_confirmation_email":
          return generateConfirmationEmailStage(context, touchId, {
            ...(payload.timeZone ? { timeZone: payload.timeZone } : {}),
            ...(payload.recipient ? { recipient: payload.recipient } : {}),
          });
        case "approve_confirmation_email":
          return approveConfirmationEmailStage(context, touchId, {
            subject: payload.subject,
            body: payload.body,
            ...(payload.recipient ? { recipient: payload.recipient } : {}),
            ...(payload.timeZone ? { timeZone: payload.timeZone } : {}),
          });
        case "send_confirmation_email":
          return sendConfirmationEmailStage(context, touchId);
        case "mark_confirmation_email_sent":
          return markConfirmationEmailSentStage(context, touchId, {
            channel: payload.channel,
            ...(payload.sentAt ? { sentAt: payload.sentAt } : {}),
          });
        case "generate_prep_notes":
          return generatePrepNotesStage(context, touchId);
        case "approve_prep_notes":
          return approvePrepNotesStage(context, touchId);
        case "file_prep_notes":
          return filePrepNotesStage(context, touchId);
      }
    })();

    return NextResponse.json({
      context,
      data: {
        message: result.message,
        workflow: result.workflow,
        touch: result.touch,
      },
    });
  } catch (error) {
    // A blocked stage is not a bad request and not a server fault -- it is the workflow holding the
    // line. 409 so a caller can tell the two apart, with the reason the AM should read.
    if (error instanceof PrepStageBlockedError) {
      return NextResponse.json({ error: error.message, stage: error.stage }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The preparation action failed." },
      { status: 400 },
    );
  }
}
