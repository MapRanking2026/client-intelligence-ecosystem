"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type SearchItem = {
  href: string;
  label: string;
  description: string;
  keywords: string[];
};

const searchItems: SearchItem[] = [
  {
    href: "/command-center",
    label: "Command Center",
    description: "Open the daily operating view for priorities, alerts, and client readiness.",
    keywords: ["dashboard", "alerts", "command center", "overview", "priorities"],
  },
  {
    href: "/clients",
    label: "Clients",
    description: "Browse client records, health, relationship status, and strategic context.",
    keywords: ["clients", "accounts", "relationships", "health", "records"],
  },
  {
    href: "/monthly-touch",
    label: "Monthly Touches",
    description: "Open the Monthly Touch queue and meeting preparation workspaces.",
    keywords: ["monthly touch", "meetings", "prep", "queue", "touches"],
  },
  {
    href: "/commitments",
    label: "Commitments",
    description: "Review open client and internal commitments that still need follow-through.",
    keywords: ["commitments", "follow-up", "tasks", "actions", "owners"],
  },
  {
    href: "/opportunities",
    label: "Opportunities",
    description: "Inspect upsells, growth opportunities, and expansion signals.",
    keywords: ["opportunities", "upsells", "growth", "revenue", "expansion"],
  },
  {
    href: "/qa",
    label: "QA & Coaching",
    description: "Review quality scores, coaching history, and Monthly Touch evaluation results.",
    keywords: ["qa", "quality", "coaching", "review", "score", "evaluation"],
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Manage prompt engine settings, integrations, and administration controls.",
    keywords: ["settings", "prompt engine", "admin", "configuration", "integrations"],
  },
];

export function GlobalSearch() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      const usesModifier = isMac ? event.metaKey : event.ctrlKey;
      if (usesModifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        inputRef.current?.focus();
        setIsOpen(true);
      }

      if (event.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return searchItems.slice(0, 5);
    }

    return searchItems
      .filter((item) => {
        const haystack = [item.label, item.description, ...item.keywords].join(" ").toLowerCase();
        return haystack.includes(normalized);
      })
      .slice(0, 6);
  }, [query]);

  return (
    <div className="relative w-full max-w-[520px]">
      <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/25 px-4 py-3 shadow-[0_18px_40px_rgba(2,6,14,0.24)]">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => {
            setTimeout(() => setIsOpen(false), 120);
          }}
          placeholder="Search clients, Monthly Touches, commitments, QA, or settings"
          className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-400"
        />
        <span className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
          Ctrl/⌘ K
        </span>
      </div>

      {isOpen ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.6rem)] z-50 rounded-[24px] border border-white/10 bg-[#091320] p-3 shadow-[0_35px_100px_rgba(1,4,10,0.6)] backdrop-blur">
          {filteredItems.length ? (
            <div className="space-y-2">
              {filteredItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-2xl border border-white/8 bg-white/4 px-4 py-3 transition hover:border-white/16 hover:bg-white/8"
                >
                  <p className="text-sm font-semibold text-white">{item.label}</p>
                  <p className="mt-1 text-sm text-slate-400">{item.description}</p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/8 bg-white/4 px-4 py-4 text-sm text-slate-300">
              No matching workspace found yet.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
