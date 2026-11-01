"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GoogleMeetingOverview, GoogleMeetingState } from "@/src/lib/contracts/google-meet";
import { readJsonResponse } from "@/src/lib/api/read-json-response";

export async function meetingRequest<T>(touchId: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}/google-meeting`, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  const result = await readJsonResponse<{ data?: T; error?: string }>(response);
  if (!response.ok || !result?.data) throw new Error(result?.error || "Google meeting request failed.");
  return result.data;
}

export function GoogleMeetingPanel({ touchId, emails = [] }: { touchId: string; emails?: string[] }) {
  const router = useRouter();
  const [overview, setOverview] = useState<GoogleMeetingOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [eventId, setEventId] = useState("");
  const [conferenceName, setConferenceName] = useState("");
  const [clientEmails, setClientEmails] = useState(emails.join(", "));

  async function enableNotifications() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/integrations/google-meet/events", { method: "POST" });
      const result = await readJsonResponse<{ data?: { state: string; expireTime: string }; error?: string }>(response);
      if (!response.ok || !result?.data) throw new Error(result?.error || "Could not enable Google notifications.");
      setMessage(`Google notifications: ${result.data.state}. Subscription expires ${new Date(result.data.expireTime).toLocaleString()}; MTOS renews it daily.`);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not enable notifications."); }
    finally { setBusy(false); }
  }

  async function refresh() {
    const data = await meetingRequest<GoogleMeetingOverview>(touchId);
    setOverview(data);
    setEventId(data.selection?.calendarEventId || "");
    setConferenceName(data.selection?.conference?.name || "");
    return data;
  }
  async function run(action?: unknown) {
    setBusy(true); setError(""); setMessage("");
    try {
      if (action) {
        const state = await meetingRequest<GoogleMeetingState>(touchId, action);
        setMessage(state.message || "Saved.");
        if (state.status === "analyzed") router.refresh();
      }
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load Google meetings."); }
    finally { setBusy(false); }
  }

  return <section className="card mt-4 space-y-3" aria-label="Google meetings">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="h4">Google meetings</h2><p className="muted text-sm">Client meetings, recordings, transcripts and automatic follow-up drafts.</p></div>
      <button className="btn btn-ghost" disabled={busy} onClick={() => void run()}>{busy ? "Working…" : "Sync Google meetings"}</button>
    </div>
    {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
    {message ? <p role="status" className="text-sm text-teal-200">{message}</p> : null}
    {overview ? <>
      <p className="muted text-sm">{overview.pastScheduledCount} past appointments · {overview.upcomingCount} upcoming · {overview.completedConferenceCount} completed calls verified in the last 29 days.</p>
      <p className="muted text-xs">Primary calendar: {new Date(overview.historySince).toLocaleDateString()}–{new Date(overview.historyUntil).toLocaleDateString()}. Times shown in {overview.timeZone}. Past appointments do not prove attendance. Older completed calls are outside Google&apos;s conference history window.</p>
      <label className="block text-sm">Client attendee emails (comma separated)
        <input className="input mt-1 w-full" value={clientEmails} onChange={(event) => setClientEmails(event.target.value)} placeholder="client@example.com" />
      </label>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run({ action: "client_emails", emails: clientEmails.split(",").map((email) => email.trim()).filter(Boolean) })}>Save client email matching</button>
      <label className="block text-sm">Meeting
        <select className="select mt-1 w-full" value={eventId} disabled={busy} onChange={(event) => { setEventId(event.target.value); setConferenceName(""); }}>
          <option value="">Choose the client meeting</option>
          {overview.meetings.map((meeting) => <option key={meeting.eventId} value={meeting.eventId}>{new Date(meeting.start).toLocaleString(undefined, { timeZone: overview.timeZone })} — {meeting.title} ({meeting.match === "client_title" ? "title match: verify client" : meeting.match === "client_email" ? "client email" : "linked event"})</option>)}
        </select>
      </label>
      <button className="btn btn-ghost btn-sm" disabled={busy || !eventId} onClick={() => void run({ action: "select", eventId })}>Use this meeting</button>
      {overview.selection && overview.conferences.length ? <label className="block text-sm">Exact call (select if this meeting link was used more than once)
        <select className="select mt-1 w-full" value={conferenceName} disabled={busy} onChange={(event) => setConferenceName(event.target.value)}>
          <option value="">Automatically match only if unambiguous</option>
          {overview.conferences.map((conference) => <option key={conference.name} value={conference.name}>{new Date(conference.startTime).toLocaleString(undefined, { timeZone: overview.timeZone })} — {conference.endTime ? "ended" : "active"}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm mt-2" disabled={busy || !conferenceName} onClick={() => void run({ action: "conference", conferenceName })}>Use this exact call</button>
      </label> : null}
      <div className="flex flex-wrap gap-2">
        {overview.selection ? <a className="btn btn-primary" href={overview.selection.meetingUrl} target="_blank" rel="noopener noreferrer">Join meeting</a> : null}
        {overview.selection ? <EndGoogleMeetingButton touchId={touchId} /> : null}
        <button className="btn btn-primary" disabled={busy} onClick={() => void run({ action: "sync" })}>Retrieve files & analyze</button>
        {!overview.selection ? <button className="btn btn-ghost" disabled={busy} onClick={() => void run({ action: "create" })}>Create a new MTOS call</button> : null}
      </div>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void enableNotifications()}>Enable Google file-ready notifications</button>
      <p className="muted text-xs">Analysis matches calls from today or yesterday. A new MTOS call creates a separate link; it does not update calendar invitations. Recording and transcription must be enabled in Meet. When enabled and configured, Google file-ready notifications trigger processing. A daily job renews subscriptions and checks missed files. Use Retrieve files & analyze after a call to process it sooner.</p>
      {overview.selection?.message ? <p role="status" className="text-sm">{overview.selection.message}</p> : null}
      {overview.selection?.artifacts?.map((artifact) => <div key={artifact.id} className="text-sm">
        <a href={artifact.url} target="_blank" rel="noopener noreferrer" className="underline">Open {artifact.kind}</a>
        <span className="muted"> — {artifact.sharing === "editor" ? "Editor access granted to support@mapranking.com" : `Sharing failed: ${artifact.error}`}</span>
      </div>)}
    </> : null}
  </section>;
}

export function EndGoogleMeetingButton({ touchId, onEnded }: { touchId: string; onEnded?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function end() {
    setBusy(true); setMessage("");
    try {
      const overview = await meetingRequest<GoogleMeetingOverview>(touchId);
      const active = overview.conferences.filter((conference) => !conference.endTime);
      if (!overview.selection?.createdByMtos) throw new Error("For this Calendar call, use End call in Google Meet. Google permits MTOS to end only calls it created.");
      if (active.length !== 1) throw new Error("There is no single active Google Meet call to end.");
      if (!window.confirm("End this Google Meet call for everyone?")) return;
      await meetingRequest(touchId, { action: "end", conferenceName: active[0].name });
      setMessage("Call ended. Files will be processed when Google makes them available.");
      onEnded?.();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Could not end the call."); }
    finally { setBusy(false); }
  }
  return <div><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void end()}>{busy ? "Ending…" : "End meeting for everyone"}</button>{message ? <p role="status" className="text-xs max-w-sm">{message}</p> : null}</div>;
}
