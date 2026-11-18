"use client";

import { useEffect, useRef, useState } from "react";
import { calendarSlotAvailable, type RescheduleAvailability } from "@/src/lib/contracts/no-show";
import { readJsonResponse } from "@/src/lib/api/read-json-response";
import "./reschedule-calendar.css";

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const weekStart = (date: Date) => addDays(date, -(date.getDay() + 6) % 7);
const dayLabel = (date: Date) => date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
const clock = (date: Date) => date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function RescheduleCalendar({ touchId, saving, submissionError, onConfirm }: { touchId: string; saving: boolean; submissionError?: string; onConfirm: (scheduledAt: string) => Promise<void> }) {
  const [today] = useState(() => new Date());
  const [day, setDay] = useState(() => addDays(new Date(), 1));
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [availability, setAvailability] = useState<RescheduleAvailability>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Date>();
  const [fullDay, setFullDay] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}/no-show`, { signal: controller.signal });
        const result = await readJsonResponse<{ data?: RescheduleAvailability; error?: string }>(response);
        if (!response.ok || !result.data) throw new Error(result.error || "Calendar availability could not be loaded.");
        if (!controller.signal.aborted) { setAvailability(result.data); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Calendar availability could not be loaded."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [touchId, revision]);
  useEffect(() => { if (selected) dialog.current?.showModal(); }, [selected]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(day), i));
  const monthDays = Array.from({ length: 42 }, (_, i) => addDays(weekStart(month), i));
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const horizon = availability ? new Date(availability.until) : addDays(today, 30);
  const inRange = (date: Date) => dayKey(date) >= dayKey(today) && dayKey(date) <= dayKey(horizon);
  const free = (date: Date) => Boolean(availability && calendarSlotAvailable(date.toISOString(), availability, today.getTime()));
  const changeDay = (date: Date) => { setDay(date); setMonth(new Date(date.getFullYear(), date.getMonth(), 1)); };
  const refresh = () => { setLoading(true); setError(""); setAvailability(undefined); setRevision((value) => value + 1); };
  const close = () => { if (!saving) { dialog.current?.close(); setSelected(undefined); } };
  const rows = Array.from({ length: fullDay ? 48 : 22 }, (_, i) => (fullDay ? 0 : 8 * 60) + i * 30);
  return <div className="mtos-cal" aria-label="Reschedule calendar" aria-busy={loading || saving}>
    <header className="mtos-cal-toolbar"><div><span className="mtos-cal-eyebrow">MONTHLY TOUCH · RESCHEDULE</span><h3>Find a new time</h3><p>Select a free block to review the change.</p></div><button type="button" className="btn btn-ghost btn-sm" disabled={loading || saving} onClick={refresh}>Refresh availability</button></header>
    <div className="mtos-cal-meta"><span><i /> Google Calendar availability</span><span>{availability ? `${availability.durationMinutes} minute meeting` : "Loading meeting…"}</span><span>Times in {zone}</span></div>
    {error ? <div role="alert" className="mtos-cal-error">{error} <button type="button" className="btn btn-sm" onClick={refresh}>Retry availability</button></div> : null}
    {loading ? <div role="status" className="mtos-cal-loading"><span className="mtos-cal-spinner" /> Checking your calendar…</div> : null}
    <div className="mtos-cal-layout">
      <aside className="mtos-cal-sidebar"><div className="mtos-cal-month-nav"><button type="button" aria-label="Previous month" disabled={saving || new Date(month.getFullYear(), month.getMonth(), 0) < addDays(today, -1)} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><strong>{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</strong><button type="button" aria-label="Next month" disabled={saving || new Date(month.getFullYear(), month.getMonth() + 1, 1) > horizon} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></div>
        <div className="mtos-cal-month" aria-label="Choose meeting date">{["M", "T", "W", "T", "F", "S", "S"].map((label, i) => <span className="mtos-cal-weekday" key={i}>{label}</span>)}{monthDays.map((date) => <button type="button" key={dayKey(date)} aria-label={dayLabel(date)} aria-pressed={dayKey(date) === dayKey(day)} disabled={!inRange(date) || saving} className={`${dayKey(date) === dayKey(day) ? "is-selected" : ""} ${date.getMonth() !== month.getMonth() ? "is-other-month" : ""}`} onClick={() => changeDay(date)}>{date.getDate()}</button>)}</div>
        <div className="mtos-cal-legend"><span><i className="is-free" /> Available start</span><span><i className="is-busy" /> Unavailable</span></div><p className="mtos-cal-note">Your next 30 days. Busy blocks include the full meeting duration. Client availability is not verified.</p>
      </aside>
      <div className="mtos-cal-week"><div className="mtos-cal-week-nav"><div><button type="button" aria-label="Previous week" disabled={saving || addDays(weekStart(day), -1) < addDays(today, -1)} onClick={() => changeDay(addDays(day, -7))}>‹</button><button type="button" aria-label="Next week" disabled={saving || addDays(weekStart(day), 7) > horizon} onClick={() => changeDay(addDays(day, 7))}>›</button><strong>{days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {days[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong></div><label><input type="checkbox" checked={fullDay} onChange={(event) => setFullDay(event.target.checked)} /> Full day</label></div>
        <div className="mtos-cal-scroll"><div className="mtos-cal-grid" role="group" aria-label="Weekly meeting times"><div className="mtos-cal-corner">{zone.split("/").at(-1)?.replaceAll("_", " ")}</div>{days.map((date) => <button type="button" key={dayKey(date)} className={`mtos-cal-day ${dayKey(date) === dayKey(day) ? "is-selected" : ""}`} disabled={!inRange(date) || saving} onClick={() => changeDay(date)}><span>{date.toLocaleDateString("en-US", { weekday: "short" })}</span><strong>{date.getDate()}</strong></button>)}
          {rows.map((minute) => <div className="mtos-cal-row" key={minute}><span className="mtos-cal-hour">{minute % 60 === 0 ? clock(new Date(2026, 0, 1, Math.floor(minute / 60))) : ""}</span>{days.map((date) => {
            const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minute / 60), minute % 60);
            const available = !loading && !error && free(start);
            const label = `${dayLabel(start)} at ${clock(start)}`;
            return <button type="button" key={dayKey(date)} className={`mtos-cal-slot ${available ? "is-free" : "is-busy"}`} disabled={!available || saving} aria-label={`${available ? "Available" : "Unavailable"}: ${label}`} title={`${label} · ${available ? "Available" : "Unavailable"}`} onClick={() => setSelected(start)}>{available ? <span>{clock(start)}</span> : <span aria-hidden="true">—</span>}</button>;
          })}</div>)}
        </div></div>
      </div>
    </div>
    <footer className="mtos-cal-footer">Your existing event, attendees and Google Meet link are kept. Confirming updates Google Calendar and returns this Monthly Touch to Preparation.</footer>
    <dialog ref={dialog} className="mtos-cal-dialog" aria-labelledby="reschedule-title" onCancel={(event) => { if (saving) event.preventDefault(); }} onClose={() => setSelected(undefined)}>
      <span className="mtos-cal-eyebrow">NEW MEETING TIME</span><h3 id="reschedule-title">Reschedule Monthly Touch</h3>{selected ? <><p className="mtos-cal-confirm-date">{dayLabel(selected)}</p><p>{clock(selected)} – {clock(new Date(selected.getTime() + (availability?.durationMinutes || 0) * 60000))}<br /><span className="mtos-cal-note">{zone}</span></p></> : null}<p>The existing Google Calendar event will be updated and attendees notified. Previous meeting records are preserved.</p>{submissionError ? <p role="alert" className="mtos-cal-error">{submissionError}</p> : null}<div className="mtos-cal-dialog-actions"><button type="button" className="btn btn-ghost" disabled={saving} onClick={close}>Choose another time</button><button type="button" className="btn btn-primary" disabled={saving || !selected} onClick={() => { if (selected) void onConfirm(selected.toISOString()); }}>{saving ? "Updating calendar…" : "Confirm rescheduling"}</button></div>
    </dialog>
  </div>;
}
