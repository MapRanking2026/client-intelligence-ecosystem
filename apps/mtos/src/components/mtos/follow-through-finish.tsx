"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Eye, Loader2, Minus, Rocket, X } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import { NextTouchBookingControl } from "@/src/components/mtos/next-touch-booking";
import {
  PROCESSING_STEPS,
  filedNotes,
  finishBlockers,
  processingOutcome,
  processingSummary,
  remainingCount,
  type ProcessingResult,
  type StepResult,
  type StepStatus,
} from "@/src/lib/contracts/follow-through-finish";
import { renderNotesMarkdown, type NotesDraft } from "@/src/lib/contracts/follow-through-notes";
import type { FollowThroughItem } from "@/src/lib/contracts/follow-through-tickets";
import {
  trackerCardDiffs,
  type TrackerCard,
} from "@/src/lib/contracts/follow-through-trackers";
import type { RecapEmailState } from "@/src/lib/contracts/follow-through-recap-email";

/**
 * The last screen, and the only button in the follow-through that changes anything outside MTOS.
 *
 * Three things it deliberately does:
 *
 *  - **Lists what is left, rather than greying out silently.** A disabled button with no reason
 *    is the most common way a workflow gets abandoned, so every outstanding decision is named.
 *  - **Shows the notes before the button, not after.** "Preview final notes" sits directly above
 *    it, because the document being filed is the thing being approved.
 *  - **Reports each step honestly, including the ones that did not run.** A warning is not a
 *    failure and a skip is not a success, and an AM who reads "Processed" has to be able to
 *    trust that nothing is quietly owed.
 */

const STEP_ICON: Record<StepStatus, { icon: typeof Check; chip: string }> = {
  pending: { icon: Minus, chip: "muted" },
  running: { icon: Loader2, chip: "info" },
  done: { icon: Check, chip: "good" },
  skipped: { icon: Minus, chip: "muted" },
  warning: { icon: AlertTriangle, chip: "watch" },
  failed: { icon: X, chip: "risk" },
};

export function FollowThroughFinish({
  touchId,
  notes,
  items,
  trackerCards,
  recap,
  processing,
  bookingDeferredAt,
  qaHref,
}: {
  touchId: string;
  notes?: NotesDraft;
  items?: FollowThroughItem[];
  trackerCards?: TrackerCard[];
  recap?: RecapEmailState;
  processing?: ProcessingResult;
  bookingDeferredAt?: string;
  qaHref: string;
}) {
  const [result, setResult] = useState<ProcessingResult | undefined>(processing);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const [blockers, setBlockers] = useState<string[]>([]);
  // The one step MTOS cannot do for the AM. A client without her calendar on the call is not an
  // unfinished follow-through -- she has the link and books herself -- so this is tracked as a
  // decision the AM made, and can be taken back the moment a time comes through.
  const [deferred, setDeferred] = useState(Boolean(bookingDeferredAt));
  const [deferring, setDeferring] = useState(false);

  const diffs = useMemo(
    () => Object.fromEntries((trackerCards || []).map((card) => [card.id, trackerCardDiffs(card)])),
    [trackerCards],
  );

  const inputs = useMemo(
    () => ({
      ...(notes ? { notes } : {}),
      ...(items ? { items } : {}),
      ...(trackerCards ? { trackerCards } : {}),
      trackerDiffs: diffs,
      ...(recap ? { recap } : {}),
    }),
    [notes, items, trackerCards, diffs, recap],
  );

  const outstanding = useMemo(() => finishBlockers(inputs), [inputs]);
  const remaining = remainingCount(inputs);
  const shown = blockers.length ? blockers : outstanding;

  // The preview is the filed document, not the draft. An AM who denied a ticket should not read
  // its action back as a commitment, so the same derivation the run uses backs what is shown here.
  const filed = useMemo(() => (notes ? filedNotes(notes, items || []) : undefined), [notes, items]);

  const run = useCallback(async () => {
    setRunning(true);
    setError("");
    try {
      const response = await fetch(`/api/monthly-touches/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "process_follow_through" }),
      });
      const payload = await readJsonResponse<{
        data?: ProcessingResult;
        error?: string;
        blockers?: string[];
      }>(response);
      if (!response.ok) {
        setBlockers(payload?.blockers || []);
        throw new Error(payload?.error || "The follow-through was not processed.");
      }
      setBlockers([]);
      if (payload?.data) setResult(payload.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The follow-through was not processed.");
    } finally {
      setRunning(false);
    }
  }, [touchId]);

  /**
   * Hand the booking to the client, or take it back.
   *
   * The run is repeated straight afterwards so the AM sees the answer in the step list rather than
   * being told to press Finish again: deferring turns step 7 from a warning into a deliberate skip,
   * which is what releases the rest of the follow-through.
   */
  const defer = useCallback(
    async (next: boolean) => {
      setDeferring(true);
      setError("");
      try {
        const response = await fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}/next-meeting`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "defer", deferred: next }),
        });
        const payload = await readJsonResponse<{ error?: string }>(response);
        if (!response.ok) throw new Error(payload?.error || "That could not be saved.");
        setDeferred(next);
        await run();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "That could not be saved.");
      } finally {
        setDeferring(false);
      }
    },
    [touchId, run],
  );

  const outcome = result ? processingOutcome(result.steps) : undefined;

  return (
    <div className="grid gap-4">
      {result ? (
        <div className={`callout`} style={{ borderLeftColor: outcome === "processed" ? "var(--good)" : undefined }}>
          <span className="callout-ic">
            {outcome === "processed" ? <Check /> : <AlertTriangle />}
          </span>
          <div>
            <div className="callout-title">
              {outcome === "processed" ? "Follow-through processed" : "Follow-through needs attention"}
            </div>
            <div className="callout-body">{processingSummary(result.steps)}</div>
          </div>
        </div>
      ) : null}

      {/* The handoff to QC, said separately from the seven steps. It is not something the AM
          approved or can retry item by item, so it does not belong in that list -- but they do
          need to know the touch has left their desk and who was told. */}
      {result?.qc && outcome === "processed" ? (
        <div
          className="callout"
          style={{ borderLeftColor: result.qc.created ? "var(--violet, #6d5ae0)" : undefined }}
        >
          <span className="callout-ic">
            {result.qc.created && result.qc.notified ? <Check /> : <AlertTriangle />}
          </span>
          <div>
            <div className="callout-title">{result.qc.ready === false ? "QA handoff needs attention" : result.qc.created ? "With QC" : "QA handoff"}</div>
            <div className="callout-body">{result.qc.message}</div>
          </div>
        </div>
      ) : null}

      <ul className="grid gap-2">
        {PROCESSING_STEPS.map((definition, index) => {
          const outcomeStep: StepResult | undefined = result?.steps.find((entry) => entry.id === definition.id);
          const status: StepStatus = running && !outcomeStep ? "running" : outcomeStep?.status || "pending";
          const { icon: Icon, chip } = STEP_ICON[status];
          return (
            <li key={definition.id} className="list-row items-start">
              <span className={`chip ${chip}`} style={{ flexShrink: 0 }}>
                <Icon />
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.86rem] font-semibold" style={{ color: "var(--text)" }}>
                  {definition.label}
                </span>
                <span className="muted block text-[0.8rem]">
                  {outcomeStep?.message || definition.detail}
                </span>
                {outcomeStep && (outcomeStep.status === "warning" || outcomeStep.status === "failed" || (definition.id === "booking" && deferred)) ? (
                  <span className="mt-2 flex flex-wrap items-center gap-3">
                    {definition.id === "booking" && !deferred ? <NextTouchBookingControl touchId={touchId} /> : null}
                    {definition.id === "booking" ? (
                      <button
                        type="button"
                        className="ilink"
                        disabled={deferring || running}
                        onClick={() => void defer(!deferred)}
                      >
                        {deferring
                          ? "Saving…"
                          : deferred
                            ? "Actually, book it here"
                            : "The client is booking it herself — move on without it"}
                      </button>
                    ) : null}
                    {definition.id === "recap" ? <a className="ilink" href="#recap">Review recipient and recap email</a> : null}
                    {definition.id === "notes" ? <a className="ilink" href="#notes">Review the notes</a> : null}
                    {definition.id === "risk" || definition.id === "health" ? <a className="ilink" href="#trackers">Review tracker rows</a> : null}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      {shown.length ? (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Before you can finish</div>
            {remaining ? (
              <span className="chip watch">
                {remaining} {remaining === 1 ? "decision" : "decisions"} left
              </span>
            ) : null}
          </div>
          <ul className="mt-2 grid gap-2">
            {shown.map((line) => (
              <li key={line} className="text-[0.84rem]" style={{ color: "var(--text-2)" }}>
                · {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notes && filed ? (
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview((open) => !open)}>
            <Eye />
            {preview ? "Hide the final notes" : "Preview final notes"}
          </button>
          {preview ? (
            <pre
              className="card mono mt-2"
              style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", lineHeight: 1.7, color: "var(--text-2)" }}
            >
              {renderNotesMarkdown(filed.draft, { ticketActions: filed.ticketActions })}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={running || outstanding.length > 0}
          onClick={() => void run()}
        >
          <Rocket />
          {running
            ? "Processing…"
            : result
              ? "Run the unfinished steps again"
              : "Finish follow-through & process approved"}
        </button>
        {result && outcome === "processed" && result.qc?.ready !== false ? (
          <Link href={qaHref} className="btn btn-ghost btn-sm">
            Continue to QA
            <ArrowRight />
          </Link>
        ) : null}
        <span className="muted text-[0.78rem]">
          The notes need no separate approval — this button is their approval.
        </span>
      </div>

      {error ? (
        <p role="alert" className="text-[0.82rem]" style={{ color: "var(--risk)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
