"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, History, Lock } from "lucide-react";

import {
  TOUCH_STEPS,
  TOUCH_STEP_LABELS,
  TOUCH_STEP_SHORT,
  followThroughDeadline,
  touchStepIndex,
  type ResumeNotice,
  type TouchStep,
} from "@/src/lib/contracts/touch-progress";

/**
 * The five steps across the top of a touch, plus the two things an AM needs to know on arrival:
 * where they left off, and how long the follow-through has left.
 *
 * Steps past the furthest one reached are shown and locked rather than hidden. A hidden step reads
 * as a feature that doesn't exist; a locked one says what has to happen first, which is the actual
 * answer -- Live opens when the brief is approved, the follow-through when the call has happened.
 *
 * The countdown re-renders on a timer because it is the one number on the page that goes stale
 * while being looked at: a follow-through sitting at "3h left" when it is in fact overdue is worse
 * than no countdown at all.
 */

const STEP_HINTS: Record<TouchStep, string> = {
  prep: "Run the account review first.",
  review: "The preparation has to finish first.",
  live: "Approve the brief to open the live call.",
  follow: "Opens once the call has ended.",
  qa: "Opens once the follow-through is processed.",
};

export function TouchProgressRail({
  touchId,
  progress,
  current,
  resume,
  followThroughDueAt,
  timeZone,
}: {
  touchId: string;
  /** The furthest step reached. Steps beyond it are locked. */
  progress: TouchStep;
  /** The step being shown, which may be an earlier one the AM went back to. */
  current: TouchStep;
  resume?: ResumeNotice;
  followThroughDueAt?: string;
  timeZone?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!followThroughDueAt) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [followThroughDueAt]);

  const reached = touchStepIndex(progress);
  const deadline = followThroughDeadline(followThroughDueAt, now);

  return (
    <div className="card mt-4">
      <nav aria-label="Monthly Touch steps">
        <ol className="stage-track" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {TOUCH_STEPS.map((step, index) => {
            const done = index < reached;
            const isCurrent = step === current;
            const locked = index > reached;
            const cls = isCurrent ? "is-current" : done ? "is-done" : "is-blocked";
            const body = (
              <>
                <span className="stage-name">
                  {index + 1}. {TOUCH_STEP_SHORT[step]}
                </span>
                <span className="stage-sub">
                  {locked ? (
                    <span className="inline-flex items-center gap-1">
                      <Lock style={{ width: 11, height: 11 }} />
                      Locked
                    </span>
                  ) : done ? (
                    "Done"
                  ) : (
                    "In progress"
                  )}
                </span>
              </>
            );
            return (
              <li
                key={step}
                className={`stage-step ${cls}`}
                aria-current={isCurrent ? "step" : undefined}
                title={locked ? STEP_HINTS[step] : TOUCH_STEP_LABELS[step]}
              >
                {locked ? (
                  body
                ) : (
                  <Link
                    href={`/monthly-touch/${touchId}?stage=${step}`}
                    className="flex flex-col"
                    style={{ color: "inherit" }}
                  >
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {resume && current === resume.step ? (
        <div
          className="mt-4 flex flex-wrap items-center gap-2 rounded-[10px] p-3 text-[0.82rem]"
          style={{ background: "var(--info-bg)", color: "var(--info)" }}
        >
          <History style={{ width: 14, height: 14 }} />
          <span style={{ fontWeight: 600 }}>{resume.headline}</span>
          {resume.savedLabel ? <span style={{ opacity: 0.85 }}>{resume.savedLabel}</span> : null}
        </div>
      ) : null}

      {current !== progress ? (
        <p className="muted mt-3 text-[0.78rem]">
          You are reading {TOUCH_STEP_LABELS[current]}; this touch is in {TOUCH_STEP_LABELS[progress]}. Nothing you
          look at here moves it back.
        </p>
      ) : null}

      {deadline ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`chip ${deadline.tone === "red" ? "risk" : deadline.tone === "amber" ? "watch" : "good"}`}>
            <Clock />
            Follow-through {deadline.label}
          </span>
          <span className="muted text-[0.78rem]">
            Due {wallClock(deadline.dueAt, timeZone)} — 24 business hours after the call ended.
          </span>
        </div>
      ) : null}
    </div>
  );
}

function wallClock(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}),
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
