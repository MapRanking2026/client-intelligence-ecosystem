import Link from "next/link";
import { Settings, Plug, Sparkles, BookOpen, Users, Flag, FileText, Shield, ArrowUpRight, Palette } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";

interface AdminCard {
  title: string;
  description: string;
  href?: string;
  icon: LucideIcon;
  live?: boolean;
}

const ADMIN_CARDS: AdminCard[] = [
  {
    title: "Integrations",
    description: "OAuth, API credentials, and token-refresh flows for ClickUp, GoHighLevel, and Google — in one managed workspace.",
    href: "/settings/integrations",
    icon: Plug,
    live: true,
  },
  {
    title: "Prompt Engine",
    description: "The single source of truth for every AI workflow. Edit, version, test, and roll back the prompts that drive MTOS.",
    href: "/settings/prompt-engine",
    icon: Sparkles,
    live: true,
  },
  {
    title: "Knowledge base",
    description: "Ground the AI in Map Ranking's playbooks, SOPs, and past monthly touches — retrieved into prep automatically.",
    href: "/settings/knowledge",
    icon: BookOpen,
    live: true,
  },
  {
    title: "Report branding",
    description: "Your logo, brand color, and font for every generated client report — or seed it from an existing sample report. Per-tenant, so each company's reports look like their own.",
    href: "/settings/report-brand",
    icon: Palette,
    live: true,
  },
  { title: "Users & roles", description: "Control workspace access, ownership, and role visibility for account teams.", icon: Users },
  { title: "Feature flags", description: "Stage operational changes safely before they reach front-line workflows.", icon: Flag },
  { title: "Audit logs", description: "Track admin changes, approvals, and operational decisions in one place.", icon: FileText },
  { title: "Security & sessions", description: "Session controls, credential safety, and account protections.", icon: Shield },
];

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <div className="eyebrow muted">
            <Settings />
            <span>Administration</span>
          </div>
          <h2 className="h2 mt-2">Settings</h2>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ADMIN_CARDS.map((c) => {
          const Icon = c.icon;
          const inner = (
            <>
              <div className="flex items-start justify-between gap-3">
                <span
                  className="grid h-10 w-10 place-items-center rounded-[11px]"
                  style={{
                    background: c.live ? "var(--accent-soft)" : "var(--surface-2)",
                    color: c.live ? "var(--accent)" : "var(--slate-400)",
                  }}
                >
                  <Icon style={{ width: 19, height: 19 }} />
                </span>
                {c.live ? (
                  <span className="chip good">
                    <span className="sig-dot good" />
                    Live
                  </span>
                ) : (
                  <span className="chip">Staged</span>
                )}
              </div>
              <div className="h4 mt-3.5 flex items-center gap-1.5">
                {c.title}
                {c.href ? <ArrowUpRight style={{ width: 15, height: 15, color: "var(--slate-400)" }} /> : null}
              </div>
              <p className="muted mt-1.5 text-[0.85rem] leading-6">{c.description}</p>
            </>
          );
          return c.href ? (
            <Link key={c.title} href={c.href} className="card is-hover" style={{ minHeight: 168 }}>
              {inner}
            </Link>
          ) : (
            <div key={c.title} className="card" style={{ minHeight: 168, opacity: 0.72 }}>
              {inner}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
