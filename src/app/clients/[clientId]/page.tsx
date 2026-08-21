import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Play,
  ShieldAlert,
  TrendingUp,
  Target,
  Users,
  Plug,
} from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { DataError } from "@/src/components/mtos/data-error";
import { ClientTabs } from "@/src/components/mtos/client-tabs";
import { ClientAttachments } from "@/src/components/mtos/client-attachments";
import { RetentionButton } from "@/src/components/mtos/retention-button";
import { Linkified, Callout, SmartText } from "@/src/components/mtos/annotate";
import { countClientAttachments } from "@/src/lib/server/services/client-attachments-service";
import { ClientProfileMappings } from "@/src/components/mtos/client-profile-mappings";
import { LeadVerificationQuickActions } from "@/src/components/mtos/lead-verification-quick-actions";
import {
  ScorecardGrid,
  SeoPerformancePanel,
  AdsPerformancePanel,
  StrategicActionPanel,
} from "@/src/components/mtos/prep-pack-sections";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getClientMappingView } from "@/src/lib/server/services/client-mappings-service";
import { getClientWorkspaceView } from "@/src/lib/server/services/clients-service";
import { getStoredLeadVerification } from "@/src/lib/server/services/lead-verification-service";
import type { HealthTone } from "@/src/lib/mtos-data";

const TONE_CLASS: Record<HealthTone, "good" | "watch" | "risk"> = {
  excellent: "good",
  healthy: "good",
  needs_attention: "watch",
  at_risk: "risk",
  critical: "risk",
};
const TONE_LABEL: Record<HealthTone, string> = {
  excellent: "Excellent",
  healthy: "Healthy",
  needs_attention: "Needs attention",
  at_risk: "At risk",
  critical: "Critical",
};

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function ScoreStat({ label, value, tone }: { label: string; value: number; tone?: "good" | "watch" | "risk" }) {
  return (
    <div style={{ padding: "14px 16px", borderRadius: 14, border: "1px solid var(--hair)", background: "var(--surface-2)" }}>
      <div className="flex items-center justify-between">
        <span className="stat-label">{label}</span>
        {tone ? <span className={`sig-dot ${tone}`} /> : null}
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <span className="stat-val" style={{ fontSize: "1.6rem" }}>
          {value}
        </span>
        <div className={`bar ${tone && tone !== "good" ? tone : ""}`} style={{ flex: 1 }}>
          <i style={{ width: `${Math.min(value, 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="eyebrow muted">{label}</div>
      <div className="mt-1.5 text-[0.9rem]" style={{ color: "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

export default async function ClientWorkspacePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const context = await resolveTenantContext();

  let payload: Awaited<ReturnType<typeof getClientWorkspaceView>>;
  try {
    payload = await getClientWorkspaceView(context, clientId);
  } catch {
    return (
      <AppShell>
        <DataError title="Couldn't load this client" />
      </AppShell>
    );
  }
  if (!payload) notFound();

  const { client, touch, commitments: clientCommitments, opportunities: clientOpportunities } = payload;
  let mappingView: Awaited<ReturnType<typeof getClientMappingView>> = null;
  let leadVerification: Awaited<ReturnType<typeof getStoredLeadVerification>> = null;
  let attachmentCount = 0;
  try {
    [mappingView, leadVerification, attachmentCount] = await Promise.all([
      getClientMappingView(context, clientId),
      getStoredLeadVerification(context, clientId),
      countClientAttachments(context, clientId),
    ]);
  } catch {
    // Secondary data (integration mappings, stored lead verification, attachments) is optional — degrade to none.
  }

  const tone = TONE_CLASS[client.tone];
  const meta = [
    client.industry,
    client.location,
    client.contact,
    client.tenure,
    client.accountManager ? `AM: ${client.accountManager}` : undefined,
    client.mrr,
  ].filter(Boolean);

  const overview = (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="card">
        <div className="card-title">Who they are</div>
        <p className="lead mt-3.5" style={{ fontSize: "1rem" }}>
          <Linkified text={client.summary} clientId={client.id} />
        </p>
        <div className="hr" />
        <div className="grid gap-4 sm:grid-cols-2">
          <InfoRow label="Industry" value={client.industry} />
          <InfoRow label="Primary contact" value={client.contact} />
          <InfoRow label="Location" value={client.location} />
          <InfoRow label="Lifecycle" value={client.lifecycleStage} />
          <InfoRow label="Sentiment" value={client.sentiment} />
          <InfoRow label="Tenure" value={client.tenure} />
        </div>
        {client.goals?.length ? (
          <>
            <div className="hr" />
            <div className="eyebrow muted mb-2.5">
              <Target />
              <span>What they want</span>
            </div>
            <div className="flex flex-col gap-2">
              {client.goals.map((g) => (
                <div key={g} className="flex items-start gap-2.5 text-[0.88rem]" style={{ color: "var(--text-2)" }}>
                  <span style={{ color: "var(--accent)", marginTop: 3, display: "inline-flex" }}>
                    <ArrowRight style={{ width: 14, height: 14 }} />
                  </span>
                  {g}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        {touch ? (
          <div className="card">
            <div className="card-title">Next Monthly Touch</div>
            {touch.executiveBrief ? (
              <div className="mt-3">
                <SmartText text={touch.executiveBrief} clientId={client.id} />
              </div>
            ) : null}
            <Link href={`/monthly-touch/${touch.id}`} className="btn btn-primary btn-block mt-4">
              <Play />
              Open Monthly Touch run-sheet
            </Link>
          </div>
        ) : null}
        <Callout tone="info" title="Next best action">
          <Linkified text={client.nextBestAction} clientId={client.id} />
        </Callout>
      </div>
    </div>
  );

  const intelligence = (
    <div className="flex flex-col gap-4">
      {client.topRisks?.length ? (
        <div>
          <div className="section-head" style={{ margin: "0 0 14px" }}>
            <div className="h4 flex items-center gap-2">
              <ShieldAlert style={{ width: 16, height: 16 }} />
              Risks
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {client.topRisks.map((r) => (
              <div key={r} className="insight risk" style={{ gridTemplateColumns: "auto 1fr" }}>
                <div className="insight-icon">
                  <ShieldAlert />
                </div>
                <div className="text-[0.92rem]" style={{ color: "var(--text)", fontWeight: 600 }}>
                  <Linkified text={r} clientId={client.id} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {client.topOpportunities?.length ? (
        <div>
          <div className="section-head" style={{ margin: "8px 0 14px" }}>
            <div className="h4 flex items-center gap-2">
              <TrendingUp style={{ width: 16, height: 16 }} />
              Opportunities
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {client.topOpportunities.map((o) => (
              <div key={o} className="insight good" style={{ gridTemplateColumns: "auto 1fr" }}>
                <div className="insight-icon">
                  <TrendingUp />
                </div>
                <div className="text-[0.92rem]" style={{ color: "var(--text)", fontWeight: 600 }}>
                  <Linkified text={o} clientId={client.id} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {clientOpportunities.length ? (
        <div>
          <div className="section-head" style={{ margin: "8px 0 14px" }}>
            <div className="h4">Qualified opportunities</div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {clientOpportunities.map((o) => (
              <div key={o.id} className="card">
                <div className="flex items-center justify-between gap-3">
                  <span className="chip info">{o.stage}</span>
                  <span className="font-bold" style={{ color: "var(--accent)" }}>
                    {o.value}
                  </span>
                </div>
                <div className="h4 mt-3">{o.title}</div>
                <div className="muted mt-1.5 text-[0.8rem]">Readiness {o.readiness}</div>
                <div className="mt-3 flex items-start gap-2 text-[0.84rem]" style={{ color: "var(--text-2)" }}>
                  <ArrowRight style={{ width: 15, height: 15, marginTop: 2, color: "var(--accent)" }} />
                  <span>
                    <Linkified text={o.nextStep} clientId={client.id} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  const plan = (
    <div className="flex flex-col gap-4">
      {client.strategicAction ? (
        <div className="card">
          <div className="card-title">Strategic action in motion</div>
          <div className="h3 mt-3">{client.strategicAction.title}</div>
          <div className="mt-4 flex items-center gap-3">
            <div className="bar" style={{ flex: 1 }}>
              <i style={{ width: `${client.strategicAction.implementationPercent}%` }} />
            </div>
            <span className="font-bold" style={{ color: "var(--accent)" }}>
              {client.strategicAction.implementationPercent}%
            </span>
          </div>
          <div className="hr" />
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="eyebrow muted">Results so far</div>
              <p className="mt-2 text-[0.88rem]" style={{ color: "var(--text-2)" }}>
                <Linkified text={client.strategicAction.resultsSoFar} clientId={client.id} />
              </p>
            </div>
            <div>
              <div className="eyebrow muted">Next steps</div>
              <p className="mt-2 text-[0.88rem]" style={{ color: "var(--text-2)" }}>
                <Linkified text={client.strategicAction.nextSteps} clientId={client.id} />
              </p>
            </div>
          </div>
        </div>
      ) : null}
      <div className="card">
        <div className="card-title">Next best action</div>
        <p className="mt-3 text-[0.92rem] leading-6" style={{ color: "var(--text)" }}>
          <Linkified text={client.nextBestAction} clientId={client.id} />
        </p>
      </div>
    </div>
  );

  const promises = (
    <div className="card" style={{ padding: 8 }}>
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Commitment</th>
              <th>Owner</th>
              <th>Due</th>
              <th>Category</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {clientCommitments.map((c) => {
              const st = c.status === "Overdue" ? "risk" : c.status === "Completed" ? "good" : "watch";
              return (
                <tr key={c.id}>
                  <td style={{ maxWidth: 280, color: "var(--text)" }}>{c.title}</td>
                  <td className="muted">{c.owner}</td>
                  <td className="muted">{c.dueDate}</td>
                  <td className="muted">{c.category}</td>
                  <td>
                    <span className={`chip ${st}`}>{c.status}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const leadsCalls = (
    <div className="flex flex-col gap-4">
      <div className="card">
        <div className="card-title mb-1">
          <Users />
          Lead &amp; call verification
        </div>
        <p className="muted mb-4 text-[0.82rem]">
          Vet each lead as real or flagged, confirm the channel, and reconcile counts across Google Ads, organic, and Meta —
          pulled from GoHighLevel.
        </p>
        <LeadVerificationQuickActions clientId={client.id} initialReview={leadVerification} />
      </div>
      {mappingView ? (
        <div className="card">
          <div className="card-title mb-1">
            <Plug />
            Integration profile mappings
          </div>
          <p className="muted mb-4 text-[0.82rem]">
            Confirm which integration profiles belong to this client so the prep pack can pull their data.
          </p>
          <ClientProfileMappings clientId={client.id} providers={mappingView.providers} />
        </div>
      ) : null}
    </div>
  );

  const prep = touch?.prepPack;
  const performance = prep ? (
    <div className="flex flex-col gap-4">
      <div className="card">
        <div className="card-title mb-4">Business scorecard</div>
        <ScorecardGrid scorecard={prep.businessScorecard} clientId={client.id} />
      </div>
      <div className="card">
        <div className="card-title mb-4">SEO &amp; Google Business Profile</div>
        <SeoPerformancePanel seo={prep.seoPerformance} />
      </div>
      <div className="card">
        <div className="card-title mb-4">Paid media</div>
        <AdsPerformancePanel ads={prep.adsPerformance} />
      </div>
      <div className="card">
        <div className="card-title mb-4">Strategic action</div>
        <StrategicActionPanel action={prep.strategicAction} />
      </div>
    </div>
  ) : (
    <div className="insight info" style={{ gridTemplateColumns: "auto 1fr" }}>
      <div className="insight-icon">
        <TrendingUp />
      </div>
      <div>
        <div className="h4">No performance snapshot yet</div>
        <p className="muted mt-1.5 text-[0.85rem]">
          Run the Monthly Touch prep for {client.name} to pull the latest scorecard, local visibility, and paid-media
          data — it appears here automatically.
        </p>
      </div>
    </div>
  );

  const tabs = [
    { id: "overview", label: "Overview", content: overview },
    { id: "performance", label: "Performance", content: performance },
    { id: "intelligence", label: "Intelligence", content: intelligence },
    { id: "plan", label: "Plan", content: plan },
    { id: "promises", label: "Promises", content: promises },
    { id: "leads", label: "Leads & Calls", content: leadsCalls },
  ];

  return (
    <AppShell>
      <Link href="/clients" className="mb-4 inline-flex items-center gap-2 text-[0.82rem]" style={{ color: "var(--slate-400)" }}>
        <ArrowLeft style={{ width: 15, height: 15 }} />
        All clients
      </Link>

      <div className="card glow" style={{ padding: 24 }}>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className="av-sm" style={{ width: 60, height: 60, borderRadius: 18, fontSize: "1.3rem", background: "var(--accent)" }}>
              {initials(client.name)}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="h2" style={{ fontSize: "var(--t-h3)" }}>
                  {client.name}
                </h2>
                <span className={`chip ${tone}`}>
                  <span className={`sig-dot ${tone}`} />
                  {TONE_LABEL[client.tone]}
                </span>
              </div>
              <div className="muted mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.82rem]">
                {meta.map((m, i) => (
                  <span key={i}>{m}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {touch ? (
              <Link href={`/monthly-touch/${touch.id}`} className="btn btn-primary btn-sm">
                <Play />
                Run Monthly Touch
              </Link>
            ) : null}
            <RetentionButton clientId={client.id} clientName={client.name} />
            <ClientAttachments clientId={client.id} clientName={client.name} initialCount={attachmentCount} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <ScoreStat label="Health" value={client.healthScore} tone={client.healthScore >= 75 ? "good" : client.healthScore >= 60 ? "watch" : "risk"} />
          <ScoreStat label="Relationship" value={client.relationshipScore} tone={client.relationshipScore >= 75 ? "good" : client.relationshipScore >= 60 ? "watch" : "risk"} />
          <ScoreStat label="Growth readiness" value={client.growthReadiness} tone={client.growthReadiness >= 75 ? "good" : client.growthReadiness >= 60 ? "watch" : "risk"} />
          <div style={{ padding: "14px 16px", borderRadius: 14, border: "1px solid var(--hair)", background: "var(--surface-2)" }}>
            <div className="stat-label">Next touch</div>
            <div className="mt-2.5 text-[1.15rem] font-bold" style={{ color: "var(--info)" }}>
              {client.touchDate}
            </div>
          </div>
        </div>
      </div>

      <ClientTabs tabs={tabs} />
    </AppShell>
  );
}
