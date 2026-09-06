"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TaskActions({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refreshOne() {
    setBusy("one");
    setMsg(null);
    try {
      const res = await fetch("/api/seo/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setMsg((body && body.error) || "Failed");
      else {
        const d = body.data;
        setMsg(`Plan up to date (${d.frontier}): +${d.created} new, ${d.reassigned} reassigned.`);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function backfill() {
    if (!window.confirm("Refresh the task plan for EVERY client? Idempotent — it only adds what's missing.")) return;
    setBusy("all");
    setMsg(null);
    try {
      const res = await fetch("/api/seo/tasks/backfill", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) setMsg((body && body.error) || "Failed");
      else {
        const d = body.data;
        setMsg(`Backfilled ${d.clients} client(s): +${d.created} tasks, ${d.reassigned} reassigned.`);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="toolbar" style={{ marginBottom: 10 }}>
      <button type="button" onClick={refreshOne} disabled={busy !== null}>
        {busy === "one" ? "Refreshing…" : "Refresh this plan"}
      </button>
      {isAdmin ? (
        <button type="button" onClick={backfill} disabled={busy !== null}
          style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}>
          {busy === "all" ? "Backfilling…" : "Backfill all clients"}
        </button>
      ) : null}
      {msg ? <span className="muted" style={{ fontSize: 12 }}>{msg}</span> : null}
    </div>
  );
}
