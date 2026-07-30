import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BookOpenText, CalendarDays, MessageSquareQuote } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { ClientProfileMappings } from "@/src/components/mtos/client-profile-mappings";
import { LeadVerificationQuickActions } from "@/src/components/mtos/lead-verification-quick-actions";
import { ScorePill } from "@/src/components/mtos/score-pill";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getClientMappingView } from "@/src/lib/server/services/client-mappings-service";
import { getClientWorkspaceView } from "@/src/lib/server/services/clients-service";
import { getStoredLeadVerification } from "@/src/lib/server/services/lead-verification-service";
import { healthTone } from "@/src/lib/utils";

export default async function ClientWorkspacePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const context = await resolveTenantContext();
  const payload = await getClientWorkspaceView(context, clientId);

  if (!payload) {
    notFound();
  }

  const { client, touch, commitments: clientCommitments, opportunities: clientOpportunities } = payload;
  const [mappingView, leadVerification] = await Promise.all([
    getClientMappingView(context, clientId),
    getStoredLeadVerification(context, clientId),
  ]);

  return (
    <AppShell
      title={client.name}
      subtitle="A single workspace for business context, relationship context, operational truth, and the next conversation that needs to happen."
    >
      <div className="grid gap-6 xl:grid-cols-[1.2fr_minmax(0,0.9fr)]">
        <SectionCard
          eyebrow="Client overview"
          title="360° intelligence snapshot"
          subtitle={client.summary}
          aside={
            <div className="flex flex-wrap gap-2">
              <ScorePill label="Health" value={client.healthScore} tone={healthTone(client.healthScore)} />
              <ScorePill
                label="Relationship"
                value={client.relationshipScore}
                tone={healthTone(client.relationshipScore)}
              />
              <ScorePill
                label="Growth"
                value={client.growthReadiness}
                tone={healthTone(client.growthReadiness)}
              />
            </div>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[24px] border border-white/8 bg-white/4 p-5">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Top risks</p>
              <div className="mt-4 space-y-3">
                {client.topRisks.map((risk) => (
                  <div key={risk} className="rounded-2xl border border-white/8 bg-black/15 px-4 py-3 text-sm text-slate-200">
                    {risk}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[24px] border border-white/8 bg-white/4 p-5">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                Top opportunities
              </p>
              <div className="mt-4 space-y-3">
                {client.topOpportunities.map((opportunity) => (
                  <div
                    key={opportunity}
                    className="rounded-2xl border border-emerald-400/10 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-100"
                  >
                    {opportunity}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Next touch"
          title={touch?.status ? `${touch.status} workspace` : "No active touch"}
          subtitle="The client workspace should flow directly into the meeting workspace without making the user rebuild context."
        >
          {touch ? (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
                <p className="text-sm leading-7 text-slate-200">{touch.executiveBrief}</p>
              </div>
              <Link
                href={`/monthly-touch/${touch.id}`}
                style={{ color: "#0d1625" }}
                className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white px-4 py-3 text-sm font-semibold text-[#0d1625] transition hover:bg-[#d7f5ec]"
              >
                Open monthly touch workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : null}
        </SectionCard>
      </div>

      <SectionCard
        eyebrow="Lead & call verification"
        title="Verify the leads, calls & forms this client received"
        subtitle="Vet each lead as real or flagged, confirm which channel it came from, and reconcile the counts across Google Ads, organic/website, and Meta — all pulled from GoHighLevel. Runs on demand here and automatically during monthly-touch prep."
      >
        <LeadVerificationQuickActions clientId={client.id} initialReview={leadVerification} />
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr_1fr]">
        <SectionCard eyebrow="Commitments" title="Open accountability" subtitle="Promises stay visible until they are resolved.">
          <div className="space-y-3">
            {clientCommitments.map((commitment) => (
              <div key={commitment.id} className="rounded-2xl border border-white/8 bg-white/4 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-white">{commitment.title}</p>
                  <span className="text-xs text-slate-400">{commitment.status}</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  {commitment.owner} · due {commitment.dueDate}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Growth"
          title="Qualified opportunities"
          subtitle="Opportunities are framed as client-fit decisions, not sales pressure."
        >
          <div className="space-y-3">
            {clientOpportunities.map((opportunity) => (
              <div key={opportunity.id} className="rounded-2xl border border-white/8 bg-white/4 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-white">{opportunity.title}</p>
                  <span className="text-xs text-slate-400">{opportunity.stage}</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  {opportunity.value} · readiness {opportunity.readiness}
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-300">{opportunity.nextStep}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Context"
          title="What the AM should remember"
          subtitle="The interface should answer what happened, why it matters, and what to do next."
        >
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
              <div className="flex items-center gap-3 text-slate-200">
                <CalendarDays className="h-4 w-4 text-slate-400" />
                Next touch on {client.touchDate}
              </div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
              <div className="flex items-start gap-3 text-slate-200">
                <MessageSquareQuote className="mt-0.5 h-4 w-4 text-slate-400" />
                <span>{client.nextBestAction}</span>
              </div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
              <div className="flex items-start gap-3 text-slate-200">
                <BookOpenText className="mt-0.5 h-4 w-4 text-slate-400" />
                <span>
                  Keep growth recommendations tied to evidence, timing, and relationship readiness.
                </span>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {mappingView ? (
        <SectionCard
          eyebrow="Data connections"
          title="Profile mappings"
          subtitle="Verify which integration profiles belong to this client. Automatic name matching runs first; pin profiles manually when a name doesn't line up so the prep pack can pull their data."
        >
          <ClientProfileMappings clientId={client.id} providers={mappingView.providers} />
        </SectionCard>
      ) : null}
    </AppShell>
  );
}
