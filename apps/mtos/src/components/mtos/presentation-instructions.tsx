"use client";
import { RankComparisonReview } from "./rank-comparison-review";
import { useState } from "react";
export function PresentationInstructions({ touchId, initial = "" }: { touchId: string; initial?: string }) {
  const [text, setText] = useState(initial), [saved, setSaved] = useState(initial), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save_touch_draft", presentationInstructions: text }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Instructions could not be saved.");
      setSaved(text); setMessage("Saved for the next presentation build. Existing slides have not changed.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Instructions could not be saved."); }
    finally { setBusy(false); }
  }
  return <div><details className="presentation-direction"><summary className="ilink text-xs" style={{ cursor: "pointer", width: "fit-content" }}>Add presentation instructions{saved ? " · saved" : ""}</summary><div className="mt-3 grid gap-2"><label className="field-label" htmlFor={`presentation-direction-${touchId}`}>What should this presentation emphasize?</label><textarea id={`presentation-direction-${touchId}`} className="textarea" rows={4} maxLength={8000} value={text} onChange={event => setText(event.target.value)} placeholder="Example: Keep an overview of all six profiles, but give extra attention to the location the client was worried about. Compare its relevant keywords with last month's scans." /><p className="field-hint">Internal direction for this Monthly Touch. Save before generating or regenerating. Evidence and completed-work-only rules still apply.</p><div><button type="button" className="btn btn-ghost btn-sm" disabled={busy || text === saved} onClick={() => void save()}>{busy ? "Saving…" : "Save presentation instructions"}</button></div>{message ? <p role="status" className="field-hint">{message}</p> : null}</div></details><RankComparisonReview touchId={touchId} /></div>;
}
