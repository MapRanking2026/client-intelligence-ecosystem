"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface StudyRow {
  id: string;
  title: string;
  niche?: string;
  source: string;
}

export function NicheStudyManager({
  studies,
  driveConnected,
}: {
  studies: StudyRow[];
  driveConnected: boolean;
}) {
  const router = useRouter();
  const [niche, setNiche] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/seo/niche-studies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ niche: niche || undefined, title, content }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setMessage((body && body.error) || "Add failed");
      else {
        setNiche("");
        setTitle("");
        setContent("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, label: string) {
    if (!window.confirm(`Remove "${label}"?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/seo/niche-studies/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function importDrive() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/seo/niche-studies/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderId: folderId || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setMessage((body && body.error) || "Import failed");
      else {
        setMessage(`Imported ${body.data.imported} new, updated ${body.data.updated}.`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {studies.length ? (
        <div className="table-scroll" style={{ marginBottom: 12 }}>
          <table className="data">
            <thead><tr><th>Study</th><th>Niche</th><th>Source</th><th /></tr></thead>
            <tbody>
              {studies.map((s) => (
                <tr key={s.id}>
                  <td>{s.title}</td>
                  <td className="muted">{s.niche || "general"}</td>
                  <td className="muted">{s.source}</td>
                  <td>
                    <button type="button" onClick={() => remove(s.id, s.title)} disabled={busy}
                      style={{ background: "transparent", color: "var(--danger)", border: "1px solid var(--border)" }}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>No niche studies yet. Add one below or import from Drive.</p>
      )}

      <div className="toolbar" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <input placeholder="Drive folder ID" value={folderId} onChange={(e) => setFolderId(e.target.value)} style={{ maxWidth: 260 }} />
        <button type="button" onClick={importDrive} disabled={busy || !driveConnected}>
          {busy ? "Working…" : "Import from Drive"}
        </button>
        {!driveConnected ? <span className="muted" style={{ fontSize: 12 }}>Connect Google Drive under Integrations first.</span> : null}
        {message ? <span className="muted" style={{ fontSize: 12 }}>{message}</span> : null}
      </div>

      <form onSubmit={add} className="panel">
        <div className="panel-head"><h3 className="panel-title">Add a niche study</h3></div>
        <div className="row">
          <div>
            <label htmlFor="ns-niche">Niche (optional)</label>
            <input id="ns-niche" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Roofing, HVAC…" />
          </div>
          <div>
            <label htmlFor="ns-title">Title</label>
            <input id="ns-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <label htmlFor="ns-content">Content</label>
          <textarea id="ns-content" value={content} onChange={(e) => setContent(e.target.value)} rows={5} required
            style={{ width: "100%" }} placeholder="The proven playbook / findings for this niche…" />
        </div>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button type="submit" disabled={busy || !title.trim() || !content.trim()}>Add study</button>
        </div>
      </form>
    </div>
  );
}
