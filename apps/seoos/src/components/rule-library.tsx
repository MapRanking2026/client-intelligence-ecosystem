"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface RuleRow {
  key: string;
  category: string;
  name: string;
  description: string;
  value: string;
  defaultValue: string;
  unit?: string;
  alternatives?: string[];
  sources?: string[];
  isCustom: boolean;
  updatedAt?: string;
}

function RuleCard({ r }: { r: RuleRow }) {
  const router = useRouter();
  const [value, setValue] = useState(r.value);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = value.trim() !== r.value.trim();

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/seo/rules/${encodeURIComponent(r.key)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
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
    if (!window.confirm(`Reset "${r.name}" to the default (${r.defaultValue})?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await fetch(`/api/seo/rules/${encodeURIComponent(r.key)}`, { method: "DELETE" });
      setValue(r.defaultValue);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <strong>{r.name}</strong>
        {r.isCustom ? (
          <span className="badge status-active" style={{ fontSize: 11 }}>customized</span>
        ) : (
          <span className="badge" style={{ fontSize: 11 }}>default</span>
        )}
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto", fontFamily: "monospace" }}>{r.key}</span>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: "6px 0 10px" }}>{r.description}</p>

      <div className="toolbar" style={{ alignItems: "center", gap: 8 }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          style={{ width: 140, fontFamily: "ui-monospace, monospace", fontSize: 13 }}
        />
        {r.unit ? <span className="muted" style={{ fontSize: 12 }}>{r.unit}</span> : null}
        <button type="button" onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : "Save (live)"}</button>
        {r.isCustom ? (
          <button type="button" onClick={reset} disabled={busy}
            style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}>
            Reset to default
          </button>
        ) : null}
        {msg ? <span className="muted" style={{ fontSize: 12 }}>{msg}</span> : null}
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span>Default: <code>{r.defaultValue}</code></span>
        {r.alternatives?.length ? <span>Also documented: {r.alternatives.map((a) => <code key={a} style={{ marginRight: 6 }}>{a}</code>)}</span> : null}
        {r.sources?.length ? <span>SOP: {r.sources.join(", ")}</span> : null}
      </div>
    </div>
  );
}

export function RuleLibrary({ rules }: { rules: RuleRow[] }) {
  const categories = [...new Set(rules.map((r) => r.category))];
  return (
    <div>
      {categories.map((cat) => (
        <div key={cat} style={{ marginBottom: 22 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>{cat}</h3>
          {rules.filter((r) => r.category === cat).map((r) => <RuleCard key={r.key} r={r} />)}
        </div>
      ))}
    </div>
  );
}
