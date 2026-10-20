"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { callApi, Msg } from "./client-api";

export function InitProfileButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await callApi(`/api/seo/ai-visibility/projects/${projectId}/profile`, "POST");
          setBusy(false);
          if (!r.ok) return setMsg({ kind: "error", text: r.error ?? "Failed" });
          router.push(`/ai-visibility/${projectId}/setup`);
          router.refresh();
        }}
      >
        {busy ? "Creating…" : "Set up AI visibility for this client"}
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function ReanalyzeButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  return (
    <span className="aiv-noprint">
      <button
        type="button"
        className="aiv-btn-ghost aiv-btn-sm"
        disabled={busy}
        title="Re-run detection over stored answers after changing aliases or competitors. Collected answers are not changed."
        onClick={async () => {
          setBusy(true);
          const r = await callApi<{ updated: number }>(`/api/seo/ai-visibility/projects/${projectId}/analysis`, "POST");
          setBusy(false);
          setMsg(r.ok ? { kind: "ok", text: `Re-analyzed ${r.data!.updated} answers.` } : { kind: "error", text: r.error ?? "Failed" });
          router.refresh();
        }}
      >
        {busy ? "Re-analyzing…" : "Re-run analysis"}
      </button>
      <Msg msg={msg} />
    </span>
  );
}

export function PrintButton() {
  return (
    <button type="button" className="aiv-noprint" onClick={() => window.print()}>
      Print / save as PDF
    </button>
  );
}
