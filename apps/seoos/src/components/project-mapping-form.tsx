"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectMappingForm({
  projectId,
  clickupListId,
}: {
  projectId: string;
  clickupListId?: string;
}) {
  const router = useRouter();
  const [listId, setListId] = useState(clickupListId ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/seo/projects/${projectId}/mapping`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalIds: { clickupListId: listId } }),
      });
      if (res.ok) {
        setMessage("Saved.");
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        setMessage((body && body.error) || "Save failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <label htmlFor="clickupListId">ClickUp List ID</label>
      <input
        id="clickupListId"
        value={listId}
        onChange={(e) => setListId(e.target.value)}
        placeholder="e.g. 901234567"
        style={{ maxWidth: 260 }}
      />
      <p className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
        In ClickUp, open the client&apos;s List → the URL ends with
        <code> /li/&lt;listId&gt;</code>. Paste that id here, then run{" "}
        <strong>Sync all sources</strong> to pull the client&apos;s tasks.
      </p>
      <div className="toolbar" style={{ margin: 0 }}>
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save mapping"}</button>
        {message ? <span className="muted" style={{ fontSize: 12 }}>{message}</span> : null}
      </div>
    </form>
  );
}
