"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { callApi, Msg } from "./client-api";

/** Progress + controls for one scan; polls while the scan is active. */
export function ScanLive({ projectId, scanId, status, canManage, hasFailed, pending }: { projectId: string; scanId: string; status: string; canManage: boolean; hasFailed: boolean; pending: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const active = status === "queued" || status === "running";

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [active, router]);

  async function act(action: "cancel" | "retry_failed" | "resume", ok: string) {
    setBusy(true);
    const r = await callApi(`/api/seo/ai-visibility/projects/${projectId}/scans/${scanId}`, "POST", { action });
    setBusy(false);
    setMsg(r.ok ? { kind: "ok", text: ok } : { kind: "error", text: r.error ?? "Failed" });
    router.refresh();
  }

  return (
    <div className="aiv-noprint">
      {active ? <p className="muted" aria-live="polite">Processing in the background — this page refreshes every few seconds. You can leave and come back.</p> : null}
      {canManage ? (
        <div className="toolbar">
          {active ? <button type="button" className="aiv-btn-danger" disabled={busy} onClick={() => act("cancel", "Scan cancelled. Collected observations are kept.")}>Cancel scan</button> : null}
          {active && pending > 0 ? <button type="button" className="aiv-btn-ghost" disabled={busy} onClick={() => act("resume", "Processing resumed.")}>Resume processing</button> : null}
          {hasFailed ? <button type="button" className="aiv-btn-ghost" disabled={busy} onClick={() => act("retry_failed", "Failed observations re-queued (no duplicates will be created).")}>Retry failed</button> : null}
        </div>
      ) : null}
      <Msg msg={msg} />
    </div>
  );
}
