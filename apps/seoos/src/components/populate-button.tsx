"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PopulateButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function pull() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/seo/projects/${projectId}/populate`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage((body && body.error) || "Pull failed");
        return;
      }
      const d = body.data;
      if (!d.configured) {
        setMessage("Gateway not configured — set MTOS_GATEWAY_URL + CIE_SERVICE_SECRET.");
      } else if (!d.ok) {
        setMessage(`Pull error: ${d.error ?? "unknown"}`);
      } else {
        setMessage(`Pulled ${d.gridCount} grid(s), ${d.businessCount} business(es); +${d.keywordsCreated} keywords (${d.keywordsSkipped} existing).`);
        router.refresh();
      }
    } catch {
      setMessage("Pull failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="toolbar" style={{ margin: 0 }}>
      <button type="button" onClick={pull} disabled={busy}>
        {busy ? "Pulling…" : "Pull data from MTOS"}
      </button>
      {message ? <span className="muted" style={{ fontSize: 12 }}>{message}</span> : null}
    </span>
  );
}
