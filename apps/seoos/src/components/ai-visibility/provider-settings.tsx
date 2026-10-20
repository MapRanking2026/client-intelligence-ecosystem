"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ProviderStatusRow } from "@/src/lib/server/ai-visibility/settings-service";
import { callApi, Msg } from "./client-api";

function ProviderCard({ row, canManage }: { row: ProviderStatusRow; canManage: boolean }) {
  const router = useRouter();
  const [s, setS] = useState(row.settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string; problems?: string[] } | null>(null);
  const unsupported = row.credential.state === "unsupported";

  async function save() {
    setBusy(true);
    const r = await callApi("/api/seo/ai-visibility/providers", "PUT", {
      providerId: row.providerId,
      patch: { enabled: s.enabled, model: s.model, maxSearchUses: s.maxSearchUses, maxOutputTokens: s.maxOutputTokens, timeoutMs: s.timeoutMs, requestsPerMinute: s.requestsPerMinute, maxConcurrency: s.maxConcurrency },
    });
    setBusy(false);
    setMsg(r.ok ? { kind: "ok", text: "Saved." } : { kind: "error", text: r.error ?? "Failed", problems: r.problems });
    router.refresh();
  }
  async function test() {
    setBusy(true);
    const r = await callApi<{ ok: boolean; message: string; latencyMs: number }>(`/api/seo/ai-visibility/providers/${row.providerId}/test`, "POST", {});
    setBusy(false);
    if (!r.ok) setMsg({ kind: "error", text: r.error ?? "Failed" });
    else setMsg({ kind: r.data!.ok ? "ok" : "error", text: `${r.data!.ok ? "Connected" : "Failed"}: ${r.data!.message} (${r.data!.latencyMs} ms)` });
    router.refresh();
  }

  const state = unsupported ? "Unsupported" : row.credential.state === "not_configured" ? "Not configured" : row.ready ? "Ready" : row.readyReason;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{row.displayName}</h2>
        <span className={`aiv-pill ${row.ready ? "aiv-pill--ok" : unsupported ? "" : "aiv-pill--warn"}`}>{state}</span>
      </div>
      <p className="aiv-ev" style={{ marginTop: 0 }}>
        Channel: Official API. Observations are labelled “{row.surfaceLabel}”. {row.credential.detail}.{" "}
        {row.docsUrl ? <a href={row.docsUrl} target="_blank" rel="noopener noreferrer">Provider docs</a> : null}
      </p>
      {!unsupported ? (
        <>
          <p className="aiv-ev">
            Web search: {row.capabilities.webSearch ? "yes" : "no"} · Location control: {row.capabilities.locationControl === "none" ? "none (near-me prompts are location-ambiguous)" : "approximate user location"} · Reports whether search ran: {row.capabilities.reportsSearchExecuted ? "yes" : "no"}
          </p>
          <div className="aiv-form-grid">
            <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--fg)" }}>
              <input type="checkbox" style={{ width: "auto" }} checked={s.enabled} disabled={!canManage} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Enabled for scans
            </label>
            <div>
              <label htmlFor={`${row.providerId}-m`}>Model ID</label>
              <input id={`${row.providerId}-m`} value={s.model} disabled={!canManage} onChange={(e) => setS({ ...s, model: e.target.value.trim() })} />
              {!row.priced ? <div className="aiv-ev" style={{ color: "var(--danger)" }}>No verified price for this model — scans are blocked.</div> : null}
            </div>
            <div>
              <label htmlFor={`${row.providerId}-su`}>Max searches per answer</label>
              <input id={`${row.providerId}-su`} type="number" min={1} max={10} value={s.maxSearchUses} disabled={!canManage} onChange={(e) => setS({ ...s, maxSearchUses: Number(e.target.value) })} />
            </div>
            <div>
              <label htmlFor={`${row.providerId}-mo`}>Max output tokens</label>
              <input id={`${row.providerId}-mo`} type="number" min={256} max={8000} value={s.maxOutputTokens} disabled={!canManage} onChange={(e) => setS({ ...s, maxOutputTokens: Number(e.target.value) })} />
            </div>
            <div>
              <label htmlFor={`${row.providerId}-to`}>Timeout (ms)</label>
              <input id={`${row.providerId}-to`} type="number" min={5000} max={240000} step={1000} value={s.timeoutMs} disabled={!canManage} onChange={(e) => setS({ ...s, timeoutMs: Number(e.target.value) })} />
            </div>
            <div>
              <label htmlFor={`${row.providerId}-rpm`}>Requests per minute</label>
              <input id={`${row.providerId}-rpm`} type="number" min={1} max={600} value={s.requestsPerMinute} disabled={!canManage} onChange={(e) => setS({ ...s, requestsPerMinute: Number(e.target.value) })} />
            </div>
            <div>
              <label htmlFor={`${row.providerId}-c`}>Max concurrent requests</label>
              <input id={`${row.providerId}-c`} type="number" min={1} max={10} value={s.maxConcurrency} disabled={!canManage} onChange={(e) => setS({ ...s, maxConcurrency: Number(e.target.value) })} />
            </div>
          </div>
          {row.settings.lastTestAt ? (
            <p className="aiv-ev">Last test {row.settings.lastTestAt.slice(0, 16).replace("T", " ")}: {row.settings.lastTestOk ? "OK" : "failed"} — {row.settings.lastTestMessage}</p>
          ) : null}
          {canManage ? (
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button type="button" onClick={save} disabled={busy}>Save</button>
              <button type="button" className="aiv-btn-ghost" onClick={test} disabled={busy || row.credential.state !== "configured"}>Test connection</button>
            </div>
          ) : null}
        </>
      ) : null}
      <Msg msg={msg} />
    </section>
  );
}

export function ProviderSettings({ rows, canManage, agencyCap }: { rows: ProviderStatusRow[]; canManage: boolean; agencyCap: number }) {
  const router = useRouter();
  const [cap, setCap] = useState(agencyCap);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  async function saveCap() {
    const r = await callApi("/api/seo/ai-visibility/settings", "PUT", { monthlyAgencyCapUsd: cap });
    setMsg(r.ok ? { kind: "ok", text: "Agency cap saved." } : { kind: "error", text: r.error ?? "Failed" });
    router.refresh();
  }
  return (
    <div>
      <section className="panel">
        <h2 className="panel-title">Agency spending cap</h2>
        <p className="aiv-ev">Hard monthly ceiling across all clients. Every provider call reserves its worst-case cost first; calls that would exceed any cap are not made.</p>
        <div className="aiv-inline">
          <label htmlFor="agcap" style={{ margin: 0 }}>USD per month</label>
          <input id="agcap" type="number" min={0} step={5} value={cap} disabled={!canManage} onChange={(e) => setCap(Number(e.target.value))} style={{ maxWidth: 160 }} />
          {canManage ? <button type="button" onClick={saveCap}>Save cap</button> : null}
        </div>
        <Msg msg={msg} />
      </section>
      {rows.map((r) => (
        <ProviderCard key={r.providerId} row={r} canManage={canManage} />
      ))}
      <section className="panel">
        <h2 className="panel-title">Consumer search surfaces (Google AI Overviews / AI Mode, ChatGPT app)</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          <span className="aiv-pill">Not configured</span> No supported integration that captures and preserves these consumer surfaces is connected. Official-API results are never relabelled as consumer results. Use the Manual tab to record answers or screenshots seen in a consumer app.
        </p>
      </section>
    </div>
  );
}
