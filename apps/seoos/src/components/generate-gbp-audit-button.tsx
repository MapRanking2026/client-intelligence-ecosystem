"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Generate a GBP audit draft for a client (proposed in SEOOS; never published). */
export function GenerateGbpAuditButton({ projectId, hasAudit }: { projectId: string; hasAudit?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/seo/gbp/${projectId}/audit`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage((body && body.error) || "Audit failed");
        return;
      }
      setMessage("GBP audit generated below.");
      router.refresh();
    } catch {
      setMessage("Audit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="toolbar" style={{ marginTop: 8 }}>
      <button type="button" onClick={run} disabled={busy}>
        {busy ? "Auditing…" : hasAudit ? "◉ Re-run GBP audit" : "◉ Generate GBP audit"}
      </button>
      {message ? <span className="muted" style={{ fontSize: 12 }}>{message}</span> : null}
    </div>
  );
}
