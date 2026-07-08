import Link from "next/link";
import { ArrowUpRight, CalendarRange, Clock3 } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { ScorePill } from "@/src/components/mtos/score-pill";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getMonthlyTouchQueueView } from "@/src/lib/server/services/monthly-touch-service";
import { healthTone } from "@/src/lib/utils";

export default async function MonthlyTouchIndexPage() {
  const { queue } = await getMonthlyTouchQueueView(await resolveTenantContext());

  return (
    <AppShell
      title="Monthly Touch Workspace"
      subtitle="Manage the full meeting queue across preparation, live execution, and follow-through without losing client context."
    >
      <SectionCard
        eyebrow="Queue"
        title="Upcoming and active Monthly Touches"
        subtitle="This workspace turns the Monthly Touch journey into a real operating environment instead of a dead-end. Each card leads into the meeting preparation flow."
      >
        <div className="grid gap-4 xl:grid-cols-3">
          {queue.map(({ touch, client }) => {
            if (!client) {
              return null;
            }

            return (
              <Link
                key={touch.id}
                href={`/monthly-touch/${touch.id}`}
                className="rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.025))] p-5 transition hover:-translate-y-0.5 hover:border-white/16"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-white">{client.name}</p>
                    <p className="text-sm text-slate-400">{client.industry}</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-slate-500" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ScorePill
                    label="Readiness"
                    value={touch.readinessScore}
                    tone={healthTone(touch.readinessScore)}
                  />
                  <ScorePill
                    label="Status"
                    value={touch.status}
                    tone={touch.status === "Ready" ? "positive" : "warning"}
                  />
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-300">{touch.executiveBrief}</p>
                <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-2">
                    <CalendarRange className="h-4 w-4" />
                    {client.touchDate}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <Clock3 className="h-4 w-4" />
                    {touch.agenda.length} agenda segments
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </SectionCard>
    </AppShell>
  );
}
