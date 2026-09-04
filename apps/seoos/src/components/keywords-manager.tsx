"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { KeywordV1, KeywordStatus } from "@/src/lib/domain/keyword";

const STATUSES: KeywordStatus[] = [
  "proposed",
  "approved",
  "tracking",
  "optimizing",
  "paused",
  "won",
  "retired",
];

export function KeywordsManager({
  projectId,
  clientId,
  keywords,
}: {
  projectId: string;
  clientId: string;
  keywords: KeywordV1[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<KeywordStatus | "all">("all");
  const [phrase, setPhrase] = useState("");
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const visible = useMemo(
    () => (filter === "all" ? keywords : keywords.filter((k) => k.status === filter)),
    [keywords, filter],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function post(url: string, body: unknown): Promise<Record<string, unknown> | null> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setMessage((json && (json.error as string)) || "Request failed");
      return null;
    }
    return json;
  }

  async function addKeyword(e: React.FormEvent) {
    e.preventDefault();
    if (!phrase.trim()) return;
    setBusy(true);
    setMessage(null);
    const r = await post("/api/seo/keywords", { projectId, clientId, phrase });
    setBusy(false);
    if (r) {
      setMessage(r.deduped ? "Already exists (deduped)." : "Keyword added.");
      setPhrase("");
      router.refresh();
    }
  }

  async function runImport() {
    const phrases = importText.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
    if (!phrases.length) return;
    setBusy(true);
    setMessage(null);
    const r = await post("/api/seo/keywords/import", { projectId, phrases });
    setBusy(false);
    if (r?.data) {
      const d = r.data as { created: number; skipped: number };
      setMessage(`Imported ${d.created}, skipped ${d.skipped} duplicates.`);
      setImportText("");
      router.refresh();
    }
  }

  async function bulk(action: "set_status" | "retire", status?: KeywordStatus) {
    if (selected.size === 0) return;
    setBusy(true);
    setMessage(null);
    const r = await post("/api/seo/keywords/bulk", {
      keywordIds: [...selected],
      action,
      status,
    });
    setBusy(false);
    if (r?.data) {
      setMessage(`Updated ${(r.data as { updated: number }).updated} keyword(s).`);
      setSelected(new Set());
      router.refresh();
    }
  }

  return (
    <div>
      <form className="panel" onSubmit={addKeyword}>
        <div className="panel-head">
          <h2 className="panel-title">Add keyword</h2>
        </div>
        <div className="toolbar">
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="e.g. emergency plumber austin"
            style={{ maxWidth: 360 }}
          />
          <button type="submit" disabled={busy}>Add</button>
        </div>
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Bulk import (one per line or comma-separated)</summary>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={4}
            style={{ width: "100%", marginTop: 8, background: "#0c1626", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, fontFamily: "inherit" }}
            placeholder={"water heater repair\ndrain cleaning near me"}
          />
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button type="button" onClick={runImport} disabled={busy}>Import list</button>
          </div>
        </details>
        {message ? <p className="muted" style={{ margin: "8px 0 0" }}>{message}</p> : null}
      </form>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Keywords ({visible.length})</h2>
          <div className="toolbar" style={{ margin: 0 }}>
            <label htmlFor="kwfilter" style={{ margin: 0 }}>Filter</label>
            <select id="kwfilter" value={filter} onChange={(e) => setFilter(e.target.value as KeywordStatus | "all")} style={{ maxWidth: 160 }}>
              <option value="all">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {selected.size > 0 ? (
          <div className="toolbar">
            <span className="muted">{selected.size} selected:</span>
            <button type="button" disabled={busy} onClick={() => bulk("set_status", "approved")}>Approve</button>
            <button type="button" disabled={busy} onClick={() => bulk("set_status", "tracking")}>Start tracking</button>
            <button type="button" disabled={busy} onClick={() => bulk("retire")} style={{ background: "transparent", color: "var(--danger)", border: "1px solid var(--border)" }}>Retire</button>
          </div>
        ) : null}

        {visible.length === 0 ? (
          <p className="muted">No keywords for this filter.</p>
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th>Keyword</th>
                  <th>Status</th>
                  <th>Group</th>
                  <th>Priority</th>
                  <th>Intent</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${k.phrase}`}
                        checked={selected.has(k.id)}
                        onChange={() => toggle(k.id)}
                        style={{ width: "auto" }}
                      />
                    </td>
                    <td>{k.phrase}</td>
                    <td><span className={`badge status-${k.status}`}>{k.status}</span></td>
                    <td className="muted">{k.group ?? "—"}</td>
                    <td>{k.priority}</td>
                    <td className="muted">{k.intent ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
