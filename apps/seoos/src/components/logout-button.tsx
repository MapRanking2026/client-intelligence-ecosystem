"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Clears the SEOOS session cookie and returns to the sign-in screen. */
export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Even if the request fails, send them to sign-in.
    }
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={logout}
      disabled={busy}
      title="Log out"
      aria-label="Log out"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
      </svg>
    </button>
  );
}
