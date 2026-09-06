"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Trigger AI recommendation generation for a project (results are proposed). */
export function GenerateAiRecsButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/seo/recommendations/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage((body && body.error) || "Generation failed");
        return;
      }
      const d = body.data;
      if (!d.ok) setMessage(d.error ?? "No recommendations generated");
      else {
        setMessage(`Generated ${d.created} recommendation(s) — review and approve below.`);
        router.refresh();
      }
    } catch {
      setMessage("Generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="toolbar" style={{ marginTop: 8 }}>
      <button type="button" onClick={generate} disabled={busy}>
        {busy ? "Generating…" : "✦ Generate AI recommendations"}
      </button>
      {message ? <span className="muted" style={{ fontSize: 12 }}>{message}</span> : null}
    </div>
  );
}
