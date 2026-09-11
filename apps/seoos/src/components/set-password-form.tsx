"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/** Force-set a new password (used after an admin flags an account for reset). */
export function SetPasswordForm() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) return setError("Password must be at least 8 characters.");
    if (pw !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: pw }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError((body && body.error) || "Could not set password");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not set password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit} style={{ maxWidth: 400, width: "100%" }}>
      <h2 className="panel-title" style={{ marginTop: 0 }}>Set a new password</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        You&apos;re required to choose a new password before continuing.
      </p>
      <label htmlFor="pw" style={{ marginTop: 10 }}>New password</label>
      <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" minLength={8} required />
      <label htmlFor="confirm" style={{ marginTop: 10 }}>Confirm password</label>
      <input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required />
      <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Set password"}</button>
        {error ? <span style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span> : null}
      </div>
    </form>
  );
}
