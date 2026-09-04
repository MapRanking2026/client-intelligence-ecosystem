"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const CAPABILITIES = [
  "full-monthly-package",
  "keyword-ranking-summary",
  "grid-heatmap-analysis",
  "gbp-performance",
  "custom-question",
] as const;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function RequestForm() {
  const router = useRouter();
  const defaults = useMemo(
    () => ({ start: isoDaysAgo(30), end: isoDaysAgo(0) }),
    [],
  );

  const [clientId, setClientId] = useState("client-acme");
  const [capability, setCapability] =
    useState<(typeof CAPABILITIES)[number]>("full-monthly-package");
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/seo/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          capability,
          presetVersion: 1,
          reportingPeriod: { start, end },
          params: {},
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body?.error ?? "Request failed");
      } else {
        setMessage(
          body.deduped
            ? "Existing request returned (idempotent match)."
            : "Request submitted and package produced.",
        );
        router.refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2 style={{ marginTop: 0 }}>New request</h2>
      <div className="row">
        <div>
          <label htmlFor="clientId">Client ID</label>
          <input
            id="clientId"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="capability">Capability</label>
          <select
            id="capability"
            value={capability}
            onChange={(e) =>
              setCapability(e.target.value as (typeof CAPABILITIES)[number])
            }
          >
            {CAPABILITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <div>
          <label htmlFor="start">Reporting period start (ISO)</label>
          <input id="start" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label htmlFor="end">Reporting period end (ISO)</label>
          <input id="end" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <button type="submit" disabled={busy}>
          {busy ? "Submitting…" : "Submit request"}
        </button>
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </form>
  );
}
