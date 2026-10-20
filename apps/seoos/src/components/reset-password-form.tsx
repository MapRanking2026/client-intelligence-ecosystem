"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

export function ResetPasswordForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") || "");
  const [token] = useState(params.get("token") || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, token, newPassword: password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError((body && body.error) || "Could not reset password");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reset password");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="panel">
        <p style={{ marginTop: 0 }}>This reset link is missing a token.</p>
        <Link href="/sign-in">Back to sign in</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="panel">
        <p style={{ marginTop: 0 }}>Your password has been reset.</p>
        <Link href="/sign-in">Sign in with your new password</Link>
      </div>
    );
  }

  return (
    <form className="panel" onSubmit={submit} style={{ maxWidth: 400 }}>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />

      <label htmlFor="newPassword" style={{ marginTop: 10 }}>New password</label>
      <input
        id="newPassword"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        minLength={8}
        required
      />
      <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>At least 8 characters.</p>

      <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <button type="submit" disabled={busy}>{busy ? "Resetting…" : "Reset password"}</button>
        {error ? <span style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span> : null}
      </div>
    </form>
  );
}
