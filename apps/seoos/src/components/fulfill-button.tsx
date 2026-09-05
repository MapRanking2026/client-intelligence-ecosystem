"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function FulfillButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function fulfill() {
    setBusy(true);
    try {
      const res = await fetch(`/api/seo/requests/${requestId}/fulfill`, { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={fulfill} disabled={busy} style={{ padding: "4px 10px", fontSize: 12 }}>
      {busy ? "…" : "Fulfill"}
    </button>
  );
}
