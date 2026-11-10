"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import type { BriefCompleteness } from "@/src/lib/contracts/prep-brief";
import { PREP_SECTION_PURPOSE } from "@/src/lib/contracts/touch-stages";
import type { PrepWorkflowState } from "@/src/lib/contracts/prep-workflow";

/**
 * Prep, part three: the account review, and nothing else.
 *
 * The panel this replaces ran four numbered steps in one column -- the account review, the client
 * confirmation email, the preparation notes, and the ClickUp filing -- and showed all four on both
 * the Prep screen and the Review screen. Three of them did not belong to Prep at all: the email is
 * something the AM reads with the findings in front of them, and the notes and the filing are what
 * the one approval at the end of Review does. Leaving them here meant an AM could file a brief in
 * a client's ClickUp book before they had read it, and the four numbered headings were a second
 * progress indicator arguing with the one at the top of the page.
 *
 * So Prep is one long-running action and an honest account of what it found: which sources were
 * asked, which answered, where nothing came back, and how many of the fifteen brief sections it
 * actually wrote. The last of those is the gate to Review, and it is the number that would have
 * caught the November regression in a minute -- every section of every brief read "the preparation
 * did not write this section" for weeks, because the response was rebuilt from six keys and the
 * sections were dropped before the brief reader saw them.
 */

interface PrepStagePanelProps {
  touchId: string;
  clientName: string;
  workflow: PrepWorkflowState;
  /** How many of the fifteen brief sections have something in them. */
  brief: BriefCompleteness;
  /** True when the brief has been written at all, which changes the button's words. */
  hasBrief: boolean;
}

function Notice({ tone, children }: { tone: "info" | "risk" | "good" | "watch"; children: React.ReactNode }) {
  return (
    <p
      className="rounded-[10px] px-3 py-2.5 text-[0.82rem] leading-6"
      style={{ background: `var(--${tone}-bg)`, color: `var(--${tone})` }}
    >
      {children}
    </p>
  );
}

export function PrepStagePanel({ touchId, clientName, workflow, brief, hasBrief }: PrepStagePanelProps) {
  const [pending, setPending] = useState<"run" | "review" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const research = workflow.research;
  const stage = workflow.stages.research;
  const running = stage.status === "running" || pending === "run";

  /**
   * While the review is running, ask the server what it has.
   *
   * The run takes three to five minutes and used to end in a full page reload, so an AM who
   * switched tabs came back to a screen that had not moved and pressed the button again. The poll
   * reloads the moment the stage stops running, which is also the moment Prep hands over to
   * Review, so the hand-over happens whether or not they were watching.
   */
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!running) return;
    poll.current = setInterval(() => {
      void fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          const status = payload?.data?.touch?.prepWorkflow?.stages?.research?.status;
          if (status && status !== "running") globalThis.location.reload();
        })
        .catch(() => undefined);
    }, 15_000);
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [running, touchId]);

  const run = useCallback(async () => {
    setPending("run");
    setError(null);
    try {
      const response = await fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}/prep-workflow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run_research" }),
      });
      const result = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(result?.error || "The account review could not be started.");
      // Every score, stage and gate on this screen is derived from the touch, so a reload is the
      // honest refresh: nothing here is patched up locally from a response.
      globalThis.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The account review could not be started.");
      setPending(null);
    }
  }, [touchId]);

  /**
   * Review the brief as it stands, holes and all.
   *
   * Prep normally holds the touch until all fifteen sections are written, and that is the right
   * default: a review over an empty brief is what a half-failed account review used to look like.
   * But a section the preparation genuinely cannot write -- a client with no Google Ads account
   * has no Google Ads section -- would otherwise trap the touch behind a button that will never
   * fill it in. The AM can move on deliberately, and the sections they move on with are still
   * marked "not written" in the review, where editing or declining them is one click.
   */
  const openReview = useCallback(async () => {
    setPending("review");
    setError(null);
    try {
      const response = await fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "advance_progress", step: "review" }),
      });
      const result = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(result?.error || "The review could not be opened.");
      globalThis.location.assign(`/monthly-touch/${touchId}?stage=review`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review could not be opened.");
      setPending(null);
    }
  }, [touchId]);

  const answered = research?.sourceChecks.filter((check) => check.reachable).length ?? 0;
  const tried = research?.sourceChecks.filter((check) => check.checked).length ?? 0;
  const total = research?.sourceChecks.length ?? 0;

  return (
    <div className="card mt-4">
      <div className="card-head">
        <div>
          <div className="eyebrow muted">Prep · 3 of 3</div>
          <div className="h4 mt-1.5">Prepare the Monthly Touch</div>
          <p className="muted mt-1 text-[0.82rem]">{PREP_SECTION_PURPOSE.account_review}</p>
        </div>
        {hasBrief ? (
          <span className={`chip ${brief.ready ? "good" : "watch"}`}>
            <span className={`sig-dot ${brief.ready ? "good" : "watch"}`} />
            {brief.populated} of {brief.total} sections
          </span>
        ) : (
          <span className="chip info">
            <span className="sig-dot muted" />
            Not run yet
          </span>
        )}
      </div>

      {error ? (
        <div className="mb-3">
          <Notice tone="risk">{error}</Notice>
        </div>
      ) : null}

      {stage.status === "failed" && stage.errorMessage ? (
        <div className="mb-3">
          <Notice tone="risk">{stage.errorMessage}</Notice>
        </div>
      ) : null}

      {running ? (
        <div className="mb-3">
          <Notice tone="watch">
            <LoaderCircle
              className="animate-spin"
              style={{ width: 14, height: 14, display: "inline", marginRight: 6, verticalAlign: "-2px" }}
            />
            Reading every connected source for {clientName}, then writing the fifteen brief sections. Usually three
            to five minutes. This screen moves to the review on its own when the brief is whole — you can leave it.
          </Notice>
        </div>
      ) : null}

      {/* ---------- Which sources were asked, and what came back ---------- */}
      {research ? (
        <div className="grid gap-3">
          <p className="muted text-[0.82rem]">
            Last run {new Date(research.completedAt).toLocaleString()} · {answered} of {total} connected sources
            answered{tried > answered ? ` · ${tried - answered} were asked and returned nothing` : ""}
            {total > tried ? ` · ${total - tried} are not connected, so they were not checked` : ""}.
          </p>

          <ul className="grid gap-1.5">
            {research.sourceChecks.map((check) => (
              <li key={check.key} className="flex items-start gap-2 text-[0.82rem]">
                <span
                  className={`sig-dot ${check.reachable ? "good" : check.checked ? "watch" : "muted"}`}
                  style={{ marginTop: 6, flexShrink: 0 }}
                  aria-hidden
                />
                <span>
                  <strong style={{ color: "var(--text)" }}>{check.label}</strong> — {check.detail}
                </span>
              </li>
            ))}
          </ul>

          {research.dataGaps.length ? (
            <Notice tone="watch">
              <AlertTriangle style={{ width: 14, height: 14, display: "inline", marginRight: 6, verticalAlign: "-2px" }} />
              {research.dataGaps.length} {research.dataGaps.length === 1 ? "gap" : "gaps"} to check or ask about:{" "}
              {research.dataGaps.slice(0, 3).join("; ")}
              {research.dataGaps.length > 3 ? "; …" : ""}
            </Notice>
          ) : null}

          <p className="muted text-[0.8rem] leading-6">{research.commsVerification.note}</p>
        </div>
      ) : null}

      {/* ---------- The gate to Review ---------- */}
      {hasBrief ? (
        <div className="mt-4">
          {brief.ready ? (
            <Notice tone="good">
              <CheckCircle2 style={{ width: 14, height: 14, display: "inline", marginRight: 6, verticalAlign: "-2px" }} />
              All {brief.total} brief sections are written. Prep is complete and the review is open.
            </Notice>
          ) : (
            <Notice tone="watch">
              <strong>
                {brief.missing.length} of {brief.total} brief sections came back empty
              </strong>{" "}
              — {brief.missing.map((id) => `section ${id}`).join(", ")}. Prep stays open until they are written, so
              nobody reviews a brief with holes in it. Run the account review again, or review it as it stands and
              write or decline them yourself.
            </Notice>
          )}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <button type="button" className="btn btn-primary" disabled={pending !== null || running} onClick={() => void run()}>
          {pending === "run" || running ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          {hasBrief ? "Run Account Review Again" : "Generate Monthly Prep"}
        </button>
        {hasBrief && brief.ready ? (
          <a className="btn btn-ghost" href={`/monthly-touch/${touchId}?stage=review`}>
            <ArrowRight />
            Go to the review
          </a>
        ) : null}
      </div>
      <p className="field-hint mt-2">
        Usually three to five minutes — it re-reads the Business Profile, the calendar, GoHighLevel and every other
        connected dashboard before it writes anything, so a rerun is never an analysis of yesterday&apos;s numbers.
      </p>

      {hasBrief && !brief.ready ? (
        <p className="mt-2.5">
          <button type="button" className="link-quiet" disabled={pending !== null} onClick={() => void openReview()}>
            {pending === "review" ? "Opening the review…" : "Review it as it stands and write the empty sections myself"}
          </button>
        </p>
      ) : null}
    </div>
  );
}
