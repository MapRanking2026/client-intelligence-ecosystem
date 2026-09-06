"use client";

import { useState } from "react";

/** Admin action: email this client's monthly report to a recipient they enter. */
export function EmailReportButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/seo/reports/${projectId}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setMessage((body && body.error) || "Send failed");
      else {
        setMessage(`Sent to ${body.data.to}.`);
        setTo("");
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="toolbar">
        <button type="button" onClick={() => setOpen(true)}>Email report…</button>
        {message ? <span className="muted" style={{ fontSize: 12 }}>{message}</span> : null}
      </div>
    );
  }

  return (
    <form className="toolbar" onSubmit={send} style={{ flexWrap: "wrap", gap: 8 }}>
      <input
        type="email"
        placeholder="recipient@client.com"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        required
        style={{ maxWidth: 260 }}
      />
      <button type="submit" disabled={busy || !to}>{busy ? "Sending…" : "Send"}</button>
      <button type="button" onClick={() => setOpen(false)} style={{ background: "transparent", color: "var(--muted)" }}>
        cancel
      </button>
      {message ? <span className="muted" style={{ fontSize: 12 }}>{message}</span> : null}
    </form>
  );
}
