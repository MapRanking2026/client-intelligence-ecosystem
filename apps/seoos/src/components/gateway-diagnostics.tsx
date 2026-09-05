"use client";

import { useState } from "react";

interface Diag {
  configured: boolean;
  gatewayUrl: string;
  localFingerprint: string;
  ok: boolean;
  status?: number;
  reason?: string;
  mtosFingerprint?: string;
  secretsMatch?: boolean;
  error?: string;
}

export function GatewayDiagnostics() {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [busy, setBusy] = useState(false);

  async function test() {
    setBusy(true);
    try {
      const res = await fetch("/api/seo/integrations/gateway-test");
      const body = await res.json().catch(() => null);
      setDiag(body?.data ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">MTOS gateway diagnostics</h2>
        <button type="button" onClick={test} disabled={busy}>{busy ? "Testing…" : "Test gateway"}</button>
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Verifies the signed connection to MTOS and compares the secret fingerprint
        on each side (a fingerprint reveals nothing about the secret itself).
      </p>
      {diag ? (
        <div>
          <div className="toolbar">
            <span className="muted" style={{ fontSize: 12 }}>Gateway URL:</span>
            <code>{diag.gatewayUrl}</code>
          </div>
          {!diag.configured ? (
            <p className="muted">Not configured — set MTOS_GATEWAY_URL + CIE_SERVICE_SECRET.</p>
          ) : diag.ok ? (
            <p><span className="badge status-active">Connected</span> Gateway responded OK.</p>
          ) : (
            <>
              <p>
                <span className="badge badge--warn">Failed</span>{" "}
                {diag.status ? `HTTP ${diag.status}` : ""} {diag.reason ? `· ${diag.reason}` : ""} {diag.error ?? ""}
              </p>
              <div className="table-scroll">
                <table className="data">
                  <tbody>
                    <tr><td>SEOOS secret fingerprint</td><td><code>{diag.localFingerprint}</code></td></tr>
                    <tr><td>MTOS secret fingerprint</td><td><code>{diag.mtosFingerprint ?? "—"}</code></td></tr>
                    <tr>
                      <td>Secrets match?</td>
                      <td>
                        {diag.mtosFingerprint == null ? (
                          <span className="muted">unknown</span>
                        ) : diag.secretsMatch ? (
                          <span className="badge status-active">yes</span>
                        ) : (
                          <span className="badge badge--warn">NO — set the same CIE_SERVICE_SECRET on both, then redeploy both</span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
