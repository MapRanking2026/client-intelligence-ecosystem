import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Preview } from "@/src/components/mtos/preview";
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

/** A client name that links to the profile and previews key facts on hover. */
export function ClientHint({ client, label }: { client: ClientRecord; label?: string }) {
  const tone = TONE_CLASS[client.tone];
  const stats: [string, number][] = [
    ["Health", client.healthScore],
    ["Rel.", client.relationshipScore],
    ["Growth", client.growthReadiness],
  ];

  return (
    <Preview
      content={
        <span className="block" style={{ minWidth: 234 }}>
          <span className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <span className="h4" style={{ fontSize: "0.92rem" }}>
              {client.name}
            </span>
            <span className={`chip ${tone}`}>
              <span className={`sig-dot ${tone}`} />
              {TONE_LABEL[client.tone]}
            </span>
          </span>
          <span className="muted block" style={{ fontSize: "0.74rem", marginBottom: 9 }}>
            {client.industry}
            {client.location ? ` · ${client.location}` : ""}
          </span>
          <span className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)", gap: 7, marginBottom: 9 }}>
            {stats.map(([k, v]) => (
              <span key={k} className="hint-stat block">
                <span className="muted block" style={{ fontSize: "0.62rem" }}>
                  {k}
                </span>
                <span className="block" style={{ fontWeight: 700, color: "var(--text)", fontSize: "0.9rem" }}>
                  {v}
                </span>
              </span>
            ))}
          </span>
          {client.topRisks?.[0] ? (
            <span className="block" style={{ fontSize: "0.76rem", color: "var(--text-2)", marginBottom: 9 }}>
              <span className="muted">Top risk:</span> {client.topRisks[0]}
            </span>
          ) : null}
          <span className="between">
            <span className="muted" style={{ fontSize: "0.7rem" }}>
              Next touch {client.touchDate}
            </span>
            <Link
              href={`/clients/${client.id}`}
              className="ilink"
              style={{ fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              View client <ArrowRight style={{ width: 13, height: 13 }} />
            </Link>
          </span>
        </span>
      }
    >
      <Link href={`/clients/${client.id}`} className="ilink">
        {label ?? client.name}
      </Link>
    </Preview>
  );
}
