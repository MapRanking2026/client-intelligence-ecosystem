"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

type Mode = "signin" | "signup";

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const url = mode === "signin" ? "/api/auth/login" : "/api/auth/signup";
      const payload =
        mode === "signin"
          ? { email, password }
          : { email, password, displayName: displayName || undefined, code: code || undefined };
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError((body && body.error) || (mode === "signin" ? "Sign-in failed" : "Sign-up failed"));
        return;
      }
      if (mode === "signup" && body?.firstUser) {
        setNotice("Admin account created — signing you in…");
      }
      const next = params.get("next") || "/";
      router.push(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch {
      setError(mode === "signin" ? "Sign-in failed" : "Sign-up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit} style={{ maxWidth: 400 }}>
      <div className="toolbar" style={{ marginBottom: 12 }} role="tablist" aria-label="Auth mode">
        <button type="button" onClick={() => setMode("signin")}
          style={mode === "signin" ? {} : ghost} aria-selected={mode === "signin"}>Sign in</button>
        <button type="button" onClick={() => setMode("signup")}
          style={mode === "signup" ? {} : ghost} aria-selected={mode === "signup"}>Create account</button>
      </div>

      {mode === "signup" ? (
        <>
          <label htmlFor="displayName">Name</label>
          <input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
        </>
      ) : null}

      <label htmlFor="email" style={{ marginTop: mode === "signup" ? 10 : 0 }}>Email</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />

      <label htmlFor="password" style={{ marginTop: 10 }}>Password</label>
      <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        autoComplete={mode === "signin" ? "current-password" : "new-password"} required
        minLength={mode === "signup" ? 8 : undefined} />
      {mode === "signup" ? <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>At least 8 characters.</p> : null}

      {mode === "signup" ? (
        <>
          <label htmlFor="code" style={{ marginTop: 10 }}>Sign-up code (if required)</label>
          <input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Leave blank if none" />
        </>
      ) : null}

      <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <button type="submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
        {error ? <span style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span> : null}
        {notice ? <span className="muted" style={{ fontSize: 13 }}>{notice}</span> : null}
      </div>
      {mode === "signup" ? (
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          The first account for this workspace becomes the admin.
        </p>
      ) : null}
    </form>
  );
}

const ghost = {
  background: "transparent",
  color: "var(--muted)",
  border: "1px solid var(--border)",
} as const;
