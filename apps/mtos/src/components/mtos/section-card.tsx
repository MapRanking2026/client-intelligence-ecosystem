import type { ReactNode } from "react";

interface SectionCardProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  aside?: ReactNode;
}

export function SectionCard({
  eyebrow,
  title,
  subtitle,
  children,
  aside,
}: SectionCardProps) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-6 shadow-[0_30px_80px_rgba(5,10,18,0.22)] backdrop-blur">
      <div className="flex flex-col gap-4 border-b border-white/8 pb-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
              {eyebrow}
            </p>
          ) : null}
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
            {subtitle ? <p className="max-w-2xl text-sm text-slate-400">{subtitle}</p> : null}
          </div>
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
      <div className="pt-5">{children}</div>
    </section>
  );
}
