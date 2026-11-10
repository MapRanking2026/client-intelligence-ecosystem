"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Clock, History, Lock } from "lucide-react";

import { TOUCH_STAGE_PURPOSE } from "@/src/lib/contracts/touch-stages";
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
 * The one progress indicator for a Monthly Touch: five stages, stuck to the top of the screen.
 *
 * There used to be three. This rail, a second numbered rail inside the preparation panel ("Four
 * steps, in this order"), and a card between them that named a stage and an action of its own. The
 * four steps were not the five stages -- they were the preparation's own sub-steps -- so an AM
 * asking "where am I" got two different answers from two correct sources, and scrolling past the
 * brief lost both of them. There is one answer now, it stays on the screen while the AM reads, and
 * the stage's own action sits inside it rather than in a card that repeats the stage's name.
 *
 * Steps past the furthest one reached are shown and locked rather than hidden. A hidden step reads
 * as a feature that doesn't exist; a locked one says what has to happen first, which is the actual
 * answer -- Live opens when the brief is approved, the follow-through when the call has happened.
 *
 * Earlier stages stay clickable, and clicking one does not move the touch back: `progress` is the
 * furthest step reached and only ever moves forward, so an AM re-reading the brief mid-call is
 * reading rather than rewinding.
 *
 * The countdown re-renders on a timer because it is the one number here that goes stale while being
 * looked at: a follow-through sitting at "3h left" when it is in fact overdue is worse than no
 * countdown at all.
 */

const STEP_HINTS: Record<TouchStep, string> = {
  prep: "Run the account review first.",
  review: "The preparation has to write all fifteen brief sections first.",
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
  action,
}: {
  touchId: string;
  /** The furthest step reached. Steps beyond it are locked. */
  progress: TouchStep;
  /** The step being shown, which may be an earlier one the AM went back to. */
  current: TouchStep;
  resume?: ResumeNotice;
  followThroughDueAt?: string;
  timeZone?: string;
  /**
   * The one action for the stage the touch is actually in.
   *
   * It lives here rather than in a card of its own: the card that used to hold it named the stage
   * again, with its own idea of which stage that was, and the two disagreed whenever the AM was
   * reading a stage they had already passed.
   */
  action?: ReactNode;
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
    <div className="card stage-rail mt-4">
      <nav aria-label="Monthly Touch stages">
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
                  ) : isCurrent ? (
                    "You are here"
                  ) : (
                    "Open"
                  )}
                </span>
              </>
            );
            return (
              <li
                key={step}
                className={`stage-step ${cls}`}
                aria-current={isCurrent ? "step" : undefined}
                title={locked ? STEP_HINTS[step] : TOUCH_STAGE_PURPOSE[step]}
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="muted max-w-xl text-[0.82rem]">
          {current === progress
            ? TOUCH_STAGE_PURPOSE[current]
            : `You are reading ${TOUCH_STEP_LABELS[current]}; this touch is in ${TOUCH_STEP_LABELS[progress]}. Nothing you look at here moves it back.`}
        </p>
        {action ? <div className="flex flex-wrap items-center gap-2.5">{action}</div> : null}
      </div>

      {resume && current === resume.step ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 rounded-[10px] p-3 text-[0.82rem]"
          style={{ background: "var(--info-bg)", color: "var(--info)" }}
        >
          <History style={{ width: 14, height: 14 }} />
          <span style={{ fontWeight: 600 }}>{resume.headline}</span>
          {resume.savedLabel ? <span style={{ opacity: 0.85 }}>{resume.savedLabel}</span> : null}
        </div>
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
