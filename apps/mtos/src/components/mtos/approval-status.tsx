"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink, LoaderCircle } from "lucide-react";

import {
  APPROVAL_STEPS,
  APPROVAL_STEP_LABEL,
  approvalIsComplete,
  nextApprovalStep,
  stepIsSettled,
  type TouchApprovalState,
} from "@/src/lib/contracts/touch-approval";

/**
 * What the one approval actually did, left on the screen afterwards.
 *
 * The approval's four outward writes used to be visible only inside the dialog that ran them, so
 * closing it took the answer with it: an AM who wanted to check the brief had really reached the
 * client's ClickUp book had to open ClickUp and look. The status stays here, on the review and on
 * the live screen, with the page it wrote linked -- which is the difference between "it said it
 * worked" and being able to confirm it did.
 *
 * While the approval is part-way through, it polls. That is the honest way to show it: the four
 * writes happen in order on the server, and the record of each is written before and after its
 * attempt, so what comes back is what has really landed rather than a bar moving on a timer.
 */
export function ApprovalStatusCard({
  touchId,
  approval,
}: {
  touchId: string;
  approval: TouchApprovalState;
}) {
  const [state, setState] = useState<TouchApprovalState>(approval);
  const complete = approvalIsComplete(state);
  const working = !complete ? nextApprovalStep(state) : undefined;
  const stalled = APPROVAL_STEPS.some((id) => state.steps[id].status === "failed");

  useEffect(() => {
    if (complete || stalled) return;
    const id = setInterval(() => {
      void fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          const next = payload?.data?.touch?.approval as TouchApprovalState | undefined;
          if (next) setState(next);
        })
        .catch(() => undefined);
    }, 8_000);
    return () => clearInterval(id);
  }, [complete, stalled, touchId]);

  return (
    <div className="card mt-4">
      <div className="card-head">
        <div className="card-title">What the approval did</div>
        <span className={`chip ${stalled ? "risk" : complete ? "good" : "watch"}`}>
          {stalled ? "Stopped" : complete ? "All four done" : "Running"}
        </span>
      </div>

      <ol className="flex flex-col gap-3" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {APPROVAL_STEPS.map((id) => {
          const step = state.steps[id];
          const settled = stepIsSettled(step);
          const failed = step.status === "failed";
          const busy = working === id && !stalled;
          return (
            <li key={id} className="flex items-start gap-3">
              <span
                aria-hidden
                className={busy ? "animate-spin" : undefined}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  marginTop: 2,
                  color: settled || failed ? "#ffffff" : "var(--slate-300)",
                  fontWeight: 800,
                  fontSize: "0.7rem",
                  background: failed
                    ? "var(--risk)"
                    : step.status === "done"
                      ? "var(--good)"
                      : step.status === "skipped"
                        ? "var(--slate-300)"
                        : "var(--surface-3)",
                }}
              >
                {step.status === "done" ? (
                  <Check style={{ width: 12, height: 12 }} />
                ) : failed ? (
                  "!"
                ) : busy ? (
                  <LoaderCircle style={{ width: 12, height: 12 }} />
                ) : (
                  ""
                )}
              </span>
              <span className="min-w-0">
                <span
                  style={{
                    display: "block",
                    fontSize: "0.86rem",
                    fontWeight: 620,
                    color: settled || failed || busy ? "var(--text)" : "var(--slate-300)",
                  }}
                >
                  {step.status === "skipped" ? `${APPROVAL_STEP_LABEL[id]} — not done, by your choice` : APPROVAL_STEP_LABEL[id]}
                </span>
                {step.detail ? (
                  <span className="muted text-[0.8rem] leading-6" style={{ display: "block" }}>
                    {step.detail}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      {state.clientBook?.pageUrl ? (
        <p className="mt-4">
          <a
            className="ilink inline-flex items-center gap-1.5 text-[0.84rem]"
            href={state.clientBook.pageUrl}
            target="_blank"
            rel="noreferrer"
          >
            {state.clientBook.pageName} in the Client&apos;s Book
            <ExternalLink style={{ width: 13, height: 13 }} />
          </a>
        </p>
      ) : null}

      {stalled ? (
        <p className="muted mt-3 text-[0.8rem] leading-6">
          The steps that finished are not run again. Pressing Approve once more picks up at the one that stopped.
        </p>
      ) : null}
    </div>
  );
}
