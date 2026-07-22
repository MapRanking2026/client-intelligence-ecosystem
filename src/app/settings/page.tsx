import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { SectionCard } from "@/src/components/mtos/section-card";

export default function SettingsPage() {
  const adminCards = [
    {
      title: "Integration health and reconnect flows",
      description: "OAuth, API credentials, and rotating token endpoints now live in one managed workspace.",
      href: "/settings/integrations",
      accent: true,
    },
    {
      title: "Prompt Engine",
      description:
        "The single source of truth for every AI-powered workflow. Edit, version, test, and roll back the prompts that drive MTOS.",
      href: "/settings/prompt-engine",
      accent: true,
    },
    {
      title: "Users and role assignments",
      description: "Control workspace access, ownership, and role visibility for account teams.",
    },
    {
      title: "Feature flags and release controls",
      description: "Stage operational changes safely before they appear in front-line workflows.",
    },
    {
      title: "Audit logs and compliance settings",
      description: "Track admin changes, approvals, and operational decisions in one place.",
    },
    {
      title: "Security and session governance",
      description: "Keep session controls, credential safety, and account protections visible.",
    },
  ];

  return (
    <AppShell
      title="Administration"
      subtitle="Administration should remain powerful but understandable, keeping permissions, AI controls, integrations, and governance in one calm workspace."
    >
      <SectionCard
        eyebrow="Platform services"
        title="Administration surface"
        subtitle="Administration now includes a live integrations workspace and the Prompt Engine, while the rest of the settings surface remains staged for the next slices."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {adminCards.map((item) => {
            const content = (
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="text-sm leading-6 text-slate-300">{item.description}</p>
                </div>
                {item.href ? <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" /> : null}
              </div>
            );

            const className = item.accent
              ? "min-h-[168px] rounded-[24px] border border-[#d7f5ec]/20 bg-[linear-gradient(180deg,rgba(215,245,236,0.14),rgba(255,255,255,0.04))] p-5 transition hover:-translate-y-0.5"
              : "min-h-[168px] rounded-[24px] border border-white/8 bg-white/4 p-5";

            return item.href ? (
              <Link key={item.title} href={item.href} className={className}>
                {content}
              </Link>
            ) : (
              <div key={item.title} className={className}>
                {content}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </AppShell>
  );
}
