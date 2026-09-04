"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const STATUSES = [
  "unverified",
  "needs_review",
  "verified_good_lead",
  "verified_bad_lead",
  "spam",
  "duplicate",
] as const;

export function VerifyControl({
  recordId,
  current,
}: {
  recordId: string;
  current: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    if (next === value) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/seo/lead-verification/${recordId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verificationStatus: next, reason: "Updated in SEOOS" }),
      });
      if (res.ok) {
        setValue(next);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      aria-label="Verification status"
      value={value}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      style={{ maxWidth: 200 }}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}
