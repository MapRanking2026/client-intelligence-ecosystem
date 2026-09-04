"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

export interface AppNotification {
  id: string;
  tone: "critical" | "important" | "positive" | "info";
  title: string;
  detail?: string;
  href?: string;
}

const DOT: Record<AppNotification["tone"], string> = {
  critical: "risk",
  important: "watch",
  positive: "good",
  info: "",
};

export function NotificationsBell({ items = [] }: { items?: AppNotification[] }) {
  const [open, setOpen] = useState(false);
  const [ring, setRing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = items.length;

  // Swing once on mount when there's something to see.
  useEffect(() => {
    if (unread > 0) {
      setRing(true);
      const t = setTimeout(() => setRing(false), 1000);
      return () => clearTimeout(t);
    }
  }, [unread]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="bell-wrap" ref={ref}>
      <button
        className="icon-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        title="Notifications"
        type="button"
      >
        <span className={ring ? "bell-ring" : ""} style={{ display: "inline-flex" }}>
          <Bell />
        </span>
        {unread > 0 ? <span className="bell-dot" /> : null}
      </button>

      {open ? (
        <div className="notif-panel">
          <div style={{ padding: "12px 14px", fontWeight: 700, fontSize: "0.82rem", color: "var(--text)" }}>
            Notifications
          </div>
          {items.length === 0 ? (
            <div className="notif-item muted" style={{ fontSize: "0.84rem" }}>
              You&apos;re all caught up.
            </div>
          ) : (
            items.map((n) => {
              const dot = DOT[n.tone];
              const inner = (
                <>
                  <span className={`sig-dot ${dot}`} style={{ marginTop: 6, background: n.tone === "info" ? "var(--info)" : undefined }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.84rem", fontWeight: 600, color: "var(--text)" }}>{n.title}</div>
                    {n.detail ? <div className="muted" style={{ fontSize: "0.76rem" }}>{n.detail}</div> : null}
                  </div>
                </>
              );
              return n.href ? (
                <Link key={n.id} href={n.href} className="notif-item" onClick={() => setOpen(false)}>
                  {inner}
                </Link>
              ) : (
                <div key={n.id} className="notif-item">
                  {inner}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
