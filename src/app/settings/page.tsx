import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { SectionCard } from "@/src/components/mtos/section-card";
import { PromptManager } from "@/src/components/mtos/prompt-manager";

export default function SettingsPage() {
  return (
    <AppShell
      title="Administration"
      subtitle="Administration should remain powerful but understandable, keeping permissions, AI controls, integrations, and governance in one calm workspace."
    >
      <SectionCard
        eyebrow="Platform services"
        title="Administration surface"
        subtitle="Administration now includes a live integrations workspace, while the rest of the settings surface remains staged for the next slices."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Link
            href="/settings/integrations"
            className="rounded-[24px] border border-[#d7f5ec]/20 bg-[linear-gradient(180deg,rgba(215,245,236,0.14),rgba(255,255,255,0.04))] p-5 transition hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-white">Integration health and reconnect flows</p>
                <p className="text-sm leading-6 text-slate-300">
                  OAuth, API credentials, and rotating token endpoints now live in one managed workspace.
                </p>
              </div>
              <ArrowUpRight className="mt-1 h-4 w-4 text-slate-300" />
            </div>
          </Link>

          {[
            "Users and role assignments",
            "Prompt and AI configuration",
            "Feature flags and release controls",
            "Audit logs and compliance settings",
            "Security and session governance",
          ].map((item) => (
            <div key={item} className="rounded-[24px] border border-white/8 bg-white/4 p-5 text-sm text-slate-200">
              {item === "Prompt and AI configuration" ? (
                <div>
                  <div className="mb-3 text-sm font-semibold text-white">Prompt and AI configuration</div>
                  <PromptManager />
                </div>
              ) : (
                item
              )}
            </div>
          ))}
        </div>
      </SectionCard>
    </AppShell>
  );
}
