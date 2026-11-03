"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Eye, Loader2, Minus, Rocket, X } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import {
  PROCESSING_STEPS,
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
  HEALTH_TRACKER_FIELDS,
  diffRow,
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
  qaHref,
}: {
  touchId: string;
  notes?: NotesDraft;
  items?: FollowThroughItem[];
  trackerCards?: TrackerCard[];
  recap?: RecapEmailState;
  processing?: ProcessingResult;
  qaHref: string;
}) {
  const [result, setResult] = useState<ProcessingResult | undefined>(processing);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const [blockers, setBlockers] = useState<string[]>([]);

  const diffs = useMemo(() => {
    const out: Record<string, ReturnType<typeof diffRow>> = {};
    for (const card of trackerCards || []) {
      if (card.kind === "health") out[card.id] = diffRow(card.current, card.next, HEALTH_TRACKER_FIELDS);
    }
    return out;
  }, [trackerCards]);

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
              {outcome === "processed" ? "Processed" : outcome === "partial" ? "Processed, with something left for you" : "Not fully processed"}
            </div>
            <div className="callout-body">{processingSummary(result.steps)}</div>
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
              </span>
            </li>
          );
        })}
      </ul>

      {shown.length && !result ? (
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

      {notes ? (
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
              {renderNotesMarkdown(notes)}
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
        {result ? (
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
