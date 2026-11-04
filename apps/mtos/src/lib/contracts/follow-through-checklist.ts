import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";

/**
 * The post-touch checklist: the eight things that should have happened, and whether they did.
 *
 * This is the brief's section 8 as the handoff numbers it, and it sits beside the follow-through
 * rather than inside it, because its job is to be glanceable while the AM works down the page.
 *
 * ## It reads the record, it does not take anyone's word for it
 *
 * Every row is answered from what the touch actually stores -- a sent timestamp, a filed page id,
 * a created ticket id -- and never from a step having been *attempted*. A processing run that
 * reported a warning is a step that did not happen, and this says so. The reason that matters:
 * the AM's own memory of a Finish they pressed twenty minutes ago is the least reliable thing in
 * the room, and the one thing they will be asked about is whether the client got the recap.
 *
 * ## The same eight rows are the QC evidence snapshot
 *
 * The handoff asks QC to be handed `{label, detail, ok}` in this exact order when the touch is
 * passed over. That is this list, which is why it lives in a contract of its own rather than
 * inside the sidebar that currently draws it: one answer to "did this happen", shown to the AM
 * while they can still fix it and to QC when they score it. If the two were derived separately
 * they would eventually disagree, and the disagreement would surface as QC marking down a step
 * the AM's own screen had ticked.
 */

export interface ChecklistRow {
  /** The handoff's own label for this step, kept exact so a QC record lines up with the screen. */
  label: string;
  /** What happened, or what still has to. Always written -- a row with no line reads as a mystery. */
  detail: string;
  ok: boolean;
}

function processingStep(touch: MonthlyTouchRecord, id: string) {
  return touch.followThrough?.processing?.steps?.find((step) => step.id === id);
}

/**
 * A row for a step the processing run owns: done only when the run reported it done.
 *
 * The label is given rather than taken from `PROCESSING_STEPS`, because these are the handoff's
 * evidence labels -- short, and the ones a QC record is keyed by. The processing step's own label
 * is a sentence about what the button is going to do, which is right on the button and wrong here.
 */
function processedRow(
  touch: MonthlyTouchRecord,
  id: string,
  label: string,
  pending: string,
): ChecklistRow {
  const step = processingStep(touch, id);
  if (!step) return { label, detail: pending, ok: false };
  return {
    label,
    detail: step.message,
    // A warning is not a success. The step ran, something was left for the AM, and a tick here
    // would be the screen telling them to stop looking.
    ok: step.status === "done",
  };
}

/**
 * The eight rows, in the handoff's order.
 *
 * The order is the order the work happens in, which is also the order an AM scans when a client
 * asks "did you send me anything?" -- agenda first, recap near the end.
 */
export function followThroughChecklist(touch: MonthlyTouchRecord): ChecklistRow[] {
  const agendaSentAt = touch.agendaEmail?.sentAt;
  const bookPage = touch.approval?.clientBook;
  const transcript = touch.transcript;
  const notes = touch.followThrough?.notes;
  const ticketCount = Object.keys(touch.followThrough?.ticketIds || {}).length;

  return [
    {
      label: "Agenda emailed",
      // No timestamp in the line: this is a contract and has no business knowing the AM's time
      // zone, and a raw ISO string on a screen is worse than no time at all.
      detail: agendaSentAt
        ? `Sent${touch.agendaEmail?.sentVia ? ` via ${touch.agendaEmail.sentVia}` : ""}.`
        : touch.agendaEmail?.declined
          ? "Declined — you marked it as already sent or not to send."
          : "Not sent yet. It goes out with the approval on the review step.",
      // A declined agenda is a decision the AM made, not an outstanding task, so it counts as
      // settled. QC is told which of the two it was by the line, not by the tick.
      ok: Boolean(agendaSentAt) || touch.agendaEmail?.declined === true,
    },
    {
      label: "Prep page in the Client's Book",
      detail: bookPage?.pageName
        ? `Filed as ${bookPage.pageName}.`
        : "Not filed. The approval on the review step posts it.",
      ok: Boolean(bookPage?.pageId || bookPage?.pageUrl),
    },
    {
      label: "Transcript",
      detail:
        transcript?.status === "found" || transcript?.status === "attached"
          ? `${transcript.status === "attached" ? "Attached by hand" : "Found on the calendar event"}${
              transcript.docIds?.length
                ? ` · ${transcript.docIds.length} ${transcript.docIds.length === 1 ? "document" : "documents"}`
                : ""
            }.`
          : "Not in yet. The notes below are drafted from it, so anything written before it arrives is yours, not the call's.",
      ok: transcript?.status === "found" || transcript?.status === "attached",
    },
    {
      label: "Post-touch notes",
      detail: notes
        ? processingStep(touch, "notes")?.message || "Drafted, not yet filed in the Client's Book."
        : "Not drafted. Confirm the account health score to draft them.",
      ok: processingStep(touch, "notes")?.status === "done",
    },
    {
      label: "Tickets",
      detail: ticketCount
        ? `${ticketCount} created in ClickUp.`
        : processingStep(touch, "tickets")?.message || "None created. Approve the ones you want and press Finish.",
      // Counted from stored ids rather than the step's status, because this is the one row where
      // "some of them" is the common answer and the number is what the AM needs.
      ok: ticketCount > 0 || processingStep(touch, "tickets")?.status === "skipped",
    },
    processedRow(touch, "recap", "Recap email", "Not sent. It goes out when you press Finish."),
    processedRow(touch, "health", "Health Tracker", "Not updated. The approved row is written when you press Finish."),
    processedRow(touch, "booking", "Next touch", "Not booked. Finish books it, or creates a reminder ticket instead."),
  ];
}

/** How many rows are settled, for the "{ok} of {total}" chip the QC queue shows. */
export function checklistProgress(rows: ChecklistRow[]): { ok: number; total: number } {
  return { ok: rows.filter((row) => row.ok).length, total: rows.length };
}
