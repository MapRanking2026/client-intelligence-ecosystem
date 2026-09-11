"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Click-to-open calendar date field. Replaces bare <input type="date"> so the
 * whole field opens a calendar popup (pick a day instead of typing). Themed to
 * match MTOS: `variant="dark"` for the dark-glass cards (post-meeting workflow),
 * `variant="light"` (default) for token-themed light pages. Value in/out is an
 * ISO string ("YYYY-MM-DD" for date, "YYYY-MM" for month) so it drops into the
 * existing fields with no other changes.
 */

type Mode = "date" | "month";
type Variant = "dark" | "light";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toISODate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseISODate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
function parseISOMonth(s: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})/.exec(s ?? "");
  if (!m) return null;
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return null;
  return { y: Number(m[1]), m: mo };
}

const THEME: Record<Variant, {
  trigger: string; placeholder: string; icon: string; pop: string; title: string;
  nav: string; weekday: string; cell: string; today: string; quick: string;
}> = {
  dark: {
    trigger: "border-white/10 bg-black/30 text-slate-200",
    placeholder: "text-slate-500",
    icon: "text-slate-400",
    pop: "border-white/10 bg-slate-900 text-slate-200 shadow-2xl",
    title: "text-slate-100",
    nav: "text-slate-300 hover:bg-white/10 hover:text-white",
    weekday: "text-slate-500",
    cell: "text-slate-200 hover:bg-white/10",
    today: "ring-1 ring-inset ring-white/30",
    quick: "text-slate-300 hover:bg-white/10 hover:text-white",
  },
  light: {
    trigger: "border-[var(--hair)] bg-[var(--surface)] text-[var(--text)]",
    placeholder: "text-[var(--slate-400)]",
    icon: "text-[var(--slate-400)]",
    pop: "border-[var(--hair)] bg-[var(--surface)] text-[var(--text)] shadow-lg",
    title: "text-[var(--text)]",
    nav: "text-[var(--slate-400)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
    weekday: "text-[var(--slate-400)]",
    cell: "text-[var(--text)] hover:bg-[var(--surface-2)]",
    today: "ring-1 ring-inset ring-[var(--accent)]",
    quick: "text-[var(--slate-300)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
  },
};

export function DateField({
  value,
  onChange,
  mode = "date",
  variant = "light",
  placeholder,
  min,
  max,
  clearable = true,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  mode?: Mode;
  variant?: Variant;
  placeholder?: string;
  min?: string;
  max?: string;
  clearable?: boolean;
  id?: string;
}) {
  const t = THEME[variant];
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const parsedDate = mode === "date" ? parseISODate(value) : null;
  const parsedMonth = mode === "month" ? parseISOMonth(value) : null;

  const initial = parsedDate
    ? { y: parsedDate.getFullYear(), m: parsedDate.getMonth() }
    : parsedMonth ?? { y: today.getFullYear(), m: today.getMonth() };
  const [viewY, setViewY] = useState(initial.y);
  const [viewM, setViewM] = useState(initial.m);

  useEffect(() => {
    if (!open) return;
    const base = parsedDate
      ? { y: parsedDate.getFullYear(), m: parsedDate.getMonth() }
      : parsedMonth ?? { y: today.getFullYear(), m: today.getMonth() };
    setViewY(base.y);
    setViewM(base.m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setDropUp(spaceBelow < 340 && rect.top > spaceBelow);
  }, [open]);

  const disabled = (iso: string) => (!!min && iso < min) || (!!max && iso > max);

  const display = (() => {
    if (mode === "date" && parsedDate) {
      return `${MONTHS_SHORT[parsedDate.getMonth()]} ${parsedDate.getDate()}, ${parsedDate.getFullYear()}`;
    }
    if (mode === "month" && parsedMonth) {
      return `${MONTHS_FULL[parsedMonth.m]} ${parsedMonth.y}`;
    }
    return "";
  })();

  function stepMonth(delta: number) {
    let m = viewM + delta;
    let y = viewY;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    setViewM(m);
    setViewY(y);
  }
  function pickDay(day: number) {
    const iso = toISODate(new Date(viewY, viewM, day));
    if (disabled(iso)) return;
    onChange(iso);
    setOpen(false);
  }
  function pickMonth(m: number) {
    const iso = `${viewY}-${pad(m + 1)}`;
    if ((min && iso < min.slice(0, 7)) || (max && iso > max.slice(0, 7))) return;
    onChange(iso);
    setOpen(false);
  }

  const firstWeekday = new Date(viewY, viewM, 1).getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const cellBase = "grid h-8 w-8 place-items-center rounded-lg text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-30";
  const selCls = "bg-[var(--accent)] text-white hover:bg-[var(--accent)]";

  return (
    <div className="relative mt-1" ref={rootRef}>
      <button
        type="button"
        id={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm outline-none transition-colors ${t.trigger}`}
      >
        <span className={display ? "" : t.placeholder}>
          {display || placeholder || (mode === "month" ? "Pick month" : "Pick date")}
        </span>
        <svg className={`h-4 w-4 shrink-0 ${t.icon}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="4.5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 9h18M8 2.5v4M16 2.5v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          className={`absolute z-50 w-[260px] rounded-2xl border p-3 ${t.pop} ${dropUp ? "bottom-full mb-2" : "top-full mt-2"}`}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous"
              onClick={() => (mode === "month" ? setViewY((y) => y - 1) : stepMonth(-1))}
              className={`grid h-7 w-7 place-items-center rounded-lg text-base ${t.nav}`}
            >
              ‹
            </button>
            <span className={`text-sm font-semibold ${t.title}`}>
              {mode === "month" ? viewY : `${MONTHS_FULL[viewM]} ${viewY}`}
            </span>
            <button
              type="button"
              aria-label="Next"
              onClick={() => (mode === "month" ? setViewY((y) => y + 1) : stepMonth(1))}
              className={`grid h-7 w-7 place-items-center rounded-lg text-base ${t.nav}`}
            >
              ›
            </button>
          </div>

          {mode === "month" ? (
            <div className="grid grid-cols-3 gap-1">
              {MONTHS_SHORT.map((label, m) => {
                const iso = `${viewY}-${pad(m + 1)}`;
                const isSel = !!parsedMonth && parsedMonth.y === viewY && parsedMonth.m === m;
                const isThis = today.getFullYear() === viewY && today.getMonth() === m;
                const off = (min && iso < min.slice(0, 7)) || (max && iso > max.slice(0, 7));
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={!!off}
                    onClick={() => pickMonth(m)}
                    className={`h-9 rounded-lg text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${isSel ? selCls : t.cell} ${isThis && !isSel ? t.today : ""}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="mb-1 grid grid-cols-7">
                {WEEKDAYS.map((w, i) => (
                  <span key={i} className={`grid h-6 place-items-center text-[11px] ${t.weekday}`}>{w}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((day, i) => {
                  if (day === null) return <span key={i} className="h-8 w-8" />;
                  const iso = toISODate(new Date(viewY, viewM, day));
                  const isSel = !!parsedDate && iso === value.slice(0, 10);
                  const isToday = iso === toISODate(today);
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={disabled(iso)}
                      onClick={() => pickDay(day)}
                      className={`${cellBase} ${isSel ? selCls : t.cell} ${isToday && !isSel ? t.today : ""}`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className={`mt-2 flex items-center justify-between border-t pt-2 ${variant === "dark" ? "border-white/10" : "border-[var(--hair)]"}`}>
            <button
              type="button"
              onClick={() => {
                onChange(mode === "month" ? `${today.getFullYear()}-${pad(today.getMonth() + 1)}` : toISODate(today));
                setOpen(false);
              }}
              className={`rounded-lg px-2 py-1 text-xs font-medium ${t.quick}`}
            >
              Today
            </button>
            {clearable ? (
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); }}
                className={`rounded-lg px-2 py-1 text-xs font-medium ${t.quick}`}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
