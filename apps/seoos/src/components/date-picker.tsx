"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Self-contained, dependency-free date picker. Clicking anywhere on the field
 * opens a calendar popup so the date can be picked instead of typed. Themed via
 * the app's CSS variables (works in both light and dark). Value in/out is an ISO
 * string: "YYYY-MM-DD" in date mode, "YYYY-MM" in month mode — matching the
 * existing plain-text fields it replaces, so callers need no other changes.
 */

type Mode = "date" | "month";

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
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return null;
  return { y, m: mo };
}

export function DatePicker({
  value,
  onChange,
  mode = "date",
  placeholder,
  min,
  max,
  clearable = true,
  id,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  mode?: Mode;
  placeholder?: string;
  min?: string; // ISO, inclusive
  max?: string; // ISO, inclusive
  clearable?: boolean;
  id?: string;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const parsedDate = mode === "date" ? parseISODate(value) : null;
  const parsedMonth = mode === "month" ? parseISOMonth(value) : null;

  // Which month/year the calendar is currently viewing.
  const initial = parsedDate
    ? { y: parsedDate.getFullYear(), m: parsedDate.getMonth() }
    : parsedMonth
      ? { y: parsedMonth.y, m: parsedMonth.m }
      : { y: today.getFullYear(), m: today.getMonth() };
  const [viewY, setViewY] = useState(initial.y);
  const [viewM, setViewM] = useState(initial.m);

  // Re-sync the view to the value each time the popup opens.
  useEffect(() => {
    if (!open) return;
    const base = parsedDate
      ? { y: parsedDate.getFullYear(), m: parsedDate.getMonth() }
      : parsedMonth
        ? { y: parsedMonth.y, m: parsedMonth.m }
        : { y: today.getFullYear(), m: today.getMonth() };
    setViewY(base.y);
    setViewM(base.m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on outside click / Escape.
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

  // Flip above the field if there isn't room below.
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setDropUp(spaceBelow < 340 && rect.top > spaceBelow);
  }, [open]);

  const disabled = (iso: string) => (min && iso < min) || (max && iso > max);

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

  // Build the day grid for the viewed month.
  const firstWeekday = new Date(viewY, viewM, 1).getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="dp" ref={rootRef} style={style}>
      <button
        type="button"
        id={id}
        className="dp-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={display ? "dp-value" : "dp-placeholder"}>
          {display || placeholder || (mode === "month" ? "Pick month" : "Pick date")}
        </span>
        <svg className="dp-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <rect x="3" y="4.5" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 9h18M8 2.5v4M16 2.5v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <div className={`dp-pop${dropUp ? " dp-pop-up" : ""}`} ref={popRef} role="dialog">
          <div className="dp-head">
            <button type="button" className="dp-nav" aria-label="Previous" onClick={() => (mode === "month" ? setViewY((y) => y - 1) : stepMonth(-1))}>‹</button>
            <span className="dp-title">{mode === "month" ? viewY : `${MONTHS_FULL[viewM]} ${viewY}`}</span>
            <button type="button" className="dp-nav" aria-label="Next" onClick={() => (mode === "month" ? setViewY((y) => y + 1) : stepMonth(1))}>›</button>
          </div>

          {mode === "month" ? (
            <div className="dp-months">
              {MONTHS_SHORT.map((label, m) => {
                const iso = `${viewY}-${pad(m + 1)}`;
                const isSel = parsedMonth && parsedMonth.y === viewY && parsedMonth.m === m;
                const isThis = today.getFullYear() === viewY && today.getMonth() === m;
                const off = (min && iso < min.slice(0, 7)) || (max && iso > max.slice(0, 7));
                return (
                  <button
                    key={m}
                    type="button"
                    className={`dp-cell dp-mcell${isSel ? " dp-sel" : ""}${isThis ? " dp-today" : ""}`}
                    disabled={!!off}
                    onClick={() => pickMonth(m)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="dp-weekdays">
                {WEEKDAYS.map((w, i) => (
                  <span key={i} className="dp-weekday">{w}</span>
                ))}
              </div>
              <div className="dp-grid">
                {cells.map((day, i) => {
                  if (day === null) return <span key={i} className="dp-cell dp-empty" />;
                  const iso = toISODate(new Date(viewY, viewM, day));
                  const isSel = !!parsedDate && iso === value.slice(0, 10);
                  const isToday = iso === toISODate(today);
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`dp-cell${isSel ? " dp-sel" : ""}${isToday ? " dp-today" : ""}`}
                      disabled={!!disabled(iso)}
                      onClick={() => pickDay(day)}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="dp-foot">
            <button
              type="button"
              className="dp-quick"
              onClick={() => {
                if (mode === "month") { onChange(`${today.getFullYear()}-${pad(today.getMonth() + 1)}`); }
                else { onChange(toISODate(today)); }
                setOpen(false);
              }}
            >
              Today
            </button>
            {clearable ? (
              <button type="button" className="dp-quick" onClick={() => { onChange(""); setOpen(false); }}>
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
