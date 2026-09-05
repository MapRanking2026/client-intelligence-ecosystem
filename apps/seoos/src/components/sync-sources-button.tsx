"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SyncSourcesButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/seo/projects/${projectId}/sync-sources`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage((body && body.error) || "Sync failed");
        return;
      }
      const sources = (body.data?.sources ?? {}) as Record<string, { ok: boolean; summary?: string; error?: string }>;
      const ok = Object.values(sources).filter((s) => s.ok).length;
      setMessage(`${ok}/${Object.keys(sources).length} sources synced`);
      router.refresh();
    } catch {
      setMessage("Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <button type="button" onClick={sync} disabled={busy} style={{ padding: "4px 10px", fontSize: 12 }}>
        {busy ? "Syncing…" : "Sync all sources"}
      </button>
      {message ? <span className="muted" style={{ fontSize: 11 }}>{message}</span> : null}
    </span>
  );
}
