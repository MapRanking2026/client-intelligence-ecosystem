"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface PromptRow {
  key: string;
  category: string;
  name: string;
  description: string;
  template: string;
  isCustom: boolean;
  updatedAt?: string;
}

function PromptCard({ p }: { p: PromptRow }) {
  const router = useRouter();
  const [value, setValue] = useState(p.template);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = value.trim() !== p.template.trim();

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/seo/prompts/${encodeURIComponent(p.key)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template: value }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setMsg((body && body.error) || "Save failed");
      else {
        setMsg("Saved — live now.");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!window.confirm(`Reset "${p.name}" to the built-in default?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await fetch(`/api/seo/prompts/${encodeURIComponent(p.key)}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="panel" style={{ marginBottom: 10 }}>
      <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong>{p.name}</strong>
        {p.isCustom ? <span className="badge status-active" style={{ fontSize: 11 }}>customized</span> : <span className="badge" style={{ fontSize: 11 }}>default</span>}
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto", fontFamily: "monospace" }}>{p.key}</span>
      </summary>
      <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>{p.description}</p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={6}
        spellCheck={false}
        style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 13, lineHeight: 1.5 }}
      />
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button type="button" onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : "Save (live)"}</button>
        {p.isCustom ? (
          <button type="button" onClick={reset} disabled={busy}
            style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}>
            Reset to default
          </button>
        ) : null}
        {msg ? <span className="muted" style={{ fontSize: 12 }}>{msg}</span> : null}
      </div>
    </details>
  );
}

export function PromptEngine({ prompts }: { prompts: PromptRow[] }) {
  const categories = [...new Set(prompts.map((p) => p.category))];
  return (
    <div>
      {categories.map((cat) => (
        <div key={cat} style={{ marginBottom: 22 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>{cat}</h3>
          {prompts.filter((p) => p.category === cat).map((p) => <PromptCard key={p.key} p={p} />)}
        </div>
      ))}
    </div>
  );
}
