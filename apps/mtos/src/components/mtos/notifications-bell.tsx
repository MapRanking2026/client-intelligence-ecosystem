"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Mail, MailX } from "lucide-react";

import type { NotificationRecord } from "@/src/lib/contracts/notifications";
import { unreadCount } from "@/src/lib/contracts/notifications";

/**
 * The bell, now reading the AM's real feed.
 *
 * It used to render three hard-coded rows that said the same thing on every screen for every user.
 * The rows now come from `/api/notifications`, written by the hourly run from this AM's own
 * touches, briefs and Intercom threads.
 *
 * Opening the panel marks what is in it as read, which is the behaviour people expect from a bell
 * and is also what stops the same overdue follow-through counting as unread every day. A row that
 * could not be emailed says so on its own line rather than looking like one that was.
 */

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

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [ring, setRing] = useState(false);
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = unreadCount(items);

  useEffect(() => {
    let active = true;
    fetch("/api/notifications", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!active) return;
        setItems((payload?.data?.items || []) as NotificationRecord[]);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Swing once when something arrives unread.
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

  /*
    Marked read when the panel opens, optimistically.

    The row is dimmed here and the write is sent after. If the write fails the AM sees the row as
    read until the next load brings it back unread, which is the right way round: a bell that
    refuses to clear is more annoying than one that clears a moment early.
  */
  const markRead = useCallback(async (unreadIds: string[]) => {
    if (!unreadIds.length) return;
    const at = new Date().toISOString();
    setItems((previous) =>
      previous.map((item) => (unreadIds.includes(item.id) ? { ...item, readAt: item.readAt || at } : item)),
    );
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ read: unreadIds }),
      });
    } catch {
      // Nothing to tell the AM: the next load reports the true state.
    }
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void markRead(items.filter((item) => !item.readAt).map((item) => item.id));
  }

  return (
    <div className="bell-wrap" ref={ref}>
      <button
        className="icon-btn"
        onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
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
          {!items.length ? (
            <div className="notif-item muted" style={{ fontSize: "0.84rem" }}>
              {loaded ? "You're all caught up." : "Loading…"}
            </div>
          ) : (
            items.map((n) => {
              const dot = DOT[n.tone];
              const inner = (
                <>
                  <span
                    className={`sig-dot ${dot}`}
                    style={{ marginTop: 6, background: n.tone === "info" ? "var(--info)" : undefined }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.84rem", fontWeight: 600, color: "var(--text)" }}>{n.title}</div>
                    {n.detail ? <div className="muted" style={{ fontSize: "0.76rem" }}>{n.detail}</div> : null}
                    {n.emailedAt ? (
                      <div className="muted flex items-center gap-1" style={{ fontSize: "0.72rem" }}>
                        <Mail style={{ width: 12, height: 12 }} />
                        Emailed to you
                      </div>
                    ) : n.emailSkippedReason ? (
                      <div className="flex items-start gap-1" style={{ fontSize: "0.72rem", color: "var(--watch)" }}>
                        <MailX style={{ width: 12, height: 12, marginTop: 2, flexShrink: 0 }} />
                        {n.emailSkippedReason}
                      </div>
                    ) : null}
                  </div>
                </>
              );
              const style = n.readAt ? { opacity: 0.62 } : undefined;
              return n.href ? (
                <Link key={n.id} href={n.href} className="notif-item" style={style} onClick={() => setOpen(false)}>
                  {inner}
                </Link>
              ) : (
                <div key={n.id} className="notif-item" style={style}>
                  {inner}
                </div>
              );
            })
          )}
          <Link
            href="/settings/preferences"
            className="notif-item muted"
            style={{ fontSize: "0.76rem" }}
            onClick={() => setOpen(false)}
          >
            Choose what you hear about in Settings
          </Link>
        </div>
      ) : null}
    </div>
  );
}
