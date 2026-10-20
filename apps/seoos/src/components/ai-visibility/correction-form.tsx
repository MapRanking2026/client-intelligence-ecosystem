"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { callApi, Msg } from "./client-api";

interface EntityOpt {
  key: string;
  name: string;
  mentioned: boolean;
  recommended: boolean;
  sentiment: string;
  position: number | null;
}

/** Manual correction of one entity finding. Requires a reason; every change is audited. */
export function CorrectionForm({ projectId, observationId, entities, competitors }: { projectId: string; observationId: string; entities: EntityOpt[]; competitors: Array<{ key: string; name: string }> }) {
  const router = useRouter();
  const options = [...entities, ...competitors.filter((c) => !entities.some((e) => e.key === c.key)).map((c) => ({ key: c.key, name: c.name, mentioned: false, recommended: false, sentiment: "neutral", position: null }))];
  const [key, setKey] = useState(options[0]?.key ?? "client");
  const cur = options.find((o) => o.key === key);
  const [mentioned, setMentioned] = useState(String(cur?.mentioned ?? false));
  const [recommended, setRecommended] = useState(String(cur?.recommended ?? false));
  const [sentiment, setSentiment] = useState(cur?.sentiment ?? "neutral");
  const [position, setPosition] = useState(cur?.position ? String(cur.position) : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string; problems?: string[] } | null>(null);

  function pick(k: string) {
    setKey(k);
    const o = options.find((x) => x.key === k);
    setMentioned(String(o?.mentioned ?? false));
    setRecommended(String(o?.recommended ?? false));
    setSentiment(o?.sentiment ?? "neutral");
    setPosition(o?.position ? String(o.position) : "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await callApi(`/api/seo/ai-visibility/projects/${projectId}/observations/${observationId}`, "POST", {
      override: { entityKey: key, mentioned: mentioned === "true", recommended: recommended === "true", sentiment, position: position ? Number(position) : null },
      reason,
    });
    setBusy(false);
    if (!r.ok) setMsg({ kind: "error", text: r.error ?? "Failed", problems: r.problems });
    else {
      setMsg({ kind: "ok", text: "Correction saved and audited." });
      setReason("");
      router.refresh();
    }
  }

  return (
    <details className="aiv-noprint" style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer", fontSize: 13 }}>Correct a finding</summary>
      <form onSubmit={submit} style={{ marginTop: 8 }}>
        <div className="aiv-form-grid">
          <div>
            <label htmlFor="c-ent">Business</label>
            <select id="c-ent" value={key} onChange={(e) => pick(e.target.value)}>
              {options.map((o) => (
                <option key={o.key} value={o.key}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="c-men">Mentioned</label>
            <select id="c-men" value={mentioned} onChange={(e) => setMentioned(e.target.value)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div>
            <label htmlFor="c-rec">Recommended</label>
            <select id="c-rec" value={recommended} onChange={(e) => setRecommended(e.target.value)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div>
            <label htmlFor="c-sent">Sentiment</label>
            <select id="c-sent" value={sentiment} onChange={(e) => setSentiment(e.target.value)}>
              {["positive", "neutral", "negative", "ambiguous"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="c-pos">Ordered position (blank = none)</label>
            <input id="c-pos" type="number" min={1} max={50} value={position} onChange={(e) => setPosition(e.target.value)} />
          </div>
        </div>
        <label htmlFor="c-reason" style={{ marginTop: 8 }}>Reason (required)</label>
        <input id="c-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500} placeholder="e.g. Different business with the same name in Austin" />
        <div style={{ marginTop: 8 }}>
          <button type="submit" disabled={busy || reason.trim().length < 3}>{busy ? "Saving…" : "Save correction"}</button>
        </div>
        <Msg msg={msg} />
      </form>
    </details>
  );
}
