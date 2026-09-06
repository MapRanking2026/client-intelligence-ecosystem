"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Generate a full scan for a project (pull every connected source + advance setup). */
export function FullScanButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/seo/projects/${projectId}/full-scan`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage((body && body.error) || "Scan failed");
        return;
      }
      const d = body.data;
      const parts = Object.entries(d.sources || {}).map(
        ([k, v]) => `${k}: ${(v as { ok?: boolean }).ok ? "ok" : "—"}`,
      );
      setMessage(`Scan complete. Setup ${d.setupReadiness}%. ${parts.join(", ")}`);
      router.refresh();
    } catch {
      setMessage("Scan failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="toolbar">
      <button type="button" onClick={run} disabled={busy}>
        {busy ? "Scanning…" : "⚡ Generate full scan"}
      </button>
      {message ? <span className="muted" style={{ fontSize: 12 }}>{message}</span> : null}
    </div>
  );
}
