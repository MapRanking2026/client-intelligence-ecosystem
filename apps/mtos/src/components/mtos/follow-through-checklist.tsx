import { Check, Clock, Minus } from "lucide-react";

import { checklistProgress, type ChecklistRow } from "@/src/lib/contracts/follow-through-checklist";
import { followThroughDeadline } from "@/src/lib/contracts/touch-progress";

/**
 * The post-touch checklist, beside the follow-through rather than inside it.
 *
 * Sticky on purpose. The follow-through is a long screen -- a score, six notes sections, a ticket
 * form per action, three tracker cards and an email -- and the question this answers is the one an
 * AM asks repeatedly on the way down it: what is still outstanding. A list they have to scroll back
 * to is a list they check once.
 *
 * Nothing here is clickable. Every row is settled by doing the work in the column beside it, and a
 * tick box that only records a claim would be the one thing on this screen that can be true while
 * the work is undone.
 */
export function FollowThroughChecklist({
  rows,
  dueAt,
  timeZone,
}: {
  rows: ChecklistRow[];
  /** 24 business hours after the call ended. Absent until the call has an end. */
  dueAt?: string;
  timeZone?: string;
}) {
  const progress = checklistProgress(rows);
  const deadline = dueAt ? followThroughDeadline(dueAt) : undefined;

  return (
    <aside aria-label="Post-touch checklist">
      <div className="card xl:sticky xl:top-4">
        <div className="card-head">
          <div className="card-title">Post-touch checklist</div>
          <span className={`chip ${progress.ok === progress.total ? "good" : "watch"}`}>
            {progress.ok} of {progress.total}
          </span>
        </div>

        {deadline ? (
          <p
            className="mt-1 inline-flex items-center gap-1.5 text-[0.78rem]"
            style={{
              color:
                deadline.tone === "red"
                  ? "var(--risk)"
                  : deadline.tone === "amber"
                    ? "var(--watch)"
                    : "var(--slate-300)",
            }}
          >
            <Clock style={{ width: 13, height: 13 }} />
            {deadline.label} · due {wallClock(deadline.dueAt, timeZone)}
          </p>
        ) : (
          <p className="muted mt-1 text-[0.78rem]">
            The 24 business hours start when the call ends, so there is no deadline on this touch yet.
          </p>
        )}

        <ul className="mt-3 grid gap-2.5">
          {rows.map((row) => (
            <li key={row.label} className="flex gap-2.5">
              <span
                className="mt-0.5 flex shrink-0 items-center justify-center"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 5,
                  background: row.ok ? "var(--good-bg)" : "var(--surface-3)",
                  color: row.ok ? "var(--good)" : "var(--slate-400)",
                }}
                aria-hidden
              >
                {row.ok ? <Check style={{ width: 11, height: 11 }} /> : <Minus style={{ width: 11, height: 11 }} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[0.82rem]" style={{ fontWeight: 650, color: "var(--text)" }}>
                  {row.label}
                </span>
                <span className="block text-[0.78rem]" style={{ color: "var(--slate-300)" }}>
                  {row.detail}
                </span>
                <span className="sr-only">{row.ok ? "Done" : "Still outstanding"}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="field-hint mt-3">
          Read from the record, not from a box anyone ticked. A step that came back with a warning counts as
          outstanding.
        </p>
      </div>
    </aside>
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
