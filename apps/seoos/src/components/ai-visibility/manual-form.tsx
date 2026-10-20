"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PROMPT_GROUP_LABEL, type PromptGroup } from "@/src/lib/ai-visibility/types";
import { callApi, Msg } from "./client-api";

export function ManualForm({
  projectId,
  surfaces,
  services,
  locations,
}: {
  projectId: string;
  surfaces: readonly string[];
  services: Array<{ id: string; value: string }>;
  locations: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [f, setF] = useState({ surface: surfaces[0], promptText: "", group: "unbranded_discovery" as PromptGroup, answerText: "", citations: "", serviceId: "", locationId: locations[0]?.id ?? "", observedAt: "", note: "" });
  const [shot, setShot] = useState<{ mimeType: string; dataBase64: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string; problems?: string[] } | null>(null);

  function onFile(file: File | undefined) {
    if (!file) return setShot(null);
    if (file.size > 700 * 1024) return setMsg({ kind: "error", text: "Screenshot must be 700 KB or smaller." });
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      setShot({ mimeType: file.type, dataBase64: s.slice(s.indexOf(",") + 1), name: file.name });
    };
    reader.readAsDataURL(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await callApi<{ id: string }>(`/api/seo/ai-visibility/projects/${projectId}/manual`, "POST", {
      surface: f.surface,
      promptText: f.promptText,
      group: f.group,
      answerText: f.answerText,
      citationUrls: f.citations.split(/\s+/).filter(Boolean),
      serviceId: f.serviceId || undefined,
      locationId: f.locationId || undefined,
      observedAt: f.observedAt ? new Date(f.observedAt).toISOString() : undefined,
      note: f.note || undefined,
      screenshot: shot ? { mimeType: shot.mimeType, dataBase64: shot.dataBase64 } : undefined,
    });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.error ?? "Failed", problems: r.problems });
    setMsg({ kind: "ok", text: "Manual observation saved and analyzed." });
    setF({ ...f, promptText: "", answerText: "", citations: "", note: "" });
    setShot(null);
    router.refresh();
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2 className="panel-title">Record a manual observation</h2>
      <p className="aiv-ev">Paste exactly what the consumer surface showed. Manual observations are labelled “manual” and reported separately from API measurements.</p>
      <div className="aiv-form-grid">
        <div>
          <label htmlFor="m-s">Surface</label>
          <select id="m-s" value={f.surface} onChange={(e) => setF({ ...f, surface: e.target.value })}>
            {surfaces.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="m-g">Prompt group</label>
          <select id="m-g" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value as PromptGroup })}>
            {(Object.keys(PROMPT_GROUP_LABEL) as PromptGroup[]).map((g) => (
              <option key={g} value={g}>{PROMPT_GROUP_LABEL[g]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="m-sv">Service</label>
          <select id="m-sv" value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })}>
            <option value="">—</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.value}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="m-l">Location</label>
          <select id="m-l" value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}>
            <option value="">—</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="m-d">Observed at</label>
          <input id="m-d" type="datetime-local" value={f.observedAt} onChange={(e) => setF({ ...f, observedAt: e.target.value })} />
        </div>
      </div>
      <label htmlFor="m-p" style={{ marginTop: 10 }}>Prompt as typed</label>
      <input id="m-p" value={f.promptText} onChange={(e) => setF({ ...f, promptText: e.target.value })} required minLength={5} />
      <label htmlFor="m-a" style={{ marginTop: 10 }}>Answer text</label>
      <textarea id="m-a" className="aiv-textarea" style={{ minHeight: 160 }} value={f.answerText} onChange={(e) => setF({ ...f, answerText: e.target.value })} required />
      <label htmlFor="m-c" style={{ marginTop: 10 }}>Cited URLs (space or newline separated)</label>
      <textarea id="m-c" className="aiv-textarea" value={f.citations} onChange={(e) => setF({ ...f, citations: e.target.value })} />
      <label htmlFor="m-f" style={{ marginTop: 10 }}>Screenshot (PNG/JPEG/WebP, ≤ 700 KB, optional)</label>
      <input id="m-f" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onFile(e.target.files?.[0])} />
      <label htmlFor="m-n" style={{ marginTop: 10 }}>Note</label>
      <input id="m-n" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <button type="submit" style={{ marginTop: 10 }} disabled={busy}>{busy ? "Saving…" : "Save manual observation"}</button>
      <Msg msg={msg} />
    </form>
  );
}
