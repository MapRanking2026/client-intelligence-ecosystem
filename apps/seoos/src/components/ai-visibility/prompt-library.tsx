"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PROMPT_GROUP_LABEL, type AivPromptV1, type PromptGroup } from "@/src/lib/ai-visibility/types";
import { callApi, Msg } from "./client-api";

type MsgT = { kind: "ok" | "error"; text: string; problems?: string[] } | null;
const GROUPS = Object.keys(PROMPT_GROUP_LABEL) as PromptGroup[];

function current(p: AivPromptV1) {
  return p.versions.find((v) => v.version === p.currentVersion)?.text ?? "";
}

function PromptRow({ p, base, canManage, locLabel, onMsg }: { p: AivPromptV1; base: string; canManage: boolean; locLabel: string; onMsg: (m: MsgT) => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(current(p));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    const r = await callApi(`${base}/prompts/${p.id}`, "PATCH", body);
    setBusy(false);
    if (!r.ok) return onMsg({ kind: "error", text: r.error ?? "Failed", problems: r.problems });
    onMsg({ kind: "ok", text: okText });
    setEditing(false);
    router.refresh();
  }

  return (
    <tr>
      <td>
        <span className={`aiv-pill ${p.status === "approved" ? "aiv-pill--ok" : p.status === "archived" ? "" : "aiv-pill--warn"}`}>{p.status}</span>
      </td>
      <td style={{ minWidth: 320 }}>
        {editing ? (
          <div>
            <textarea className="aiv-textarea" value={text} onChange={(e) => setText(e.target.value)} aria-label="Prompt text" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Change note (optional)" aria-label="Change note" style={{ marginTop: 4 }} />
            <div className="toolbar" style={{ marginTop: 6 }}>
              <button type="button" className="aiv-btn-sm" disabled={busy} onClick={() => patch({ text, changeNote: note || undefined }, `Saved as version ${p.currentVersion + 1}.`)}>Save new version</button>
              <button type="button" className="aiv-btn-ghost aiv-btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {current(p)}
            {p.nearMe ? <div className="aiv-ev">“Near me” prompt — uses the provider’s documented location control at scan time, or is labelled location-ambiguous.</div> : null}
          </>
        )}
      </td>
      <td>{p.serviceLabel ?? "—"}</td>
      <td>{locLabel}</td>
      <td className="num">
        v{p.currentVersion}
        {p.versions.length > 1 ? (
          <details>
            <summary className="aiv-ev" style={{ cursor: "pointer" }}>history</summary>
            <ol style={{ fontSize: 12, paddingLeft: 16, textAlign: "left" }}>
              {p.versions.map((v) => (
                <li key={v.version}>
                  v{v.version} · {v.createdAt.slice(0, 10)} · {v.createdBy}: {v.text}
                  {v.changeNote ? <em> ({v.changeNote})</em> : null}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </td>
      {canManage ? (
        <td style={{ whiteSpace: "nowrap" }}>
          {p.status !== "approved" ? <button type="button" className="aiv-btn-sm" disabled={busy} onClick={() => patch({ status: "approved" }, "Prompt approved.")}>Approve</button> : null}{" "}
          {!editing ? <button type="button" className="aiv-btn-ghost aiv-btn-sm" onClick={() => setEditing(true)}>Edit</button> : null}{" "}
          {p.status !== "archived" ? <button type="button" className="aiv-btn-ghost aiv-btn-sm" disabled={busy} onClick={() => patch({ status: "archived" }, "Prompt archived.")}>Archive</button> : <button type="button" className="aiv-btn-ghost aiv-btn-sm" disabled={busy} onClick={() => patch({ status: "draft" }, "Prompt restored as draft.")}>Restore</button>}
        </td>
      ) : null}
    </tr>
  );
}

export function PromptLibrary({
  projectId,
  prompts,
  canManage,
  services,
  locations,
  bilingual,
}: {
  projectId: string;
  prompts: AivPromptV1[];
  canManage: boolean;
  services: Array<{ id: string; value: string }>;
  locations: Array<{ id: string; label: string }>;
  bilingual: boolean;
}) {
  const router = useRouter();
  const base = `/api/seo/ai-visibility/projects/${projectId}`;
  const [msg, setMsg] = useState<MsgT>(null);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<PromptGroup[]>(["unbranded_discovery"]);
  const [nearMe, setNearMe] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [nt, setNt] = useState({ text: "", group: "unbranded_discovery" as PromptGroup, serviceId: services[0]?.id ?? "", locationId: locations[0]?.id ?? "" });
  const locLabel = (id?: string) => locations.find((l) => l.id === id)?.label ?? "—";

  async function generate() {
    setBusy(true);
    setMsg(null);
    const r = await callApi<{ created: unknown[]; skipped: Array<{ text: string; reason: string }> }>(`${base}/prompts`, "POST", { action: "generate", groups, includeNearMe: nearMe, maxPerGroup: 10 });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.error ?? "Failed", problems: r.problems });
    setMsg({
      kind: "ok",
      text: `Generated ${r.data!.created.length} draft prompt(s). Review and approve them before scanning.`,
      problems: r.data!.skipped.slice(0, 5).map((s) => `Skipped: “${s.text}” — ${s.reason}`),
    });
    router.refresh();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await callApi(`${base}/prompts`, "POST", { action: "create", ...nt, serviceId: nt.serviceId || undefined, locationId: nt.locationId || undefined });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.error ?? "Failed", problems: r.problems });
    setMsg({ kind: "ok", text: "Prompt added as a draft." });
    setNt({ ...nt, text: "" });
    router.refresh();
  }

  const visible = prompts.filter((p) => showArchived || p.status !== "archived");
  return (
    <div>
      {canManage ? (
        <section className="panel aiv-noprint">
          <h2 className="panel-title">Generate prompts from approved services and locations</h2>
          <p className="aiv-ev">Unbranded prompts never contain the client’s name, website or competitors. Each request is sent fresh, with no history and no system prompt.</p>
          <div className="aiv-inline">
            {GROUPS.filter((g) => g !== "bilingual" || bilingual).map((g) => (
              <label key={g} style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--fg)", margin: 0 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={groups.includes(g)} onChange={(e) => setGroups(e.target.checked ? [...groups, g] : groups.filter((x) => x !== g))} />
                {PROMPT_GROUP_LABEL[g]}
              </label>
            ))}
            <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--fg)", margin: 0 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={nearMe} onChange={(e) => setNearMe(e.target.checked)} />
              Include “near me” variants
            </label>
            <button type="button" onClick={generate} disabled={busy || !groups.length}>Generate drafts</button>
          </div>
        </section>
      ) : null}
      <Msg msg={msg} />
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Prompt library ({prompts.filter((p) => p.status === "approved").length} approved)</h2>
          <label style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
        </div>
        {GROUPS.map((g) => {
          const rows = visible.filter((p) => p.group === g);
          if (!rows.length) return null;
          return (
            <div key={g} style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 14, margin: "10px 0 6px" }}>{PROMPT_GROUP_LABEL[g]} <span className="muted">({rows.length})</span></h3>
              <div className="aiv-table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Prompt</th>
                      <th>Service</th>
                      <th>Location</th>
                      <th className="num">Version</th>
                      {canManage ? <th>Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <PromptRow key={p.id} p={p} base={base} canManage={canManage} locLabel={locLabel(p.locationId)} onMsg={setMsg} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        {!visible.length ? <p className="muted">No prompts yet. Generate drafts from the approved services and locations.</p> : null}
      </section>
      {canManage ? (
        <section className="panel aiv-noprint">
          <h2 className="panel-title">Add a custom prompt</h2>
          <form onSubmit={create}>
            <textarea className="aiv-textarea" value={nt.text} onChange={(e) => setNt({ ...nt, text: e.target.value })} placeholder="Who can repair a garage door spring in Smyrna, TN today?" aria-label="Custom prompt text" required minLength={8} />
            <div className="aiv-form-grid" style={{ marginTop: 8 }}>
              <div>
                <label htmlFor="np-g">Group</label>
                <select id="np-g" value={nt.group} onChange={(e) => setNt({ ...nt, group: e.target.value as PromptGroup })}>
                  {GROUPS.map((g) => (
                    <option key={g} value={g}>{PROMPT_GROUP_LABEL[g]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="np-s">Service</label>
                <select id="np-s" value={nt.serviceId} onChange={(e) => setNt({ ...nt, serviceId: e.target.value })}>
                  <option value="">—</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.value}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="np-l">Location</label>
                <select id="np-l" value={nt.locationId} onChange={(e) => setNt({ ...nt, locationId: e.target.value })}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <button type="submit" style={{ marginTop: 8 }} disabled={busy}>Add draft</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
