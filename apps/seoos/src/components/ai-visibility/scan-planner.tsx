"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { usd } from "@/src/lib/ai-visibility/util";
import type { ProviderId } from "@/src/lib/ai-visibility/types";
import { callApi, Msg } from "./client-api";

interface PlanView {
  slots: number;
  matrix: {
    prompts: Array<{ id: string; version: number; text: string; group: string; location: string; locationMode: string }>;
    providers: Array<{ providerId: string; model: string; perObservationUsd: number; upperBoundUsd: number; basis: string }>;
    repetitions: number;
    locations: string[];
  };
  estimatedCostUsd: number;
  upperBoundUsd: number;
  budget: { perScanCapUsd: number; clientMonthRemainingUsd: number; agencyMonthRemainingUsd: number };
  blockers: string[];
  warnings: string[];
}

/** Shows the prompt × location × provider × repetition matrix and cost before anything is sent. */
export function ScanPlanner({ projectId, providerIds, defaultReps }: { projectId: string; providerIds: ProviderId[]; defaultReps: number }) {
  const router = useRouter();
  const [branded, setBranded] = useState(false);
  const [reps, setReps] = useState(defaultReps);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string; problems?: string[] } | null>(null);
  const url = `/api/seo/ai-visibility/projects/${projectId}/scans`;

  async function review() {
    setBusy(true);
    setMsg(null);
    const r = await callApi<PlanView>(url, "POST", { action: "plan", branded, repetitions: reps, providerIds });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.error ?? "Failed", problems: r.problems });
    setPlan(r.data!);
  }

  async function start() {
    if (!plan) return;
    setBusy(true);
    const r = await callApi<{ id: string }>(url, "POST", { action: "start", branded, repetitions: reps, providerIds, confirmEstimateUsd: plan.estimatedCostUsd });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.error ?? "Failed", problems: r.problems });
    router.push(`/ai-visibility/${projectId}/scans/${r.data!.id}`);
  }

  return (
    <section className="panel aiv-noprint">
      <h2 className="panel-title">New scan</h2>
      <div className="aiv-form-grid">
        <div>
          <label htmlFor="sp-b">Prompt set</label>
          <select id="sp-b" value={branded ? "1" : "0"} onChange={(e) => { setBranded(e.target.value === "1"); setPlan(null); }}>
            <option value="0">Unbranded (discovery, intent, comparison, bilingual)</option>
            <option value="1">Branded research</option>
          </select>
        </div>
        <div>
          <label htmlFor="sp-r">Independent observations per prompt</label>
          <input id="sp-r" type="number" min={1} max={10} value={reps} onChange={(e) => { setReps(Number(e.target.value)); setPlan(null); }} />
        </div>
      </div>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <button type="button" onClick={review} disabled={busy}>{busy && !plan ? "Planning…" : "Review plan and cost"}</button>
      </div>
      <Msg msg={msg} />
      {plan ? (
        <div style={{ marginTop: 12 }}>
          <div className="aiv-grid">
            <div className="aiv-metric">
              <div className="aiv-metric-label">Observations</div>
              <div className="aiv-metric-value">{plan.slots}</div>
              <div className="aiv-metric-sub">{plan.matrix.prompts.length} prompts × {plan.matrix.locations.length} location(s) × {plan.matrix.providers.length} provider(s) × {plan.matrix.repetitions} reps</div>
            </div>
            <div className="aiv-metric">
              <div className="aiv-metric-label">Estimated cost</div>
              <div className="aiv-metric-value">{usd(plan.estimatedCostUsd)}</div>
              <div className="aiv-metric-sub">Estimate, not a charge. Worst case {usd(plan.upperBoundUsd)}.</div>
            </div>
            <div className="aiv-metric">
              <div className="aiv-metric-label">Caps</div>
              <div className="aiv-metric-sub">Per scan {usd(plan.budget.perScanCapUsd)}</div>
              <div className="aiv-metric-sub">Client remaining this month {usd(plan.budget.clientMonthRemainingUsd)}</div>
              <div className="aiv-metric-sub">Agency remaining this month {usd(plan.budget.agencyMonthRemainingUsd)}</div>
            </div>
          </div>
          {plan.matrix.providers.map((p) => (
            <p key={p.providerId} className="aiv-ev">
              {p.providerId} · {p.model}: ~{usd(p.perObservationUsd)} per observation ({p.basis}).
            </p>
          ))}
          {plan.blockers.length ? <Msg msg={{ kind: "error", text: "This scan cannot start:", problems: plan.blockers }} /> : null}
          {plan.warnings.length ? (
            <ul className="aiv-ev">
              {plan.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          <div className="aiv-table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Prompt (exact text sent)</th>
                  <th>Location</th>
                  <th>Location mode</th>
                  <th className="num">× providers × reps</th>
                </tr>
              </thead>
              <tbody>
                {plan.matrix.prompts.map((m) => (
                  <tr key={`${m.id}-${m.location}`}>
                    <td>{m.text} <span className="aiv-ev">v{m.version}</span></td>
                    <td>{m.location}</td>
                    <td><code>{m.locationMode}</code></td>
                    <td className="num">{plan.matrix.providers.length} × {plan.matrix.repetitions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button type="button" onClick={start} disabled={busy || plan.blockers.length > 0 || plan.slots === 0}>
              {busy ? "Starting…" : `Start scan (${plan.slots} observations, est. ${usd(plan.estimatedCostUsd)})`}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
