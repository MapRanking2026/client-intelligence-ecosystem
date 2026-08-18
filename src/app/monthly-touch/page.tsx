import Link from "next/link";
import { CalendarRange, Clock3, ArrowRight } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { DataError } from "@/src/components/mtos/data-error";
import { Linkified } from "@/src/components/mtos/annotate";
import { ClientHint } from "@/src/components/mtos/client-hint";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getMonthlyTouchQueueView } from "@/src/lib/server/services/monthly-touch-service";

function excerpt(text: string, max = 190): string {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastStop = cut.lastIndexOf(". ");
  return (lastStop > 90 ? cut.slice(0, lastStop + 1) : cut.trim()) + " …";
}

export default async function MonthlyTouchIndexPage() {
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

  const items = queue.filter((q) => q.client);

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
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
        {items.map(({ touch, client }) => {
          const c = client!;
          const st = touch.status === "Ready" ? "good" : touch.status === "Completed" ? "info" : "watch";
          return (
            <div key={touch.id} className="card is-hover" style={{ display: "flex", flexDirection: "column" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold" style={{ color: "var(--text)" }}>
                    <ClientHint client={c} />
                  </div>
                  <div className="muted text-[0.78rem]">{c.industry}</div>
                </div>
                <span className={`chip ${st}`}>
                  <span className={`sig-dot ${st}`} />
                  {touch.status}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <span className="chip">
                  Readiness <b style={{ color: "var(--text)" }}>{touch.readinessScore}</b>
                </span>
                <span className="chip">
                  Confidence <b style={{ color: "var(--text)" }}>{touch.confidenceScore}</b>
                </span>
              </div>

              {touch.executiveBrief ? (
                <p className="mt-3.5 text-[0.86rem] leading-6" style={{ color: "var(--text-2)" }}>
                  <Linkified text={excerpt(touch.executiveBrief)} clientId={c.id} />
                </p>
              ) : null}

              <div className="mt-auto flex items-center justify-between pt-4">
                <span className="muted flex items-center gap-3 text-[0.74rem]">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarRange style={{ width: 14, height: 14 }} />
                    {c.touchDate}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 style={{ width: 14, height: 14 }} />
                    {touch.agenda.length} segments
                  </span>
                </span>
                <Link href={`/monthly-touch/${touch.id}`} className="ilink text-[0.8rem] inline-flex items-center gap-1">
                  Open run-sheet <ArrowRight style={{ width: 14, height: 14 }} />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
