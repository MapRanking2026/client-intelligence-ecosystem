"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function EngineReconcileButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/engine/reconcile", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) setMsg((body && body.error) || "Failed");
      else {
        const r = body.data?.report;
        setMsg(
          r
            ? `Ingested ${r.totalInputs} record(s) → ${r.canonicalClients} canonical client(s), ${r.merged} merged, ${r.conflicts.length} conflict(s).`
            : "Done.",
        );
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="toolbar" style={{ marginBottom: 12 }}>
      <button type="button" onClick={run} disabled={busy}>
        {busy ? "Reconciling…" : "Run ingest + reconcile"}
      </button>
      <span className="muted" style={{ fontSize: 12 }}>
        Reads the ClickUp SEO Dashboard (read-only) and rebuilds the canonical client records.
      </span>
      {msg ? <span className="muted" style={{ fontSize: 12 }}>{msg}</span> : null}
    </div>
  );
}
