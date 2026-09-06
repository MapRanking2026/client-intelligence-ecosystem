"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateProjectForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [website, setWebsite] = useState("");
  const [valueProposition, setValueProposition] = useState("");
  const [niche, setNiche] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/seo/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          businessName,
          website: website || undefined,
          valueProposition: valueProposition || undefined,
          niche: niche || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body?.error ?? "Failed to create project");
      } else {
        setMessage("Project created.");
        setClientId("");
        setBusinessName("");
        setWebsite("");
        setValueProposition("");
        setNiche("");
        setOpen(false);
        router.refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="toolbar">
        <button type="button" onClick={() => setOpen(true)}>+ New SEO project</button>
        {message ? <span className="muted">{message}</span> : null}
      </div>
    );
  }

  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-head">
        <h2 className="panel-title">New SEO project</h2>
        <button type="button" onClick={() => setOpen(false)} style={{ background: "transparent", color: "var(--muted)" }}>
          cancel
        </button>
      </div>
      <div className="row">
        <div>
          <label htmlFor="clientId">Canonical client ID</label>
          <input id="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="client-acme" required />
        </div>
        <div>
          <label htmlFor="businessName">Business name</label>
          <input id="businessName" value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label htmlFor="website">Website (optional)</label>
        <input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <div>
          <label htmlFor="niche">Niche (optional)</label>
          <input id="niche" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="e.g. Roofing, HVAC, Plumbing" />
        </div>
        <div>
          <label htmlFor="valueProposition">Value proposition (optional)</label>
          <input
            id="valueProposition"
            value={valueProposition}
            onChange={(e) => setValueProposition(e.target.value)}
            placeholder="What makes this business win locally"
          />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Niche + value proposition ground the AI recommendations (learns from similar niches / case studies).
      </p>
      <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create project"}</button>
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </form>
  );
}
