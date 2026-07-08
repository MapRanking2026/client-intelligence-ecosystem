import Link from "next/link";
import { ArrowUpRight, Pin, Search } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { ScorePill } from "@/src/components/mtos/score-pill";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getClientsDirectoryView } from "@/src/lib/server/services/clients-service";
import { healthTone } from "@/src/lib/utils";

export default async function ClientsPage() {
  const { clients } = await getClientsDirectoryView(await resolveTenantContext());

  return (
    <AppShell
      title="Client Intelligence Workspace"
      subtitle="Client context stays whole in one place so Account Managers do not have to reconstruct the story across multiple tools."
    >
      <SectionCard
        eyebrow="Directory"
        title="Client search and pinned views"
        subtitle="The real product will support natural-language search, saved views, and role-aware filtering. This seeded slice shows the structure and visual hierarchy."
      >
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
            <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-400">
              <Search className="h-4 w-4" />
              Search by client, risk, industry, or opportunity
            </div>
            <div className="mt-4 space-y-3">
              {["Pinned clients", "At-risk accounts", "Growth-ready", "Upcoming touches"].map((view) => (
                <div
                  key={view}
                  className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/3 px-4 py-3"
                >
                  <span className="text-sm text-slate-200">{view}</span>
                  <Pin className="h-4 w-4 text-slate-500" />
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {clients.map((client) => (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.025))] p-5 transition hover:-translate-y-0.5 hover:border-white/16"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-white">{client.name}</p>
                    <p className="text-sm text-slate-400">{client.industry}</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-slate-500" />
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-300">{client.summary}</p>
                <div className="mt-5 grid gap-2">
                  <ScorePill label="Health" value={client.healthScore} tone={healthTone(client.healthScore)} />
                  <ScorePill
                    label="Relationship"
                    value={client.relationshipScore}
                    tone={healthTone(client.relationshipScore)}
                  />
                  <ScorePill
                    label="Growth Readiness"
                    value={client.growthReadiness}
                    tone={healthTone(client.growthReadiness)}
                  />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </SectionCard>
    </AppShell>
  );
}
