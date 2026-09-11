"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Persistent banner shown while the super-admin is viewing as a specialist. */
export function ImpersonationBanner({ name }: { name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function stop() {
    setBusy(true);
    try {
      await fetch("/api/seo/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stop: true }),
      });
      router.push("/team");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="impersonation-banner">
      <span>👁️ Viewing as <strong>{name}</strong> — this is what they see when they log in.</span>
      <button type="button" onClick={stop} disabled={busy}>{busy ? "Stopping…" : "Stop impersonating"}</button>
    </div>
  );
}
