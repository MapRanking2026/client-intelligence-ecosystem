"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readJsonResponse } from "@/src/lib/api/read-json-response";
import type { NextTouchBooking, SharedCalendarView } from "@/src/lib/contracts/next-touch-booking";
import type { RescheduleAvailability } from "@/src/lib/contracts/no-show";
import { RescheduleCalendar } from "./reschedule-calendar";
import "./next-touch-booking.css";

interface BookingModel {
  open: boolean; title: string; guests: string; description: string; duration: number;
  view: SharedCalendarView; saving: boolean; error: string; initialized: boolean; booking?: NextTouchBooking;
}
interface Availability extends RescheduleAvailability { defaultTitle: string; defaultAttendees: string[]; clientTimeZone?: string; booking?: NextTouchBooking; }
const initial: BookingModel = { open: false, title: "", guests: "", description: "", duration: 60, view: {}, saving: false, error: "", initialized: false };
const localDay = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");

/** The client window mirrors this control; the AM still explicitly confirms the real invite. */
export function NextTouchBookingControl({ touchId, mirror = false }: { touchId: string; mirror?: boolean }) {
  const [model, setModel] = useState<BookingModel>(initial);
  const [metadata, setMetadata] = useState<Availability>();
  const modelRef = useRef(model);
  const busRef = useRef<BroadcastChannel | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { modelRef.current = model; }, [model]);
  const patch = useCallback((changes: Partial<BookingModel>) => {
    setModel(previous => ({ ...previous, ...changes }));
    busRef.current?.postMessage({ type: "patch", changes });
  }, []);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bus = new BroadcastChannel("mtos-next-booking:" + touchId); busRef.current = bus;
    bus.onmessage = event => {
      const message = event.data;
      if (message?.type === "hello" && modelRef.current.open) bus.postMessage({ type: "patch", changes: modelRef.current });
      if (message?.type !== "patch" || !message.changes || typeof message.changes !== "object") return;
      const changes = message.changes as Partial<BookingModel>;
      setModel(previous => ({ ...previous, ...changes, open: changes.open === false ? false : mirror || previous.open ? (changes.open ?? previous.open) : false }));
    };
    bus.postMessage({ type: "hello" });
    return () => { bus.close(); busRef.current = null; };
  }, [touchId, mirror]);
  useEffect(() => {
    if (model.open && !dialog.current?.open) dialog.current?.showModal();
    if (!model.open) dialog.current?.close();
  }, [model.open]);
  const loaded = useCallback((raw: RescheduleAvailability & Record<string, unknown>) => {
    const data = raw as unknown as Availability; setMetadata(data);
    if (!modelRef.current.initialized) {
      const booking = data.booking; const start = booking && new Date(booking.scheduledAt);
      patch({ initialized: true, title: booking?.title || data.defaultTitle, guests: (booking?.attendees || data.defaultAttendees || []).join(", "), description: booking?.description || "", ...(booking ? { booking, duration: Math.round((Date.parse(booking.endAt) - Date.parse(booking.scheduledAt)) / 60000), view: { day: localDay(start!), month: localDay(new Date(start!.getFullYear(), start!.getMonth(), 1)) } } : {}) });
    } else if (data.booking && JSON.stringify([modelRef.current.booking?.scheduledAt, modelRef.current.booking?.endAt, modelRef.current.booking?.title, modelRef.current.booking?.attendees]) !== JSON.stringify([data.booking.scheduledAt, data.booking.endAt, data.booking.title, data.booking.attendees])) {
      patch({ booking: data.booking });
    }
  }, [patch]);
  async function confirm(scheduledAt: string) {
    const current = modelRef.current;
    const attendees = [...new Set(current.guests.split(/[,;\n]+/).map(email => email.trim()).filter(Boolean))];
    if (!current.title.trim() || !attendees.length || attendees.some(email => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))) { patch({ error: "Add a meeting title and valid guest email addresses before saving." }); return; }
    patch({ saving: true, error: "" });
    try {
      const response = await fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}/next-meeting`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: current.booking ? "update" : "book", scheduledAt, durationMinutes: current.duration, title: current.title, attendees, description: current.description, confirmed: true }) });
      const result = await readJsonResponse<{ data?: NextTouchBooking; error?: string }>(response);
      if (!response.ok || !result.data) throw new Error(result.error || "Google Calendar did not confirm this meeting.");
      patch({ booking: result.data, saving: false, view: { ...current.view, selected: undefined }, error: "" });
    } catch (error) { patch({ saving: false, error: error instanceof Error ? error.message : "The meeting could not be saved." }); }
  }
  const selected = model.view.selected && new Date(model.view.selected);
  const details = <div className="mtos-next-fields">
    <label>Meeting title<input className="input" value={model.title} disabled={model.saving} onChange={event => patch({ title: event.target.value })} /></label>
    <label>Guest email addresses<input className="input" value={model.guests} disabled={model.saving} onChange={event => patch({ guests: event.target.value })} placeholder="client@example.com, teammate@example.com" /></label>
    <label>Duration<select className="input" value={model.duration} disabled={model.saving} onChange={event => patch({ duration: Number(event.target.value) })}>{[15, 30, 45, 60, 90, 120, 180, 240].map(value => <option key={value} value={value}>{value} minutes</option>)}</select></label>
    <label>Description<textarea aria-label="Description" className="textarea" rows={3} value={model.description} disabled={model.saving} onChange={event => patch({ description: event.target.value })} /></label>
    {selected && metadata?.clientTimeZone ? <p>Client time: <strong>{new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: metadata.clientTimeZone }).format(selected)}</strong> ({metadata.clientTimeZone})</p> : null}
  </div>;
  return <>
    <button type="button" className="mtos-next-slide-button" onClick={event => { event.stopPropagation(); patch({ open: true, error: "", initialized: false }); }}>{model.booking ? "Next Monthly Touch booked · View calendar" : "Book next Monthly Touch"}</button>
    {model.open && typeof document !== "undefined" ? createPortal(<dialog ref={dialog} className="mtos-next-dialog" aria-label="Book next Monthly Touch" onCancel={event => { if (event.target !== event.currentTarget) return; if (model.saving) event.preventDefault(); else patch({ open: false }); }} onClose={event => { if (event.target === event.currentTarget) patch({ open: false }); }} onKeyDown={event => event.stopPropagation()}>
      <div className="mtos-next-heading"><div><span>GOOGLE CALENDAR · LIVE AVAILABILITY</span><h2>Book next Monthly Touch</h2></div><button type="button" className="btn btn-ghost btn-sm" disabled={model.saving} onClick={() => patch({ open: false })}>Close calendar</button></div>
      {model.booking ? <div className="mtos-next-success" role="status"><strong>Saved in Google Calendar</strong><p>{new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: metadata?.clientTimeZone || metadata?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone }).format(new Date(model.booking.scheduledAt))}</p><p>{model.booking.attendees.join(", ")}</p>{model.booking.htmlLink ? <a href={model.booking.htmlLink} target="_blank" rel="noopener noreferrer">Open saved event in Google Calendar</a> : null}<p>Select another free block below to change this meeting.</p></div> : null}
      <RescheduleCalendar touchId={touchId} intent="next-touch" saving={model.saving} durationMinutes={model.duration} submissionError={model.error} onConfirm={confirm} eventDetails={details} view={model.view} onViewChange={view => patch({ view })} onAvailability={loaded} />
    </dialog>, document.fullscreenElement || document.body) : null}
  </>;
}
