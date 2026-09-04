import Link from "next/link";
import { ClipboardCheck } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { DataError } from "@/src/components/mtos/data-error";
import { Linkified } from "@/src/components/mtos/annotate";
import { ClientHint } from "@/src/components/mtos/client-hint";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getQaClientIndexView } from "@/src/lib/server/services/qa-service";

function riskTone(risk: "Low" | "Moderate" | "High"): "good" | "watch" | "risk" {
  if (risk === "Low") return "good";
  if (risk === "Moderate") return "watch";
  return "risk";
}
function scoreTone(score: number | null): "good" | "watch" | "risk" | undefined {
  if (score === null) return undefined;
  if (score >= 85) return "good";
  if (score >= 70) return "watch";
  return "risk";
}
function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function Mini({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "watch" | "risk" }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--hair)", background: "var(--surface-2)" }}>
      <div className="muted text-[0.68rem]">{label}</div>
      <div className="mt-1 font-bold" style={{ fontSize: "1rem", color: tone ? `var(--${tone})` : "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

export default async function QaPage() {
  let cards: Awaited<ReturnType<typeof getQaClientIndexView>>["cards"];
  try {
    ({ cards } = await getQaClientIndexView(await resolveTenantContext()));
  } catch {
    return (
      <AppShell>
        <DataError title="Couldn't load QA reviews" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <div className="eyebrow muted">
            <ClipboardCheck />
            <span>Quality & coaching · consistency across every AM</span>
          </div>
          <h2 className="h2 mt-2">QA &amp; Coaching</h2>
        </div>
      </div>

      {cards.length === 0 ? (
        <p className="muted">No recorded Monthly Touch reviews on file yet.</p>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
          {cards.map((item) => {
            const rt = riskTone(item.retentionRisk);
            return (
              <div key={item.client.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="av-sm" style={{ width: 42, height: 42, borderRadius: 12, fontSize: "0.9rem", background: "var(--accent)" }}>
                      {initials(item.client.name)}
                    </div>
                    <div>
                      <div className="font-semibold" style={{ color: "var(--text)" }}>
                        <ClientHint client={item.client} />
                      </div>
                      <div className="muted text-[0.78rem]">{item.client.industry}</div>
                    </div>
                  </div>
                  <span className={`chip ${rt}`}>
                    <span className={`sig-dot ${rt}`} />
                    {item.retentionRisk} risk
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <Mini label="Avg QA" value={item.averageQaScore ?? "—"} tone={scoreTone(item.averageQaScore)} />
                  <Mini label="Sentiment" value={item.averageSentimentScore ?? "—"} tone={scoreTone(item.averageSentimentScore)} />
                  <Mini label="Meetings" value={item.meetingsRecorded} />
                  <Mini label="Grade" value={item.latestGrade} />
                </div>

                <p className="mt-4 text-[0.86rem] leading-6" style={{ color: "var(--text-2)" }}>
                  <Linkified text={item.client.summary} clientId={item.client.id} />
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="muted text-[0.76rem]">Latest touch · {item.latestTouchDate}</span>
                  <Link href={`/qa/${item.client.id}`} className="ilink text-[0.78rem]">
                    View reviews →
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
