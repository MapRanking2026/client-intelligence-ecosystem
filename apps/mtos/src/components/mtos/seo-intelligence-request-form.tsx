"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const CAPABILITIES = [
  "full-monthly-package",
  "executive-seo-summary",
  "keyword-ranking-summary",
  "grid-heatmap-analysis",
  "gbp-performance",
  "next-30-day-recommendations",
  "custom-question",
] as const;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function SeoIntelligenceRequestForm({ defaultClientId = "" }: { defaultClientId?: string }) {
  const router = useRouter();
  const defaults = useMemo(() => ({ start: isoDaysAgo(30), end: isoDaysAgo(0) }), []);
  const [clientId, setClientId] = useState(defaultClientId);
  const [capability, setCapability] = useState<(typeof CAPABILITIES)[number]>("full-monthly-package");
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [questions, setQuestions] = useState("");
  const [priority, setPriority] = useState<"normal" | "high" | "urgent">("normal");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/seo-intelligence/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          capability,
          reportingPeriod: { start, end, timezone: "UTC" },
          customQuestions: questions.split("\n").map((q) => q.trim()).filter(Boolean),
          priority,
        }),
      });
      const body = await res.json();
      if (!res.ok) setMessage(body?.error ?? "Request failed");
      else {
        setMessage(
          body.deduped
            ? "Existing request returned (idempotent match)."
            : body.persisted
              ? "SEO Intelligence requested — SEOOS will fulfill it."
              : "Request created (not persisted — Firestore not configured).",
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
    <form onSubmit={submit} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-white/60">
          Client ID
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} required
            className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white" />
        </label>
        <label className="block text-xs text-white/60">
          Capability
          <select value={capability} onChange={(e) => setCapability(e.target.value as (typeof CAPABILITIES)[number])}
            className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white">
            {CAPABILITIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block text-xs text-white/60">
          Reporting start (ISO)
          <input value={start} onChange={(e) => setStart(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white" />
        </label>
        <label className="block text-xs text-white/60">
          Reporting end (ISO)
          <input value={end} onChange={(e) => setEnd(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white" />
        </label>
      </div>
      <label className="mt-3 block text-xs text-white/60">
        Specific questions (one per line)
        <textarea value={questions} onChange={(e) => setQuestions(e.target.value)} rows={2}
          className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white" />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <select value={priority} onChange={(e) => setPriority(e.target.value as "normal" | "high" | "urgent")}
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white">
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <button type="submit" disabled={busy}
          className="rounded-md bg-emerald-400 px-4 py-1.5 text-sm font-semibold text-emerald-950 disabled:opacity-60">
          {busy ? "Requesting…" : "Request SEO Intelligence"}
        </button>
        {message ? <span className="text-xs text-white/60">{message}</span> : null}
      </div>
    </form>
  );
}
