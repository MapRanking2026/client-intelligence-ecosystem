"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AivCompetitor, AivLocation, AivProfileV1, ProviderId, ReviewedValue } from "@/src/lib/ai-visibility/types";
import { callApi, Msg } from "./client-api";

type MsgT = { kind: "ok" | "error"; text: string; problems?: string[] } | null;

function rid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const STATUS_LABEL = { approved: "Approved", suggested: "Suggested — review", rejected: "Rejected" } as const;
const SOURCE_LABEL: Record<string, string> = { user: "entered by user", cie: "from client record", website_extraction: "extracted from website" };

function StatusSelect({ value, onChange, id }: { value: ReviewedValue["status"]; onChange: (v: ReviewedValue["status"]) => void; id: string }) {
  return (
    <select id={id} aria-label="Review status" value={value} onChange={(e) => onChange(e.target.value as ReviewedValue["status"])} style={{ width: 170 }}>
      {(["approved", "suggested", "rejected"] as const).map((s) => (
        <option key={s} value={s}>{STATUS_LABEL[s]}</option>
      ))}
    </select>
  );
}

function ReviewedList({ label, items, onChange, placeholder, help }: { label: string; items: ReviewedValue[]; onChange: (v: ReviewedValue[]) => void; placeholder: string; help?: string }) {
  const [draft, setDraft] = useState("");
  return (
    <fieldset className="panel" style={{ margin: "10px 0" }}>
      <legend style={{ fontWeight: 600 }}>{label}</legend>
      {help ? <p className="aiv-ev" style={{ marginTop: 0 }}>{help}</p> : null}
      <ul className="aiv-list">
        {items.map((it, i) => (
          <li key={it.id}>
            <input className="grow" aria-label={`${label} value`} value={it.value} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <StatusSelect id={`${it.id}-st`} value={it.status} onChange={(s) => onChange(items.map((x, j) => (j === i ? { ...x, status: s } : x)))} />
            <span className="aiv-ev">{SOURCE_LABEL[it.source] ?? it.source}{it.evidence ? ` · ${it.evidence}` : ""}</span>
            <button type="button" className="aiv-btn-ghost aiv-btn-sm" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${it.value}`}>Remove</button>
          </li>
        ))}
      </ul>
      <div className="aiv-inline" style={{ marginTop: 8 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label={`New ${label}`} />
        <button
          type="button"
          className="aiv-btn-ghost aiv-btn-sm"
          disabled={!draft.trim()}
          onClick={() => {
            onChange([...items, { id: rid("v"), value: draft.trim(), status: "approved", source: "user" }]);
            setDraft("");
          }}
        >
          Add
        </button>
      </div>
    </fieldset>
  );
}

const csv = (xs: string[]) => xs.join(", ");
const uncsv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function ProfileEditor({
  projectId,
  initial,
  providers,
  check,
}: {
  projectId: string;
  initial: AivProfileV1;
  providers: Array<{ providerId: ProviderId; displayName: string; ready: boolean; readyReason: string }>;
  check: { ok: boolean; problems: string[]; warnings: string[] };
}) {
  const router = useRouter();
  const [p, setP] = useState<AivProfileV1>(initial);
  const [msg, setMsg] = useState<MsgT>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(initial.ownedDomains[0]?.value ? `https://${initial.ownedDomains[0].value}` : "");
  const set = <K extends keyof AivProfileV1>(k: K, v: AivProfileV1[K]) => setP((cur) => ({ ...cur, [k]: v }));
  const base = `/api/seo/ai-visibility/projects/${projectId}`;

  async function save() {
    setBusy(true);
    setMsg(null);
    const body = {
      businessName: p.businessName,
      aliases: p.aliases.filter((a) => a.value.trim()),
      ownedDomains: p.ownedDomains.filter((d) => d.value.trim()),
      gbpUrl: p.gbpUrl || undefined,
      placeId: p.placeId || undefined,
      primaryLocationId: p.primaryLocationId || undefined,
      timezone: p.timezone,
      language: p.language,
      isServiceAreaBusiness: p.isServiceAreaBusiness,
      publicAddress: p.publicAddress || undefined,
      services: p.services.filter((x) => x.value.trim()),
      categories: p.categories.filter((x) => x.value.trim()),
      locations: p.locations.filter((l) => l.city.trim()),
      competitors: p.competitors.filter((c) => c.name.trim()),
      providerIds: p.providerIds,
      scanFrequency: p.scanFrequency,
      repetitions: p.repetitions,
      monthlyBudgetUsd: p.monthlyBudgetUsd,
      perScanBudgetUsd: p.perScanBudgetUsd,
      bilingualLanguage: p.bilingualLanguage || undefined,
    };
    const r = await callApi<AivProfileV1>(`${base}/profile`, "PUT", body);
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.error ?? "Save failed", problems: r.problems });
    setP(r.data!);
    setMsg({ kind: "ok", text: "Saved." });
    router.refresh();
  }

  async function setStatus(status: "active" | "paused") {
    setBusy(true);
    const r = await callApi(`${base}/profile/status`, "POST", { status });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.error ?? "Failed" });
    setMsg({ kind: "ok", text: status === "active" ? "Profile activated." : "Profile paused." });
    router.refresh();
  }

  async function suggest() {
    setBusy(true);
    setMsg(null);
    const r = await callApi<AivProfileV1>(`${base}/profile/suggest`, "POST", { url });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "error", text: `Website read failed: ${r.error}` });
    setP(r.data!);
    const s = r.raw?.suggestions as { names: unknown[]; services: unknown[]; locations: unknown[] } | undefined;
    setMsg({ kind: "ok", text: `Added suggestions (${s?.names.length ?? 0} names, ${s?.services.length ?? 0} services, ${s?.locations.length ?? 0} locations). Review each item — suggestions are not used until approved.` });
  }

  const updLoc = (i: number, patch: Partial<AivLocation>) => set("locations", p.locations.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const updComp = (i: number, patch: Partial<AivCompetitor>) => set("competitors", p.competitors.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Status: {p.status}</h2>
          <div className="toolbar">
            <button type="button" onClick={save} disabled={busy}>{busy ? "Working…" : "Save changes"}</button>
            {initial.status !== "active" ? (
              <button type="button" className="aiv-btn-ghost" onClick={() => setStatus("active")} disabled={busy || !check.ok} title={check.ok ? "" : "Resolve the problems listed first"}>
                Activate measurement
              </button>
            ) : (
              <button type="button" className="aiv-btn-ghost" onClick={() => setStatus("paused")} disabled={busy}>Pause</button>
            )}
          </div>
        </div>
        {check.problems.length ? <Msg msg={{ kind: "error", text: "Before activation:", problems: check.problems }} /> : null}
        {check.warnings.length ? (
          <ul className="aiv-ev" style={{ margin: "6px 0 0 16px" }}>
            {check.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}
        <Msg msg={msg} />
      </div>

      <section className="panel">
        <h2 className="panel-title">Suggest details from the website</h2>
        <p className="aiv-ev">Reads one public page (private/internal addresses are refused). Results are added as <strong>suggestions</strong> with the text they came from. Nothing is invented: licenses, ratings, insurance and addresses are never filled in automatically.</p>
        <div className="aiv-inline">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" aria-label="Website URL" />
          <button type="button" className="aiv-btn-ghost" onClick={suggest} disabled={busy || url.length < 4}>Suggest from website</button>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Business identity</h2>
        <div className="aiv-form-grid">
          <div>
            <label htmlFor="bn">Verified business name</label>
            <input id="bn" value={p.businessName} onChange={(e) => set("businessName", e.target.value)} />
          </div>
          <div>
            <label htmlFor="gbp">Google Business Profile URL (optional)</label>
            <input id="gbp" value={p.gbpUrl ?? ""} onChange={(e) => set("gbpUrl", e.target.value)} />
          </div>
          <div>
            <label htmlFor="pid">Place ID (optional)</label>
            <input id="pid" value={p.placeId ?? ""} onChange={(e) => set("placeId", e.target.value)} />
          </div>
        </div>
        <ReviewedList label="Approved aliases" items={p.aliases} onChange={(v) => set("aliases", v)} placeholder="e.g. Sparkle Pro" help="Other names the business is known by. Generic names (e.g. “Cleaning Services”) are ignored by detection." />
        <ReviewedList label="Owned domains" items={p.ownedDomains} onChange={(v) => set("ownedDomains", v)} placeholder="example.com" />
      </section>

      <section className="panel">
        <h2 className="panel-title">Location, language and service area</h2>
        <div className="aiv-form-grid">
          <div>
            <label htmlFor="tz">Timezone (IANA)</label>
            <input id="tz" value={p.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </div>
          <div>
            <label htmlFor="lang">Language</label>
            <input id="lang" value={p.language} onChange={(e) => set("language", e.target.value)} />
          </div>
          <div>
            <label htmlFor="prim">Primary location</label>
            <select id="prim" value={p.primaryLocationId ?? ""} onChange={(e) => set("primaryLocationId", e.target.value || undefined)}>
              <option value="">(first approved)</option>
              {p.locations.map((l) => (
                <option key={l.id} value={l.id}>{l.city}{l.region ? `, ${l.region}` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sab" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 26 }}>
              <input id="sab" type="checkbox" style={{ width: "auto" }} checked={p.isServiceAreaBusiness} onChange={(e) => set("isServiceAreaBusiness", e.target.checked)} />
              Service-area business
            </label>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="addr">Public address (only if the business shows it publicly)</label>
            <input id="addr" value={p.publicAddress ?? ""} onChange={(e) => set("publicAddress", e.target.value)} />
          </div>
        </div>
        <fieldset className="panel" style={{ margin: "10px 0" }}>
          <legend style={{ fontWeight: 600 }}>Target locations</legend>
          <ul className="aiv-list">
            {p.locations.map((l, i) => (
              <li key={l.id}>
                <input aria-label="City" value={l.city} onChange={(e) => updLoc(i, { city: e.target.value })} style={{ width: 160 }} />
                <input aria-label="State/region" value={l.region} onChange={(e) => updLoc(i, { region: e.target.value })} style={{ width: 70 }} />
                <input aria-label="Country (ISO-2)" value={l.country} maxLength={2} onChange={(e) => updLoc(i, { country: e.target.value.toUpperCase() })} style={{ width: 56 }} />
                <input aria-label="ZIP codes (comma separated)" placeholder="ZIPs" value={csv(l.zipCodes)} onChange={(e) => updLoc(i, { zipCodes: uncsv(e.target.value) })} style={{ width: 130 }} />
                <input aria-label="Neighborhoods (comma separated)" placeholder="Neighborhoods" className="grow" value={csv(l.neighborhoods)} onChange={(e) => updLoc(i, { neighborhoods: uncsv(e.target.value) })} />
                <StatusSelect id={`${l.id}-st`} value={l.status} onChange={(s) => updLoc(i, { status: s })} />
                {l.evidence ? <span className="aiv-ev">{SOURCE_LABEL[l.source]} · {l.evidence.slice(0, 80)}</span> : null}
                <button type="button" className="aiv-btn-ghost aiv-btn-sm" onClick={() => set("locations", p.locations.filter((_, j) => j !== i))}>Remove</button>
              </li>
            ))}
          </ul>
          <button type="button" className="aiv-btn-ghost aiv-btn-sm" style={{ marginTop: 8 }} onClick={() => set("locations", [...p.locations, { id: rid("loc"), city: "", region: "", country: "US", zipCodes: [], neighborhoods: [], status: "approved", source: "user" }])}>
            Add location
          </button>
        </fieldset>
      </section>

      <section className="panel">
        <h2 className="panel-title">Services and categories</h2>
        <ReviewedList label="Services" items={p.services} onChange={(v) => set("services", v)} placeholder="e.g. Move-out cleaning" help="Only approved services are used to generate prompts." />
        <ReviewedList label="Categories" items={p.categories} onChange={(v) => set("categories", v)} placeholder="e.g. House cleaning service" />
      </section>

      <section className="panel">
        <h2 className="panel-title">Known competitors</h2>
        <p className="aiv-ev">Used only to detect who appears in answers. Competitor names are never inserted into measurement prompts.</p>
        <ul className="aiv-list">
          {p.competitors.map((c, i) => (
            <li key={c.id}>
              <input aria-label="Competitor name" value={c.name} onChange={(e) => updComp(i, { name: e.target.value })} style={{ width: 200 }} />
              <input aria-label="Aliases (comma separated)" placeholder="Aliases" value={csv(c.aliases)} onChange={(e) => updComp(i, { aliases: uncsv(e.target.value) })} style={{ width: 180 }} />
              <input aria-label="Domains (comma separated)" placeholder="Domains" className="grow" value={csv(c.domains)} onChange={(e) => updComp(i, { domains: uncsv(e.target.value) })} />
              <StatusSelect id={`${c.id}-st`} value={c.status} onChange={(s) => updComp(i, { status: s })} />
              <button type="button" className="aiv-btn-ghost aiv-btn-sm" onClick={() => set("competitors", p.competitors.filter((_, j) => j !== i))}>Remove</button>
            </li>
          ))}
        </ul>
        <button type="button" className="aiv-btn-ghost aiv-btn-sm" style={{ marginTop: 8 }} onClick={() => set("competitors", [...p.competitors, { id: rid("cmp"), name: "", aliases: [], domains: [], status: "approved", source: "user" }])}>
          Add competitor
        </button>
      </section>

      <section className="panel">
        <h2 className="panel-title">Measurement settings</h2>
        <fieldset style={{ border: 0, padding: 0, margin: "0 0 10px" }}>
          <legend className="muted" style={{ fontSize: 13 }}>Providers</legend>
          {providers.map((pr) => (
            <label key={pr.providerId} style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--fg)" }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={p.providerIds.includes(pr.providerId)}
                disabled={!pr.ready && !p.providerIds.includes(pr.providerId)}
                onChange={(e) => set("providerIds", e.target.checked ? [...p.providerIds, pr.providerId] : p.providerIds.filter((x) => x !== pr.providerId))}
              />
              {pr.displayName} <span className={`aiv-pill ${pr.ready ? "aiv-pill--ok" : "aiv-pill--warn"}`}>{pr.ready ? "Ready" : pr.readyReason}</span>
            </label>
          ))}
        </fieldset>
        <div className="aiv-form-grid">
          <div>
            <label htmlFor="freq">Scan frequency</label>
            <select id="freq" value={p.scanFrequency} onChange={(e) => set("scanFrequency", e.target.value as AivProfileV1["scanFrequency"])}>
              <option value="manual">Manual only</option>
              <option value="weekly">Weekly (scheduled)</option>
              <option value="monthly">Monthly (scheduled)</option>
            </select>
          </div>
          <div>
            <label htmlFor="reps">Independent observations per prompt</label>
            <input id="reps" type="number" min={1} max={10} value={p.repetitions} onChange={(e) => set("repetitions", Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="scancap">Per-scan spending cap (USD)</label>
            <input id="scancap" type="number" min={0} step="0.5" value={p.perScanBudgetUsd} onChange={(e) => set("perScanBudgetUsd", Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="moncap">Monthly spending cap for this client (USD)</label>
            <input id="moncap" type="number" min={0} step="1" value={p.monthlyBudgetUsd} onChange={(e) => set("monthlyBudgetUsd", Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="bil">Bilingual prompts</label>
            <select id="bil" value={p.bilingualLanguage ?? ""} onChange={(e) => set("bilingualLanguage", e.target.value || undefined)}>
              <option value="">Off</option>
              <option value="es">Spanish</option>
            </select>
          </div>
        </div>
      </section>
      <div className="toolbar">
        <button type="button" onClick={save} disabled={busy}>{busy ? "Working…" : "Save changes"}</button>
      </div>
    </div>
  );
}
