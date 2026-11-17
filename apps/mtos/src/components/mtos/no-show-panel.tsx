"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NoShowState } from "@/src/lib/contracts/no-show";
import { calendarSlotAvailable, usableLoomUrl, type RescheduleAvailability } from "@/src/lib/contracts/no-show";
import { readJsonResponse } from "@/src/lib/api/read-json-response";

export function NoShowPanel({ touchId, initial }: { touchId: string; initial?: NoShowState }) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(initial && !initial.rescheduledAt));
  const [state, setState] = useState(initial);
  const [script, setScript] = useState(initial?.script || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [subject, setSubject] = useState(initial?.email?.subject || "");
  const [html, setHtml] = useState(initial?.email?.html || "");
  const [when, setWhen] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [availability, setAvailability] = useState<RescheduleAvailability>();
  async function loadAvailability() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}/no-show`);
      const result = await readJsonResponse<{ data?: typeof availability; error?: string }>(response);
      if (!response.ok || !result.data) throw new Error(result.error || "Availability could not be loaded.");
      setAvailability(result.data);
      setCheckedAt(Date.now());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Availability could not be loaded."); }
    finally { setBusy(false); }
  }
  const available = Boolean(availability && when && calendarSlotAvailable(new Date(when).toISOString(), availability, checkedAt));
  const suggestedTimes = availability && when ? [9, 10, 11, 12, 13, 14, 15, 16].map((hour) => `${when.slice(0, 10)}T${String(hour).padStart(2, "0")}:00`).filter((candidate) => calendarSlotAvailable(new Date(candidate).toISOString(), availability, checkedAt)) : [];
  async function run(body: object) {
    const response = await fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}/no-show`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    let result: { data?: NoShowState; error?: string };
    try { result = await readJsonResponse<typeof result>(response); }
    catch { throw new Error("The request returned no readable result. An action may have completed. Reload this touch and check its recorded state before retrying."); }
    if (!result.data) throw new Error(result.error || "No-show action failed.");
    const next = result.data;
    setState(next); setScript(next.script || ""); setUrl(next.url || "");
    setSubject(next.email?.subject || ""); setHtml(next.email?.html || "");
    if (!response.ok) throw new Error(result.error || "No-show action failed.");
    return next;
  }
  async function act(body: object, saveFirst = false) {
    setBusy(true); setError("");
    try {
      if (saveFirst) await run({ action: "save", script, url, subject, html });
      const next = await run(body);
      if (next.rescheduledAt) { setOpen(false); router.push(`/monthly-touch/${touchId}?step=prep`); }
      if (next.sentAt) router.push(`/monthly-touch/${touchId}/follow-through`);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No-show action failed."); }
    finally { setBusy(false); }
  }
  const chosen = state && !state.rescheduledAt ? state.resolution : undefined;
  return <div className="card mt-4">
    {state?.rescheduledAt && state.standbyUntil && Date.parse(state.standbyUntil) > checkedAt ? <p role="status">Rescheduled. This Monthly Touch stays in Preparation on standby until 48 hours before the meeting.</p> : null}
    <button type="button" className="btn btn-risk" disabled={busy} onClick={() => setOpen(!open)}>No-Show</button>
    {open ? <section aria-label="No-show resolution" className="mt-4 grid gap-4">
      <div className="flex items-center justify-between"><h2 className="h3">Client did not attend</h2><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setOpen(false)}>{chosen ? "Return to Live Call" : "Cancel"}</button></div>
      {!chosen ? <div className="grid gap-3 md:grid-cols-2">
        <button type="button" className="card text-left" disabled={busy} onClick={() => void act({ action: "select", resolution: "reschedule" })}><strong>Reschedule Meeting</strong><p>Reschedule the existing Monthly Touch meeting and return the workflow to Preparation.</p></button>
        <button type="button" className="card text-left" disabled={busy} onClick={() => void act({ action: "select", resolution: "loom" })}><strong>Send Loom Video Update</strong><p>Replace the live meeting with a recorded video update that can be sent to the client by email.</p></button>
      </div> : chosen === "reschedule" ? <>
        <p>The existing Calendar event will be updated, keeping its attendees and meeting link. Calendar write consent is required.</p>
        <button type="button" className="btn" disabled={busy} onClick={() => void loadAvailability()}>Check calendar availability</button>
        <label className="field">New meeting date and time (your browser time zone)<input className="input" type="datetime-local" value={when} onChange={(e) => { setWhen(e.target.value); setConfirm(false); }} disabled={busy} /></label>
        {suggestedTimes.length ? <div className="flex flex-wrap gap-2" aria-label="Available meeting times"><span>Available starts on this date:</span>{suggestedTimes.map((candidate) => <button type="button" className="btn btn-sm" key={candidate} disabled={busy} onClick={() => { setWhen(candidate); setConfirm(false); }}>{candidate.slice(11)}</button>)}</div> : null}
        {availability ? <><p>Checked your calendar for the next 30 days. Meeting duration: {availability.durationMinutes} minutes. Client availability is not verified.</p><p role="status">{when ? available ? "Selected time is available on your calendar." : "Choose a free time within the next 30 days." : "Select a date and time."}</p><details><summary>Busy times</summary><ul>{availability.busy.map((period, i) => <li key={i}>{period.start} – {period.end}</li>)}</ul></details></> : null}
        <button type="button" className="btn" disabled={busy || !available} onClick={() => setConfirm(true)}>Review rescheduling</button>
        {confirm ? <div role="group" aria-label="Confirm rescheduling"><p>Move this meeting to {new Date(when).toLocaleString()} and return to Preparation? Previous attempt records will be archived.</p><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act({ action: "reschedule", scheduledAt: new Date(when).toISOString(), confirmed: true })}>Confirm rescheduling</button></div> : null}
      </> : <>
        <p className="chip">No-Show / Loom Video Update</p>
        <button type="button" className="btn" disabled={busy || Boolean(state?.sentAt)} onClick={() => void act({ action: "generate" })}>{state?.presentation ? "Regenerate presentation and script" : "Generate presentation and script"}</button>
        {state?.presentation ? <a className="btn btn-ghost" href={`/api/monthly-touches/${touchId}/presentation.pptx`}>Download client presentation</a> : null}
        <label className="field">Speaking script<textarea className="textarea" rows={12} value={script} disabled={busy || Boolean(state?.sentAt)} onChange={(e) => setScript(e.target.value)} /></label>
        <label className="field">Loom recording URL<input className="input" type="url" value={url} disabled={busy || Boolean(state?.sentAt)} onChange={(e) => setUrl(e.target.value)} /></label>
        {usableLoomUrl(url) ? <a href={url} target="_blank" rel="noreferrer">Review Loom recording</a> : null}
        <div className="flex gap-2"><button type="button" className="btn" disabled={busy} onClick={() => void act({ action: "save", script, url, subject, html })}>Save video details</button><button type="button" className="btn" disabled={busy || !usableLoomUrl(url) || !script.trim()} onClick={() => void act({ action: "email" }, true)}>Generate Email Update</button></div>
        {state?.email ? <>
          <p>To: {state.email.recipient}</p>
          <label className="field">Email subject<input className="input" value={subject} disabled={busy} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="field">Email body (HTML)<textarea className="textarea" rows={10} value={html} disabled={busy} onChange={(e) => setHtml(e.target.value)} /></label>
          <div className="card" aria-label="Email preview" dangerouslySetInnerHTML={{ __html: state.email.html }} />
          <p>Save changes to refresh the preview. Sending records Intercom acceptance; it does not confirm inbox delivery.</p>
          <button type="button" className="btn btn-primary" disabled={busy || state.sendStatus === "sent" || state.sendStatus === "unknown" || state.sendStatus === "sending"} onClick={() => void act({ action: "send", approved: true }, true)}>Approve &amp; Send</button>
        </> : null}
        {state?.sendStatus ? <p role="status">Email status: {state.sendStatus}. {state.sendError}</p> : null}
        {state?.sendStatus === "unknown" || state?.sendStatus === "sending" ? <button type="button" className="btn" disabled={busy} onClick={() => void act({ action: "reconcile" })}>Check existing email in Intercom</button> : null}
      </>}
      {busy ? <p role="status">Saving…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section> : null}
  </div>;
}
