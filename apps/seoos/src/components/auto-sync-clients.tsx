"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Invisible: when a user opens their Clients page, pull the latest client roster
 * from ClickUp so their clients are always current — no manual "Sync" needed.
 * The endpoint is throttled, so this is a cheap no-op if a sync ran recently.
 * Refreshes the page only when a sync actually happened.
 */
export function AutoSyncClients() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    let active = true;
    fetch("/api/seo/projects/auto-sync", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (active && body?.data?.synced) router.refresh();
      })
      .catch(() => {
        // Best-effort — a failed auto-sync never blocks the page.
      });
    return () => {
      active = false;
    };
  }, [router]);

  return null;
}
