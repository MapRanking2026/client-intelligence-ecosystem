import Link from "next/link";
import { CalendarRange, Clock3, ArrowRight, LayoutGrid, Columns3 } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { DataError } from "@/src/components/mtos/data-error";
import { Linkified } from "@/src/components/mtos/annotate";
import { ClientHint } from "@/src/components/mtos/client-hint";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getMonthlyTouchQueueView } from "@/src/lib/server/services/monthly-touch-service";
import {
  TOUCH_BOARD_COLUMNS,
  deriveBoardColumn,
  type TouchBoardColumn,
} from "@/src/lib/server/services/prep-readiness-service";
import type { ClientRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";

/**
 * Rendered per request, never prerendered.
 *
 * This page reads one tenant's data behind a session cookie, so a build-time copy of it would
 * be the wrong tenant's page for everyone -- and the build would have to reach Firestore to
 * make it, which is what failed the deploys of 2026-11-02 when the daily read quota ran out.
 * Next cannot infer this on its own here: the session read calls `cookies()` inside a
 * try/catch and skips it entirely when the cookie secret is absent, so on a build without
 * that secret nothing marks the route dynamic and it is prerendered.
 */
export const dynamic = "force-dynamic";

function excerpt(text: string, max = 190): string {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastStop = cut.lastIndexOf(". ");
  return (lastStop > 90 ? cut.slice(0, lastStop + 1) : cut.trim()) + " …";
}

/** A score that was never measured reads as an em dash, not as zero. */
function score(value: number | undefined): string {
  return typeof value === "number" && value > 0 ? String(value) : "—";
}

function statusTone(touch: MonthlyTouchRecord): "good" | "info" | "watch" {
  if (touch.status === "Ready") return "good";
  if (touch.status === "Completed") return "info";
  return "watch";
}

export default async function MonthlyTouchIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: requested } = await searchParams;
  let queue: Awaited<ReturnType<typeof getMonthlyTouchQueueView>>["queue"];
  try {
    ({ queue } = await getMonthlyTouchQueueView(await resolveTenantContext()));
  } catch {
    return (
      <AppShell>
        <DataError title="Couldn't load your Monthly Touches" />
      </AppShell>
    );
  }

  const items = queue.filter(
    (entry): entry is { touch: MonthlyTouchRecord; client: ClientRecord } => Boolean(entry.client),
  );
  const view = requested === "board" ? "board" : "grid";

  // One pass, so the board and the counts can never disagree about where a touch is.
  const byColumn = new Map<TouchBoardColumn, typeof items>();
  for (const column of TOUCH_BOARD_COLUMNS) byColumn.set(column.id, []);
  for (const entry of items) byColumn.get(deriveBoardColumn(entry.touch))!.push(entry);

  return (
    <AppShell>
      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <div className="eyebrow muted">
            <CalendarRange />
            <span>Monthly Touch queue · {items.length}</span>
          </div>
          <h2 className="h2 mt-2">Monthly Touches</h2>
        </div>
        <nav className="seg" aria-label="How to show the touches">
          <Link href="/monthly-touch" className={`seg-btn ${view === "grid" ? "on" : ""}`}>
            <LayoutGrid style={{ width: 14, height: 14, display: "inline", marginRight: 5 }} />
            Cards
          </Link>
          <Link href="/monthly-touch?view=board" className={`seg-btn ${view === "board" ? "on" : ""}`}>
            <Columns3 style={{ width: 14, height: 14, display: "inline", marginRight: 5 }} />
            Board
          </Link>
        </nav>
      </div>

      {view === "board" ? (
        <>
          <p className="muted mb-3.5 max-w-3xl text-[0.84rem]">
            Grouped by where each meeting has actually got to, read from the work itself — the account review, the
            meeting, the follow-through and the QA — not from the last button someone pressed.
          </p>
          <div className="board">
            {TOUCH_BOARD_COLUMNS.map((column) => {
              const entries = byColumn.get(column.id)!;
              return (
                <section key={column.id} className="board-col" aria-label={column.label}>
                  <div className="board-col-head">
                    <span className="board-col-title">{column.label}</span>
                    <span className={`chip ${entries.length ? "" : "muted"}`}>{entries.length}</span>
                  </div>
                  <p className="muted mb-2.5 text-[0.74rem]">{column.hint}</p>
                  {entries.length === 0 ? (
                    <p className="muted text-[0.8rem]">Nothing here.</p>
                  ) : (
                    entries.map(({ touch, client }) => (
                      <Link key={touch.id} href={`/monthly-touch/${touch.id}/v2`} className="board-card">
                        <span className="block text-[0.86rem] font-semibold" style={{ color: "var(--text)" }}>
                          {client.name}
                        </span>
                        <span className="muted mt-1 block text-[0.74rem]">
                          {client.industry} · {client.touchDate}
                        </span>
                        <span className="mt-2.5 flex flex-wrap gap-1.5">
                          <span className="chip">Readiness {score(touch.readinessScore)}</span>
                          {touch.prepWorkflow?.stages.clickup_filing.status === "complete" ? (
                            <span className="chip good">Filed</span>
                          ) : null}
                        </span>
                      </Link>
                    ))
                  )}
                </section>
              );
            })}
          </div>
        </>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
          {items.map(({ touch, client }) => {
            const st = statusTone(touch);
            return (
              <div key={touch.id} className="card is-hover" style={{ display: "flex", flexDirection: "column" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold" style={{ color: "var(--text)" }}>
                      <ClientHint client={client} />
                    </div>
                    <div className="muted text-[0.78rem]">{client.industry}</div>
                  </div>
                  <span className={`chip ${st}`}>
                    <span className={`sig-dot ${st === "info" ? "muted" : st}`} />
                    {touch.status}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="chip">
                    Readiness <b style={{ color: "var(--text)" }}>{score(touch.readinessScore)}</b>
                  </span>
                  <span className="chip">
                    Confidence <b style={{ color: "var(--text)" }}>{score(touch.confidenceScore)}</b>
                  </span>
                </div>

                {touch.executiveBrief ? (
                  <p className="mt-3.5 text-[0.86rem] leading-6" style={{ color: "var(--text-2)" }}>
                    <Linkified text={excerpt(touch.executiveBrief)} clientId={client.id} />
                  </p>
                ) : (
                  <p className="muted mt-3.5 text-[0.84rem]">
                    The account review has not run for this touch yet.
                  </p>
                )}

                <div className="mt-auto flex items-center justify-between pt-4">
                  <span className="muted flex items-center gap-3 text-[0.74rem]">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarRange style={{ width: 14, height: 14 }} />
                      {client.touchDate}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock3 style={{ width: 14, height: 14 }} />
                      {touch.agenda.length} segments
                    </span>
                  </span>
                  <Link
                    href={`/monthly-touch/${touch.id}/v2`}
                    className="ilink inline-flex items-center gap-1 text-[0.8rem]"
                  >
                    Open run-sheet <ArrowRight style={{ width: 14, height: 14 }} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
