"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, LoaderCircle } from "lucide-react";

/**
 * The one progress indicator every AI action in MTOS uses: a named step, a ticking
 * clock, a moving bar, and a typical duration so the wait has a shape.
 *
 * WHY THE STATE LIVES OUTSIDE A TRANSITION. Every one of these actions used to be
 * `startTransition(async () => { setActiveAction(...); await work(); })`. In React 19
 * an async transition is an Action: state set inside it is HELD until the action
 * settles, so the panel mounted only after the work it was describing had already
 * finished -- and the `finally` that cleared the flag ran first, so in practice it
 * never mounted at all. The only visible effect was `isPending` grey on the button,
 * which is the whole "I click it and nothing happens" complaint. Measured in a
 * probe on React 19.2.4: inside a transition the flag read `null` a second after
 * the click; outside it read `running`.
 *
 * So: `start()` is called OUTSIDE any transition, as an ordinary urgent update, and
 * these components no longer use `useTransition` at all. Keep it that way. If you
 * reintroduce a transition around an async action, this panel goes dark again and
 * nothing in the type system will tell you.
 */

export interface AiRunState {
  steps: string[];
  stepIndex: number;
  /** Plain-language expectation, e.g. "usually 2-3 minutes". */
  typical?: string;
  startedAt: number;
}

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Owns the lifecycle of one AI run. `start` paints immediately; `advance` moves to
 * the next named step; `stop` clears it.
 */
export function useAiRun() {
  const [run, setRun] = useState<AiRunState | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // A ticking clock is the cheapest honest proof the request is still alive. These
  // runs last minutes, and a spinner alone is indistinguishable from a hung page.
  useEffect(() => {
    if (!run) {
      return;
    }
    const startedAt = run.startedAt;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [run]);

  return {
    run,
    elapsed,
    isRunning: run !== null,
    start(steps: string[], typical?: string) {
      setElapsed(0);
      setRun({ steps, stepIndex: 0, typical, startedAt: Date.now() });
    },
    advance() {
      setRun((current) => (current ? { ...current, stepIndex: current.stepIndex + 1 } : current));
    },
    stop() {
      setRun(null);
    },
  };
}

/**
 * Colours come from the design tokens, never from a literal hex. globals.css remaps
 * the Tailwind slate classes per theme but cannot remap an arbitrary value like
 * `text-[#d7f5ec]`, so a literal is a colour that only works in the theme it was
 * picked in -- which is how this panel once shipped unreadable in the light theme.
 */
export function AiProgressPanel({ run, elapsed }: { run: AiRunState; elapsed: number }) {
  const { steps, stepIndex, typical } = run;

  return (
    <div
      className="space-y-3 rounded-[20px] border border-[color:var(--hair-strong)] bg-[color:var(--surface-2)] p-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-100">{steps[stepIndex]}…</p>
        <span className="shrink-0 font-mono text-xs tabular-nums text-slate-400" aria-live="off">
          {formatElapsed(elapsed)}
        </span>
      </div>

      {/* Indeterminate: the server reports no percentage, and inventing one would be
          a lie that stalls at 90%. The stripe moving is the signal; the clock and the
          typical duration are what answer "how much longer". */}
      <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-3)]">
        <div className="mtos-indeterminate h-full w-1/3 rounded-full bg-[color:var(--accent)]" />
      </div>

      {steps.length > 1 ? (
        <ul className="space-y-1.5">
          {steps.map((step, index) => (
            <li key={step} className="flex items-center gap-2 text-xs">
              {index < stepIndex ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[color:var(--good)]" />
              ) : index === stepIndex ? (
                <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-[color:var(--accent)]" />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              )}
              <span className={index <= stepIndex ? "text-slate-200" : "text-slate-500"}>{step}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-slate-400">
        {typical ? `${typical}. ` : ""}Keep this tab open — the page updates itself when it finishes.
      </p>
    </div>
  );
}
