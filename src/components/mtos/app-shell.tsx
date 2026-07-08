import type { ReactNode } from "react";
import { Bell, Search, Sparkles } from "lucide-react";

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
            <div className="grid gap-3 md:min-w-[360px]">
              <div className="text-sm font-semibold text-slate-200">{greeting.label}</div>
              <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                <Search className="h-4 w-4 text-slate-400" />
                <span className="text-sm text-slate-400">
                  Search clients, Monthly Touches, risks, commitments, or ask AI
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  <Sparkles className="h-4 w-4" />
                  Evidence-first AI active
                </div>
                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200">
                  <Bell className="h-4 w-4" />
                  3 actionable alerts
                </div>
              </div>
            </div>
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
