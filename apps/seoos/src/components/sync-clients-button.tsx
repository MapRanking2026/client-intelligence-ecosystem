"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SyncClientsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/seo/projects/sync", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage((body && body.error) || "Sync failed");
        return;
      }
      const d = body.data;
      if (!d.configured) {
        setMessage("Integration gateway not configured — set MTOS_GATEWAY_URL + CIE_SERVICE_SECRET.");
      } else if (!d.ok) {
        setMessage(`Sync error: ${d.error ?? "unknown"}`);
      } else {
        setMessage(`Synced ${d.total} client(s): ${d.created} new project(s), ${d.skipped} already linked.`);
        router.refresh();
      }
    } catch {
      setMessage("Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="toolbar">
      <button type="button" onClick={sync} disabled={busy}>
        {busy ? "Syncing…" : "Sync clients from MTOS"}
      </button>
      {message ? <span className="muted" style={{ fontSize: 12 }}>{message}</span> : null}
    </div>
  );
}
