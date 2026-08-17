"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  CalendarRange,
  Phone,
  BadgeCheck,
  BriefcaseBusiness,
  ClipboardCheck,
  Settings,
  Search,
  Bell,
  Menu,
} from "lucide-react";

import { cn } from "@/src/lib/utils";
import { BrandMark } from "@/src/components/mtos/brand-mark";
import { ThemeToggle } from "@/src/components/mtos/theme-toggle";

const NAV = [
  { href: "/command-center", label: "Command Center", icon: LayoutDashboard },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/monthly-touch", label: "Monthly Touches", icon: CalendarRange },
  { href: "/calls", label: "Call Intelligence", icon: Phone },
  { href: "/commitments", label: "Commitments", icon: BadgeCheck },
  { href: "/opportunities", label: "Opportunities", icon: BriefcaseBusiness },
  { href: "/qa", label: "QA & Coaching", icon: ClipboardCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface AppChromeProps {
  greeting?: string;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}

export function AppChrome({ title, subtitle, children }: AppChromeProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="shell">
      <aside className={cn("sidebar", open && "open")}>
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">MTOS</div>
            <div className="brand-sub">Monthly Touch OS</div>
          </div>
        </div>
        <div className="nav-label">Workspace</div>
        <nav className="flex flex-col gap-[3px]">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn("nav-item", active && "active")}
                onClick={() => setOpen(false)}
              >
                <Icon />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="avatar">AM</div>
            <div className="min-w-0">
              <div className="nm">Account Manager</div>
              <div className="rl">Map Ranking</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="main-scroll">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setOpen(true)} aria-label="Open menu" type="button">
            <Menu />
          </button>
          <div className="search">
            <Search />
            <span>Search clients, commitments, opportunities…</span>
            <span className="kbd">⌘K</span>
          </div>
          <div className="top-actions">
            <div className="pill-live">
              <span className="live-dot" />
              Evidence-first AI active
            </div>
            <ThemeToggle />
            <button className="icon-btn" aria-label="Notifications" type="button">
              <Bell />
              <span className="badge" />
            </button>
          </div>
        </header>

        <div className="page">
          {title ? (
            <div className="mb-6">
              <h1 className="h1">{title}</h1>
              {subtitle ? <p className="lead mt-3 max-w-3xl">{subtitle}</p> : null}
            </div>
          ) : null}
          {children}
        </div>
      </div>

      <div className={cn("scrim", open && "on")} onClick={() => setOpen(false)} />
    </div>
  );
}
