"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { IntegrationField } from "@/src/lib/domain/integration";

interface View {
  id: string;
  name: string;
  category: string;
  authMode: "api_key" | "oauth";
  connectable: boolean;
  poweredBy?: string;
  syncable: boolean;
  description: string;
  fields: IntegrationField[];
  status: "not_connected" | "connected" | "error";
  connectedAt?: string;
  metadata: Record<string, string>;
  oauthStartPath?: string;
  oauthUnconfigured?: boolean;
}

export function IntegrationCard({ view }: { view: View }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/seo/integrations/${view.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setMessage((body && body.error) || "Connect failed");
      else {
        setMessage(body?.data?.note || "Connected.");
        setValues({});
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/seo/integrations/${view.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3 className="panel-title">{view.name}</h3>
        <span className={`badge status-${view.status === "connected" ? "active" : view.status}`}>
          {view.status.replace(/_/g, " ")}
        </span>
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{view.description}</p>

      {view.poweredBy ? (
        <p className="muted" style={{ fontSize: 12 }}>
          {view.status === "connected" ? (
            <>Connected via the <strong>{view.poweredBy}</strong> connection.</>
          ) : (
            <>Powered by the <strong>{view.poweredBy}</strong> connection — connect that provider.</>
          )}
        </p>
      ) : view.status === "connected" ? (
        <div className="toolbar">
          <span className="muted" style={{ fontSize: 12 }}>
            Connected{view.connectedAt ? ` ${view.connectedAt.slice(0, 10)}` : ""}
            {view.syncable ? " · syncable" : ""}
          </span>
          <button type="button" onClick={disconnect} disabled={busy}
            style={{ background: "transparent", color: "var(--danger)", border: "1px solid var(--border)" }}>
            Disconnect
          </button>
        </div>
      ) : view.oauthStartPath ? (
        <div className="toolbar">
          <a href={view.oauthStartPath}>
            <button type="button">Connect with Google</button>
          </a>
          <span className="muted" style={{ fontSize: 12 }}>Grants read access; offline token stored encrypted.</span>
        </div>
      ) : view.oauthUnconfigured ? (
        <p className="muted" style={{ fontSize: 12 }}>
          Requires the Google OAuth app — set <strong>GOOGLE_OAUTH_CLIENT_ID</strong> and{" "}
          <strong>GOOGLE_OAUTH_CLIENT_SECRET</strong>.
        </p>
      ) : !view.connectable ? (
        <p className="muted" style={{ fontSize: 12 }}>
          Requires OAuth — connect form coming.
        </p>
      ) : (
        <form onSubmit={connect}>
          {view.fields.map((f) => (
            <div key={f.key} style={{ marginBottom: 8 }}>
              <label htmlFor={`${view.id}-${f.key}`}>{f.label}{f.required ? " *" : ""}</label>
              <input
                id={`${view.id}-${f.key}`}
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="toolbar" style={{ marginTop: 4 }}>
            <button type="submit" disabled={busy}>{busy ? "Connecting…" : "Connect"}</button>
            {message ? <span className="muted" style={{ fontSize: 12 }}>{message}</span> : null}
          </div>
        </form>
      )}
      {view.status === "connected" && message ? <p className="muted" style={{ fontSize: 12 }}>{message}</p> : null}
    </div>
  );
}
