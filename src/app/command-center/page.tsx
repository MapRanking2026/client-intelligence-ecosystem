import Link from "next/link";
import {
  Sparkles,
  ShieldAlert,
  Target,
  ArrowRight,
  TrendingUp,
  Clock,
  BadgeCheck,
  Users,
} from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { DataError } from "@/src/components/mtos/data-error";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getCommandCenterView } from "@/src/lib/server/services/command-center-service";
import type { ClientRecord, HealthTone } from "@/src/lib/mtos-data";

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
const SEVERITY: Record<HealthTone, number> = {
  critical: 0,
  at_risk: 1,
  needs_attention: 2,
  healthy: 3,
  excellent: 4,
};

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function Gauge({ value, size = 78, stroke = 7 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - value / 100);
  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
        />
      </svg>
      <div className="gauge-val" style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

function PriorityIcon({ tone }: { tone: "good" | "watch" | "risk" }) {
  if (tone === "good") return <TrendingUp />;
  if (tone === "watch") return <Clock />;
  return <ShieldAlert />;
}

export default async function CommandCenterPage() {
  let view: Awaited<ReturnType<typeof getCommandCenterView>>;
  try {
    view = await getCommandCenterView(await resolveTenantContext());
  } catch {
    return (
      <AppShell>
        <DataError title="Couldn't load your Command Center" />
      </AppShell>
    );
  }
  const { snapshot, clients, commitments } = view;

  const needAttention = clients.filter((c) => SEVERITY[c.tone] <= 2);
  const priority = [...clients].sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone]).slice(0, 4);
  const upcoming = [...clients]
    .sort((a, b) => Date.parse(a.touchDate) - Date.parse(b.touchDate))
    .slice(0, 4);
  const openCommitments = commitments.filter((c) => c.status !== "Completed");
  const overdue = commitments.filter((c) => c.status === "Overdue").length;
  const avgGrowth = Math.round(
    clients.reduce((sum, c) => sum + c.growthReadiness, 0) / Math.max(clients.length, 1),
  );

  const stats = [
    { label: "Active clients", value: String(clients.length), sub: "in your book", icon: <Users /> },
    {
      label: "Need attention",
      value: String(needAttention.length),
      sub: "flagged today",
      icon: <ShieldAlert />,
      tone: "risk" as const,
    },
    {
      label: "Open commitments",
      value: String(openCommitments.length),
      sub: `${overdue} overdue`,
      icon: <BadgeCheck />,
      tone: overdue > 0 ? ("risk" as const) : undefined,
    },
    { label: "Avg growth score", value: `${avgGrowth}`, sub: "portfolio", icon: <TrendingUp />, tone: "good" as const },
  ];

  return (
    <AppShell>
      {/* Hero briefing */}
      <section className="flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-2xl">
          <div className="eyebrow">
            <Sparkles />
            <span>Daily Intelligence Briefing · {snapshot.focusDate}</span>
          </div>
          <h1 className="h1 mt-3.5">
            Good morning.
            <br />
            <span style={{ color: "var(--accent)" }}>
              {needAttention.length} {needAttention.length === 1 ? "client needs" : "clients need"} your attention today.
            </span>
          </h1>
          <p className="lead mt-3.5">
            The system reviewed all {clients.length} accounts and ranked them by what moves your book. Start at the top:
            each item is the client, what changed, and the next best action.
          </p>
        </div>
        <div className="card glow" style={{ minWidth: 230, padding: "18px 20px" }}>
          <div className="stat-label">Portfolio health</div>
          <div className="mt-3 flex items-center gap-4">
            <Gauge value={avgGrowth} />
            <div>
              <div className="text-[0.78rem]" style={{ color: "var(--slate-400)" }}>
                Avg growth score
              </div>
              <div className="mt-2 flex items-center gap-2 text-[0.82rem]">
                <span className="sig-dot risk" />
                {needAttention.length} need attention
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[0.82rem]">
                <span className="sig-dot good" />
                {clients.length - needAttention.length} healthy
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stat strip */}
      <div className="mt-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card" style={{ padding: "16px 18px" }}>
            <div className="flex items-center justify-between">
              <div className="stat-label">{s.label}</div>
              <span
                className="grid h-8 w-8 place-items-center rounded-[9px]"
                style={{
                  background: s.tone ? `var(--${s.tone}-bg)` : "var(--surface-2)",
                  color: s.tone ? `var(--${s.tone})` : "var(--accent)",
                }}
              >
                {s.icon}
              </span>
            </div>
            <div className="stat-val mt-3.5" style={s.tone ? { color: `var(--${s.tone})` } : undefined}>
              {s.value}
            </div>
            <div className="muted mt-1.5 text-[0.76rem]">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Two columns */}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Priority queue */}
        <div>
          <div className="section-head">
            <div>
              <div className="eyebrow muted">
                <Target />
                <span>What needs your attention</span>
              </div>
              <div className="h3 mt-2">Priority queue</div>
            </div>
          </div>
          <div className="flex flex-col gap-3.5">
            {priority.map((c: ClientRecord) => {
              const tone = TONE_CLASS[c.tone];
              return (
                <div key={c.id} className={`insight ${tone}`}>
                  <div className="insight-icon">
                    <PriorityIcon tone={tone} />
                  </div>
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`chip ${tone}`}>{TONE_LABEL[c.tone]}</span>
                      <span className="muted text-[0.76rem]">
                        {c.name} · {c.industry}
                        {c.location ? ` · ${c.location}` : ""}
                      </span>
                    </div>
                    <div className="h4" style={{ lineHeight: 1.35 }}>
                      {c.summary}
                    </div>
                    {c.topRisks?.length ? (
                      <div
                        className="mt-3 rounded-[12px] p-3"
                        style={{ background: "var(--surface-2)", border: "1px solid var(--hair)" }}
                      >
                        <div className="flex items-start gap-2">
                          <span className="eyebrow muted shrink-0" style={{ marginTop: 2 }}>
                            Top risks
                          </span>
                          <span className="text-[0.82rem]" style={{ color: "var(--text-2)" }}>
                            {c.topRisks.join(" · ")}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2.5">
                    <span className="muted whitespace-nowrap text-[0.74rem]">Touch {c.touchDate}</span>
                    <Link href={`/clients/${c.id}`} className="btn btn-primary btn-sm">
                      Review client
                      <ArrowRight />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="card-head">
              <div className="card-title">This week&apos;s touches</div>
              <span className="chip">{upcoming.length}</span>
            </div>
            {upcoming.map((c) => {
              const tone = TONE_CLASS[c.tone];
              return (
                <Link
                  key={c.id}
                  href={`/clients/${c.id}`}
                  className="list-row"
                  style={{ padding: 12 }}
                >
                  <div className="av-sm" style={{ width: 34, height: 34, background: "var(--accent)" }}>
                    {initials(c.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[0.86rem] font-semibold" style={{ color: "var(--text)" }}>
                      {c.name}
                    </div>
                    <div className="muted text-[0.76rem]">
                      {c.industry} · Touch {c.touchDate}
                    </div>
                  </div>
                  <span className={`chip ${tone}`}>
                    <span className={`sig-dot ${tone}`} />
                    {TONE_LABEL[c.tone]}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">Promise tracker</div>
              <Link href="/commitments" className={`chip ${overdue > 0 ? "risk" : ""}`}>
                {overdue > 0 ? `${overdue} overdue` : "On track"}
              </Link>
            </div>
            {openCommitments.slice(0, 5).map((c) => {
              const tone = c.status === "Overdue" ? "risk" : "watch";
              return (
                <div key={c.id} className="border-t py-2.5" style={{ borderColor: "var(--hair)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[0.84rem]" style={{ color: "var(--text)", maxWidth: "72%" }}>
                      {c.title}
                    </span>
                    <span className={`chip ${tone}`} style={{ whiteSpace: "nowrap" }}>
                      {c.status === "Overdue" ? "Overdue" : c.dueDate}
                    </span>
                  </div>
                  <div className="muted mt-1.5 text-[0.72rem]">{c.owner}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
