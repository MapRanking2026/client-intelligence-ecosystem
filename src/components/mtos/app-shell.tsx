import type { ReactNode } from "react";
import { Bell, Search, Sparkles } from "lucide-react";
import Link from "next/link";

import { SidebarNav } from "@/src/components/mtos/sidebar-nav";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getUserGreeting } from "@/src/lib/server/services/user-service";

interface AppShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export async function AppShell({ title, subtitle, children }: AppShellProps) {
  const context = await resolveTenantContext();
  const greeting = await getUserGreeting(context);
  const globalSearchTargets = [
    { href: "/clients", label: "Find a client record" },
    { href: "/monthly-touch", label: "Open a Monthly Touch workspace" },
    { href: "/commitments", label: "Review open commitments" },
    { href: "/opportunities", label: "Inspect growth opportunities" },
  ];
  const actionableAlerts = [
    { href: "/monthly-touch", label: "3 Monthly Touches need prep refresh" },
    { href: "/qa", label: "QA queue ready for coaching review" },
    { href: "/commitments", label: "Client commitments need owner confirmation" },
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#223554_0%,#08111e_34%,#050a12_100%)] text-slate-100">
      <div className="mx-auto grid min-h-screen max-w-[1700px] gap-6 p-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="xl:sticky xl:top-5 xl:h-[calc(100vh-2.5rem)]">
          <SidebarNav />
        </div>
        <main className="space-y-6 rounded-[36px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,13,23,0.88),rgba(6,10,18,0.94))] p-5 shadow-[0_60px_140px_rgba(3,6,14,0.5)] md:p-7">
          <header className="flex flex-col gap-5 rounded-[28px] border border-white/8 bg-white/5 p-5 md:flex-row md:items-center md:justify-between md:p-6">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Account manager operating workspace
              </p>
              <div className="space-y-2">
                <h1 className="font-serif text-3xl tracking-tight text-white md:text-4xl">
                  {title}
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-slate-300 md:text-base">
                  {subtitle}
                </p>
              </div>
            </div>
            <div className="grid gap-3 md:min-w-[420px]">
              <div className="text-sm font-semibold text-slate-200">{greeting.label}</div>
              <details className="group rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  <Search className="h-4 w-4 text-slate-400" />
                  <span className="text-sm text-slate-300">
                    Search clients, Monthly Touches, risks, commitments, or ask AI
                  </span>
                </summary>
                <div className="mt-3 grid gap-2">
                  {globalSearchTargets.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="rounded-2xl border border-white/8 bg-white/4 px-3 py-2 text-sm text-slate-200 transition hover:border-white/16 hover:bg-white/8"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </details>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  <Sparkles className="h-4 w-4" />
                  Evidence-first AI active
                </div>
                <details className="group rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200">
                  <summary className="flex cursor-pointer list-none items-center gap-2">
                    <Bell className="h-4 w-4" />
                    3 actionable alerts
                  </summary>
                  <div className="mt-3 grid min-w-[280px] gap-2">
                    {actionableAlerts.map((alert) => (
                      <Link
                        key={alert.label}
                        href={alert.href}
                        className="rounded-2xl border border-white/8 bg-[#d7f5ec] px-3 py-2 text-sm font-medium text-[#223554] transition hover:bg-white"
                      >
                        {alert.label}
                      </Link>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
