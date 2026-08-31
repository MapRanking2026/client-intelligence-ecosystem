"use client";

import { useEffect, useState, type ReactNode } from "react";
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
  Menu,
} from "lucide-react";

import { cn } from "@/src/lib/utils";
import { BrandMark } from "@/src/components/mtos/brand-mark";
import { ThemeToggle } from "@/src/components/mtos/theme-toggle";
import { AnnotationsToggle } from "@/src/components/mtos/annotations-toggle";
import { NotificationsBell, type AppNotification } from "@/src/components/mtos/notifications-bell";

const NOTIFICATIONS: AppNotification[] = [
  { id: "n1", tone: "important", title: "Monthly Touches this week", detail: "Review and prep the upcoming touches", href: "/monthly-touch" },
  { id: "n2", tone: "critical", title: "Commitments need a look", detail: "Check for anything overdue", href: "/commitments" },
  { id: "n3", tone: "info", title: "Opportunities in the pipeline", detail: "New items ready to review", href: "/opportunities" },
];

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

interface CurrentUser {
  name: string;
  roleLabel: string;
}

/** Initials for the avatar: first letter of the first two words, else first two letters. */
function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return (words[0] || "").slice(0, 2).toUpperCase() || "AM";
}

export function AppChrome({ title, subtitle, children }: AppChromeProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/me", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active && payload?.data) {
          setCurrentUser({ name: payload.data.name, roleLabel: payload.data.roleLabel });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const userName = currentUser?.name || "Account Manager";
  const userRole = currentUser?.roleLabel || "Account Manager";

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
            <div className="avatar">{getInitials(userName)}</div>
            <div className="min-w-0">
              <div className="nm">{userName}</div>
              <div className="rl">{userRole}</div>
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
            <AnnotationsToggle />
            <ThemeToggle />
            <NotificationsBell items={NOTIFICATIONS} />
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
