import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { canReadQcRecord, canScoreQc } from "@/src/lib/contracts/qc-access";
import type { QcCriterionNote, QcDraftValue } from "@/src/lib/contracts/qc-record";
import { QC_CRITERION_COUNT } from "@/src/lib/contracts/qc-rubric";
import { getQcIndexRow } from "@/src/lib/server/services/qc-queue-service";
import {
  resolveQcAppeal,
  saveQcDraft,
  startQcReview,
  submitQcScore,
  type QcWriteOutcome,
} from "@/src/lib/server/services/qc-review-service";

/**
 * The QC write route: open a review, autosave it, submit it, decide an appeal.
 *
 * ## Its own route, not four more cases on the touch route
 *
 * `/api/monthly-touches/[touchId]` is thirty kilobytes and roughly forty actions. Adding QC to it
 * would put a reviewer's writes behind the same validation union as every AM action on the same
 * document, and the screens that call them have different permissions entirely -- an AM may do
 * forty things to their own touch and none of them is scoring it. A separate route keeps the role
 * check at the top, where it can be read in one glance, and keeps the QC actions out of a file
 * nobody can hold in their head.
 *
 * ## Every action is a reviewer's
 *
 * All four require `canScoreQc`, which is `qa_reviewer` alone -- not an admin and not a manager,
 * both of whom may *read* the queue. The reason is in `qc-access.ts`: a score is only comparable
 * across a team if one calibrated person produces all of them, and the AM's own page draws a trend
 * from exactly that comparison.
 *
 * The role is read from the session, never from the request body. `resolveTenantContext` falls back
 * to `account_manager` when there is no session, so an unauthenticated call fails the check rather
 * than passing it -- the failure mode is closed.
 */

/** A criterion as the form can send it: a grade, an explicit N/A, or undecided. */
const critValue = z.union([
  z.literal(-1),
  z.null(),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const critArray = z.array(critValue).max(QC_CRITERION_COUNT);

const noteSchema = z.object({
  found: z.string().max(4000).optional(),
  next: z.string().max(4000).optional(),
});

/** Keys arrive as strings over JSON and are criterion numbers underneath. */
const notesSchema = z.record(z.string(), noteSchema);

const coachingSchema = z.array(
  z.object({
    idea: z.string().max(2000),
    why: z.string().max(4000).optional(),
    how: z.string().max(4000).optional(),
    skip: z.string().max(2000).optional(),
  }),
);

const goalSchema = z.enum(["Yes", "Partial", "No", "N/A"]);

const draftFields = {
  crit: critArray,
  notes: notesSchema.optional(),
  goal: goalSchema.optional(),
  strengths: z.string().max(8000).optional(),
  focus: z.string().max(8000).optional(),
  coaching: coachingSchema.optional(),
};

const qcRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start_qc") }),
  z.object({ action: z.literal("save_qc_draft"), ...draftFields }),
  // The goal is required here and optional in a draft: a draft is allowed to be unfinished, and a
  // submission is not. The service checks it again against the stored record regardless.
  z.object({ action: z.literal("submit_qc"), ...draftFields, goal: goalSchema }),
  z.object({
    action: z.literal("resolve_qc_appeal"),
    decisions: z.array(
      z.object({ n: z.number().int(), to: z.number().int().min(1).max(5), accept: z.boolean() }),
    ),
    reply: z.string().max(8000).optional(),
  }),
]);

/** JSON gives string keys; the record is keyed by criterion number. Unparseable keys are dropped. */
function toNumberKeyedNotes(
  notes: Record<string, { found?: string; next?: string }> | undefined,
): Record<number, QcCriterionNote> | undefined {
  if (!notes) return undefined;
  const out: Record<number, QcCriterionNote> = {};
  for (const [key, note] of Object.entries(notes)) {
    const n = Number(key);
    if (!Number.isInteger(n)) continue;
    out[n] = note;
  }
  return out;
}

function coachingOf(items: z.infer<typeof coachingSchema> | undefined) {
  return items?.map((item) => ({
    idea: item.idea,
    why: item.why || "",
    how: item.how || "",
    skip: item.skip || "",
  }));
}

function respond(outcome: QcWriteOutcome) {
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.reason }, { status: outcome.status });
  }
  return NextResponse.json({
    data: {
      qc: outcome.qc,
      ...(outcome.notified === undefined ? {} : { notified: outcome.notified }),
    },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  const context = await resolveTenantContext(request);
  const { touchId } = await params;

  // The index row is read first, and it is the cheap one: it says whether this touch is with QC at
  // all and whose it is, before anything opens the touch document itself.
  const row = await getQcIndexRow(context, touchId).catch(() => undefined);
  if (!row) {
    // Deliberately the same answer for "no such touch" and "not with QC": neither tells a caller
    // anything about a record they have no business knowing exists.
    return NextResponse.json({ error: "This touch is not with QC." }, { status: 404 });
  }
  if (!canReadQcRecord(context.role, context.userId, row.amId)) {
    return NextResponse.json({ error: "You do not have access to this QC record." }, { status: 403 });
  }
  if (!canScoreQc(context.role)) {
    return NextResponse.json(
      { error: "Only a QC reviewer can score a touch or decide an appeal." },
      { status: 403 },
    );
  }

  try {
    const raw = await request.json().catch(() => ({}));
    const payload = qcRequestSchema.parse(raw);

    switch (payload.action) {
      case "start_qc":
        return respond(await startQcReview(context, touchId));

      case "save_qc_draft":
        return respond(
          await saveQcDraft(context, touchId, {
            crit: payload.crit as QcDraftValue[],
            ...(toNumberKeyedNotes(payload.notes) ? { notes: toNumberKeyedNotes(payload.notes) } : {}),
            ...(payload.goal ? { goal: payload.goal } : {}),
            ...(payload.strengths === undefined ? {} : { strengths: payload.strengths }),
            ...(payload.focus === undefined ? {} : { focus: payload.focus }),
            ...(coachingOf(payload.coaching) ? { coaching: coachingOf(payload.coaching) } : {}),
          }),
        );

      case "submit_qc":
        return respond(
          await submitQcScore(context, touchId, {
            crit: payload.crit as QcDraftValue[],
            goal: payload.goal,
            ...(toNumberKeyedNotes(payload.notes) ? { notes: toNumberKeyedNotes(payload.notes) } : {}),
            ...(payload.strengths === undefined ? {} : { strengths: payload.strengths }),
            ...(payload.focus === undefined ? {} : { focus: payload.focus }),
            ...(coachingOf(payload.coaching) ? { coaching: coachingOf(payload.coaching) } : {}),
          }),
        );

      case "resolve_qc_appeal":
        return respond(
          await resolveQcAppeal(context, touchId, payload.decisions, payload.reply),
        );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "That QC request was not in a shape this route accepts." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The QC action failed." },
      { status: 400 },
    );
  }
}
