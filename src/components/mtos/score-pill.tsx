import { cn } from "@/src/lib/utils";

interface ScorePillProps {
  label: string;
  value: number | string;
  tone?: "neutral" | "positive" | "warning" | "danger";
  className?: string;
  contentClassName?: string;
  labelClassName?: string;
  valueClassName?: string;
}

const toneClasses = {
  neutral: "bg-white/8 text-slate-100 border-white/10",
  positive: "bg-emerald-500/12 text-emerald-200 border-emerald-400/25",
  warning: "bg-amber-500/12 text-amber-100 border-amber-400/25",
  danger: "bg-rose-500/12 text-rose-100 border-rose-400/25",
};

export function ScorePill({
  label,
  value,
  tone = "neutral",
  className,
  contentClassName,
  labelClassName,
  valueClassName,
}: ScorePillProps) {
  return (
    <div className={cn("rounded-full border px-3 py-2", toneClasses[tone], className)}>
      <div className={cn("flex items-center gap-3", contentClassName)}>
        <span className={cn("text-[11px] uppercase tracking-[0.24em] text-slate-400", labelClassName)}>
          {label}
        </span>
        <span className={cn("text-sm font-semibold", valueClassName)}>{value}</span>
      </div>
    </div>
  );
}
