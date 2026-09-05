"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Admin action: pull the full client roster from ClickUp into SEOOS. Renders
 * only for admins (the parent gates on tenant-wide visibility).
 */
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
      if (!d.ok) {
        setMessage(d.error ?? "Sync error");
      } else {
        setMessage(
          `Synced ${d.total} active client(s): ${d.created} new, ${d.updated} refreshed` +
            (d.skipped ? `, ${d.skipped} inactive skipped.` : "."),
        );
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
        {busy ? "Syncing…" : "Sync all clients from ClickUp"}
      </button>
      {message ? <span className="muted" style={{ fontSize: 12 }}>{message}</span> : null}
    </div>
  );
}
