"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarRange,
  ClipboardCheck,
  Command,
  LayoutDashboard,
  Settings,
  Sparkles,
} from "lucide-react";

import { cn } from "@/src/lib/utils";

const navItems = [
  { href: "/command-center", label: "Command Center", icon: LayoutDashboard },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/monthly-touch", label: "Monthly Touches", icon: CalendarRange },
  { href: "/commitments", label: "Commitments", icon: BadgeCheck },
  { href: "/opportunities", label: "Opportunities", icon: BriefcaseBusiness },
  { href: "/qa", label: "QA", icon: ClipboardCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav() {
  const pathname = usePathname();
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const modifierLabel = useMemo(() => {
    if (typeof navigator === "undefined") {
      return "Ctrl";
    }

    return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘" : "Ctrl";
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      const usesModifier = isMac ? event.metaKey : event.ctrlKey;
      if (usesModifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsPaletteOpen((current) => !current);
      }

      if (event.key === "Escape") {
        setIsPaletteOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const quickActions = [
    { href: "/command-center", label: "Open Command Center" },
    { href: "/monthly-touch", label: "Jump to Monthly Touch queue" },
    { href: "/qa", label: "Review QA and coaching" },
    { href: "/settings", label: "Open prompt engine settings" },
  ];

  return (
    <aside className="flex h-full w-full flex-col justify-between rounded-[32px] border border-white/10 bg-[#0b1321]/90 p-5 shadow-[0_35px_80px_rgba(3,7,18,0.55)]">
      <div className="space-y-6">
        <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-white/10 p-3">
              <Sparkles className="h-5 w-5 text-[#d7f5ec]" />
            </div>
            <div>
              <p className="font-medium text-white">Monthly Touch OS</p>
              <p className="text-sm text-slate-400">AI operating system for Monthly Touches</p>
            </div>
          </div>
        </div>

        <nav className="space-y-2">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const activeStyle = active ? { color: "#0c1524" } : undefined;
            return (
              <Link
                key={href}
                href={href}
                style={activeStyle}
                className={cn(
                  "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition-all",
                  active
                    ? "bg-white text-[#0c1524] shadow-lg shadow-white/10"
                    : "text-slate-300 hover:bg-white/7 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="font-medium">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
        <button
          type="button"
          onClick={() => setIsPaletteOpen((current) => !current)}
          className="flex w-full items-center gap-3 rounded-2xl text-left"
        >
          <div className="rounded-2xl bg-[#d7f5ec] p-3 text-slate-950">
            <Command className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-white">AI Command Palette</p>
              <span className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[10px] font-semibold text-[#d7f5ec]">
                {modifierLabel} K
              </span>
            </div>
            <p className="text-xs text-slate-400">Search clients, commitments, and live actions</p>
          </div>
        </button>
        {isPaletteOpen ? (
          <div className="mt-4 space-y-2">
            {quickActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                onClick={() => setIsPaletteOpen(false)}
                className="block rounded-2xl border border-white/8 bg-white/4 px-3 py-2 text-sm text-slate-200 transition hover:border-white/16 hover:bg-white/8"
              >
                {action.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
