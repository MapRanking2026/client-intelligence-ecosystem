"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

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

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "growth", label: "Growth-ready" },
] as const;

export function ClientRoster({ clients }: { clients: ClientRecord[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");

  const shown = clients.filter((c) => {
    if (filter === "attention") return ["needs_attention", "at_risk", "critical"].includes(c.tone);
    if (filter === "growth") return c.growthReadiness >= 75;
    return true;
  });

  return (
    <div>
      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <div className="eyebrow muted">Client book · {clients.length} accounts</div>
          <h2 className="h2 mt-2.5">Clients</h2>
        </div>
        <div className="pilltabs">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`pilltab ${filter === f.key ? "active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
        {shown.map((c) => {
          const tone = TONE_CLASS[c.tone];
          return (
            <Link key={c.id} href={`/clients/${c.id}`} className="card is-hover" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "18px 18px 14px" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="av-sm"
                      style={{ width: 42, height: 42, borderRadius: 12, fontSize: "0.9rem", background: "var(--accent)" }}
                    >
                      {initials(c.name)}
                    </div>
                    <div>
                      <div className="text-[0.98rem] font-semibold" style={{ color: "var(--text)" }}>
                        {c.name}
                      </div>
                      <div className="muted text-[0.78rem]">
                        {c.industry}
                        {c.location ? ` · ${c.location}` : ""}
                      </div>
                    </div>
                  </div>
                  <span className={`chip ${tone}`}>
                    <span className={`sig-dot ${tone}`} />
                    {TONE_LABEL[c.tone]}
                  </span>
                </div>
                <p className="mt-4 text-[0.86rem] leading-6" style={{ color: "var(--text-2)", minHeight: 44 }}>
                  {c.summary}
                </p>
              </div>
              <div
                className="flex items-center justify-between"
                style={{ padding: "13px 18px", background: "var(--surface-2)", borderTop: "1px solid var(--hair)" }}
              >
                <div className="flex gap-5">
                  <div>
                    <div className="muted text-[0.68rem]">Health</div>
                    <div className="text-[1.05rem] font-bold" style={{ color: "var(--text)" }}>
                      {c.healthScore}
                    </div>
                  </div>
                  <div>
                    <div className="muted text-[0.68rem]">Growth</div>
                    <div className="text-[1.05rem] font-bold" style={{ color: "var(--text)" }}>
                      {c.growthReadiness}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[0.78rem]" style={{ color: "var(--slate-400)" }}>
                  Touch {c.touchDate}
                  <ArrowUpRight style={{ width: 15, height: 15 }} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
