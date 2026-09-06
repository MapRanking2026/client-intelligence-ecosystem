"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Start a service offering — creates an internal work order (no charge/notify). */
export function StartServiceButton({
  projectId,
  offeringId,
  label,
}: {
  projectId: string;
  offeringId: string;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/seo/projects/${projectId}/start-service`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offeringId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setMessage((body && body.error) || "Failed");
      else {
        setMessage("Work order created.");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="toolbar" style={{ marginTop: 6 }}>
      <button type="button" onClick={start} disabled={busy}>
        {busy ? "Starting…" : label}
      </button>
      {message ? <span className="muted" style={{ fontSize: 12 }}>{message}</span> : null}
    </div>
  );
}
