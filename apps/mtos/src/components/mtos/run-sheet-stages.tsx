import type { ReactNode } from "react";

import type { RunSheetStage } from "@/src/lib/server/services/prep-readiness-service";

/**
 * Where the AM is in the touch, and what remains.
 *
 * The old run-sheet was one long page with preparation, the live call and the after-call work
 * stacked on top of each other, and a primary action that did not change -- `Capture & Close Out`
 * sat at the top of a touch whose meeting had not happened. This strip says which of the five
 * stages the touch is actually in, and the one action beside it is the action for that stage.
 *
 * The stage is derived from the touch's real state (see `deriveRunSheetStage`), never from the last
 * button pressed, so it cannot run ahead of the work.
 */

const STAGES: { id: RunSheetStage; name: string; sub: string }[] = [
  { id: "prep", name: "Prep", sub: "Account review" },
  { id: "review", name: "Review", sub: "Email, notes, filing" },
  { id: "live", name: "Live", sub: "Run the meeting" },
  { id: "follow_through", name: "Follow-through", sub: "Recap and tickets" },
  { id: "qa", name: "QA", sub: "Review and approve" },
];

const ORDER: RunSheetStage[] = ["prep", "review", "live", "follow_through", "qa"];

export function RunSheetStages({
  current,
  action,
  note,
}: {
  current: RunSheetStage;
  /** The one primary action for this stage. */
  action: ReactNode;
  /** One line on what this stage needs, in the AM's words. */
  note: string;
}) {
  const currentIndex = ORDER.indexOf(current);

  return (
    <div className="card">
      <nav aria-label="Monthly Touch stages">
        <ol className="stage-track" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {STAGES.map((stage, index) => {
            const done = index < currentIndex;
            const isCurrent = index === currentIndex;
            const cls = done ? "is-done" : isCurrent ? "is-current" : "is-blocked";
            return (
              <li key={stage.id} className={`stage-step ${cls}`} aria-current={isCurrent ? "step" : undefined}>
                <span className="stage-name">
                  {index + 1}. {stage.name}
                </span>
                <span className="stage-sub">{done ? "Done" : isCurrent ? stage.sub : stage.sub}</span>
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="muted max-w-xl text-[0.84rem]">{note}</p>
        <div className="flex flex-wrap items-center gap-2.5">{action}</div>
      </div>
    </div>
  );
}
