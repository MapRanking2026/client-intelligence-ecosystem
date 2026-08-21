"use client";

import { useEffect, useState } from "react";
import { Plus, X, LoaderCircle } from "lucide-react";

interface SectionNote {
  id: string;
  sectionKey: string;
  text: string;
  createdAt: string;
}

/**
 * A small "add anything we missed" affordance for any section whose context feeds
 * a generated brief or report. Notes persist per client + section and are folded
 * into what gets generated, so the produced document reflects the correction.
 */
export function SectionAdditions({
  clientId,
  sectionKey,
  label = "Add anything we missed",
  onChange,
}: {
  clientId: string;
  sectionKey: string;
  label?: string;
  onChange?: () => void;
}) {
  const [notes, setNotes] = useState<SectionNote[]>([]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch(`/api/clients/${clientId}/notes?section=${encodeURIComponent(sectionKey)}`);
      if (res.ok) setNotes((await res.json()).data as SectionNote[]);
    } catch {
      /* keep current */
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, sectionKey]);

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sectionKey, text: text.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Couldn't add that");
      setText("");
      setOpen(false);
      await refresh();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setNotes((n) => n.filter((x) => x.id !== id));
    await fetch(`/api/clients/${clientId}/notes?id=${id}`, { method: "DELETE" });
    onChange?.();
  }

  return (
    <div style={{ marginTop: 8 }}>
      {notes.length ? (
        <div className="flex flex-col gap-1" style={{ marginBottom: 8 }}>
          {notes.map((n) => (
            <div key={n.id} className="flex items-start gap-2 text-[0.78rem]" style={{ color: "var(--text-2)" }}>
              <span className="hl info" style={{ fontSize: "0.62rem", fontWeight: 700, padding: "1px 6px", flexShrink: 0 }}>ADDED</span>
              <span style={{ flex: 1 }}>{n.text}</span>
              <button type="button" onClick={() => void remove(n.id)} className="icon-btn" style={{ width: 20, height: 20 }} aria-label="Remove">
                <X style={{ width: 12, height: 12 }} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {open ? (
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            autoFocus
            placeholder="Add a point the system missed — it will be included in the brief and the generated report."
            style={{ width: "100%", padding: "8px 10px", borderRadius: "var(--r-md)", border: "1px solid var(--hair)", background: "var(--surface)", color: "var(--text)", fontSize: "0.82rem", resize: "vertical" }}
          />
          {error ? <div className="chip risk" style={{ marginTop: 6 }}>{error}</div> : null}
          <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void add()} disabled={busy} style={busy ? { opacity: 0.6 } : undefined}>
              {busy ? <LoaderCircle className="animate-spin" style={{ width: 14, height: 14 }} /> : null}
              {busy ? "Adding…" : "Add"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setText(""); setError(null); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-[0.76rem] font-semibold"
          style={{ color: "var(--accent)" }}
        >
          <Plus style={{ width: 13, height: 13 }} />
          {label}
        </button>
      )}
    </div>
  );
}
