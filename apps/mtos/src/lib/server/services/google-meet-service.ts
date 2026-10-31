import { createHash, randomUUID } from "node:crypto";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { GoogleConference, GoogleMeeting, GoogleMeetingArtifact, GoogleMeetingOverview, GoogleMeetingState } from "@/src/lib/contracts/google-meet";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath, tenantUsersCollectionPath } from "@/src/lib/server/firebase/collections";
import { getIntegrationConnection, getIntegrationCredentials, getMissingIntegrationScopes, refreshIntegration } from "@/src/lib/server/integrations";
import { extractTitleCandidate, scoreCandidateAgainstClient, MATCH_STRENGTH } from "@/src/lib/server/calendar-touch-matching";
import { chooseConference, isRecentMeeting, meetingCode } from "./google-meet-matching";
import { analyzePostMeetingTranscript } from "./post-meeting-service";
import { listActiveTenantIds } from "./daily-sync-service";

const MEET = "https://meet.googleapis.com/v2";
const CALENDAR = "https://www.googleapis.com/calendar/v3";
const DRIVE = "https://www.googleapis.com/drive/v3";
const SUPPORT = "support@mapranking.com";
type Json = Record<string, unknown>;
interface CalendarEvent {
  id: string; summary?: string; status?: string; hangoutLink?: string;
  start?: { dateTime?: string }; end?: { dateTime?: string };
  attendees?: { email?: string }[];
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}
interface NativeArtifact {
  name: string; state: string;
  docsDestination?: { document?: string; exportUri?: string };
  driveDestination?: { file?: string; exportUri?: string };
}

function database() {
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("Connect the MTOS database before using Google meetings.");
  return db;
}

async function tokenFor(context: TenantContext) {
  if (!context.userId || ["unknown", "system-cron"].includes(context.userId)) throw new Error("Sign in to connect your own Google meetings.");
  let connection = await getIntegrationConnection(context, "google-meet");
  if (!connection || connection.status !== "connected") throw new Error("Connect Google Meet in Settings > Integrations.");
  if (getMissingIntegrationScopes("google-meet", connection).length) throw new Error("Reconnect Google Meet in Settings > Integrations to approve meeting controls and file sharing.");
  if (!connection.tokenExpiresAt || Date.parse(connection.tokenExpiresAt) < Date.now() + 600_000) {
    await refreshIntegration(context, "google-meet");
    connection = await getIntegrationConnection(context, "google-meet");
  }
  if (!connection) throw new Error("Google Meet connection is unavailable.");
  const token = getIntegrationCredentials(connection).accessToken;
  if (!token) throw new Error("Reconnect Google Meet: no usable access token.");
  return token;
}

async function google<T>(token: string, url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method, cache: "no-store", signal: AbortSignal.timeout(25_000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Google request failed (${response.status}).`);
  return payload as T;
}

async function pages<T>(token: string, endpoint: string, field: string): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;
  const seen = new Set<string>();
  do {
    const url = new URL(endpoint);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result: Json = await google<Json>(token, url.toString());
    items.push(...((result[field] as T[] | undefined) || []));
    pageToken = result.nextPageToken as string | undefined;
    if (pageToken && seen.has(pageToken)) throw new Error("Google returned a repeated page token; meeting results are incomplete.");
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return items;
}

async function visibleTouch(context: TenantContext, touchId: string) {
  const source = getMtosDataSource(context);
  const touch = await source.getMonthlyTouchById(touchId);
  if (!touch) throw new Error("Monthly touch not found.");
  const client = await source.getClientById(touch.clientId);
  if (!client) throw new Error("This client is not available to your account.");
  return { touch, client };
}

async function calendarContext(token: string) {
  const calendar = await google<{ timeZone?: string }>(token, `${CALENDAR}/calendars/primary`);
  if (!calendar.timeZone) throw new Error("Google Calendar did not return a timezone; meeting dates cannot be matched safely.");
  return calendar.timeZone;
}

function eventUrl(event: CalendarEvent) {
  return event.hangoutLink || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri || "";
}

async function recordsFor(token: string, code?: string, days = 29) {
  const url = new URL(`${MEET}/conferenceRecords`);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  url.searchParams.set("filter", `${code ? `space.meeting_code = "${code}" AND ` : ""}start_time >= "${since}"`);
  url.searchParams.set("pageSize", "100");
  return pages<GoogleConference>(token, url.toString(), "conferenceRecords");
}

async function saveSelection(context: TenantContext, touchId: string, state: GoogleMeetingState, changingSelection = false) {
  const ref = database().doc(monthlyTouchPath(context.tenantId, touchId));
  await database().runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    if (changingSelection && ((current?.meetingSyncLeaseUntil || 0) > Date.now() || (current?.meetingAnalysisLeaseUntil || 0) > Date.now())) throw new Error("Meeting processing is running. Wait before selecting a different call.");
    if (changingSelection && current?.postMeeting?.transcript) throw new Error("This touch already has a transcript. Start a new touch for a different call.");
    tx.set(ref, { googleMeeting: { ...state, updatedAt: new Date().toISOString() } }, { mergeFields: ["googleMeeting"] });
  });
}

export async function getGoogleMeetingOverview(context: TenantContext, touchId: string): Promise<GoogleMeetingOverview> {
  const { touch, client } = await visibleTouch(context, touchId);
  const token = await tokenFor(context);
  const timeZone = await calendarContext(token);
  const now = Date.now();
  const historySince = new Date(now - 365 * 86400_000).toISOString();
  const historyUntil = new Date(now + 90 * 86400_000).toISOString();
  const url = new URL(`${CALENDAR}/calendars/primary/events`);
  for (const [key, value] of Object.entries({ timeMin: historySince, timeMax: historyUntil, singleEvents: "true", orderBy: "startTime", maxResults: "250" })) url.searchParams.set(key, value);
  const events = await pages<CalendarEvent>(token, url.toString(), "items");
  const emails = new Set((client.googleMeetingEmails || []).map((email) => email.toLowerCase()));
  const meetings: GoogleMeeting[] = [];
  for (const event of events) {
    const link = eventUrl(event);
    if (event.status === "cancelled" || !event.start?.dateTime || !meetingCode(link)) continue;
    const linked = event.id === (touch.googleMeeting?.calendarEventId || touch.calendarEventId);
    const byEmail = event.attendees?.some((attendee) => emails.has((attendee.email || "").toLowerCase()));
    const candidate = extractTitleCandidate(event.summary || "");
    const byTitle = scoreCandidateAgainstClient(client.name, candidate) === MATCH_STRENGTH.exact;
    if (!linked && !byEmail && !byTitle) continue;
    meetings.push({ eventId: event.id, title: event.summary || "Google Meet", start: event.start.dateTime, end: event.end?.dateTime || event.start.dateTime, url: link, match: linked ? "linked_event" : byEmail ? "client_email" : "client_title" });
  }
  const selection = touch.googleMeeting?.userId === context.userId ? touch.googleMeeting : undefined;
  const selectedEvent = meetings.find((event) => event.eventId === (selection?.calendarEventId || touch.calendarEventId));
  const selectedCode = meetingCode(selection?.meetingUrl || selectedEvent?.url || "");
  const conferences = selectedCode ? await recordsFor(token, selectedCode) : [];
  const completed = new Set<string>();
  const recentEvents = meetings.filter((event) => Date.parse(event.start) <= now && Date.parse(event.start) >= now - 29 * 86400_000);
  for (const code of new Set(recentEvents.map((event) => meetingCode(event.url)!))) {
    const records = code === selectedCode ? conferences : await recordsFor(token, code);
    for (const record of records) {
      const matchingEvent = recentEvents.some((event) => meetingCode(event.url) === code && Date.parse(record.startTime) >= Date.parse(event.start) - 30 * 60_000 && Date.parse(record.startTime) <= Date.parse(event.end) + 30 * 60_000);
      if (record.endTime && matchingEvent) completed.add(record.name);
    }
  }
  return { meetings, pastScheduledCount: meetings.filter((event) => Date.parse(event.start) < now).length, upcomingCount: meetings.filter((event) => Date.parse(event.start) >= now).length, historySince, historyUntil, timeZone, selection, conferences, completedConferenceCount: completed.size, conferenceHistorySince: new Date(now - 29 * 86400_000).toISOString() };
}

export async function selectGoogleMeeting(context: TenantContext, touchId: string, eventId: string, conferenceName?: string) {
  const { touch } = await visibleTouch(context, touchId);
  if (touch.postMeeting?.transcript) throw new Error("This touch already has a transcript. Start a new touch to attach a different call.");
  const overview = await getGoogleMeetingOverview(context, touchId);
  const event = overview.meetings.find((meeting) => meeting.eventId === eventId);
  if (!event) throw new Error("Choose a meeting listed for this client.");
  const token = await tokenFor(context);
  const records = await recordsFor(token, meetingCode(event.url));
  const conference = chooseConference(records, overview.timeZone, event.start, event.end, conferenceName);
  if (conferenceName && !conference) throw new Error("Choose a conference from today or yesterday for this meeting.");
  const previous = touch.googleMeeting;
  const sameRoom = previous?.userId === context.userId && meetingCode(previous.meetingUrl) === meetingCode(event.url);
  const state: GoogleMeetingState = { userId: context.userId, calendarEventId: eventId, meetingUrl: event.url, ...(sameRoom && previous.createdByMtos && previous.space ? { createdByMtos: true, space: previous.space } : {}), ...(conference ? { conference } : {}), status: "waiting" };
  await saveSelection(context, touchId, state, true);
  return state;
}

export async function createGoogleMeeting(context: TenantContext, touchId: string) {
  const { touch } = await visibleTouch(context, touchId);
  if (touch.googleMeeting?.meetingUrl || touch.postMeeting?.transcript) throw new Error("A call or transcript is already attached. Use the selected meeting or start a new touch.");
  const token = await tokenFor(context);
  const space = await google<{ name: string; meetingUri: string }>(token, `${MEET}/spaces`, "POST", {});
  const state: GoogleMeetingState = { userId: context.userId, meetingUrl: space.meetingUri, space: space.name, createdByMtos: true, status: "waiting" };
  await saveSelection(context, touchId, state, true);
  return state;
}

export async function pinGoogleConference(context: TenantContext, touchId: string, conferenceName: string) {
  const { touch } = await visibleTouch(context, touchId);
  const state = touch.googleMeeting;
  if (!state || state.userId !== context.userId) throw new Error("Select a meeting first.");
  const code = meetingCode(state.meetingUrl);
  if (!code) throw new Error("The meeting link is invalid.");
  const token = await tokenFor(context);
  const timeZone = await calendarContext(token);
  const conference = chooseConference(await recordsFor(token, code), timeZone, undefined, undefined, conferenceName);
  if (!conference) throw new Error("Select a conference from today or yesterday in this meeting room.");
  const updated = { ...state, conference, artifacts: [], status: "waiting" as const, message: "Exact conference selected." };
  await saveSelection(context, touchId, updated, true);
  return updated;
}

export async function endGoogleMeeting(context: TenantContext, touchId: string, conferenceName: string) {
  const { touch } = await visibleTouch(context, touchId);
  const state = touch.googleMeeting;
  if (!state?.createdByMtos || state.userId !== context.userId || !state.space) throw new Error("Google only permits MTOS to end calls it created. End this Calendar call from Google Meet.");
  const token = await tokenFor(context);
  const space = await google<{ activeConference?: { conferenceRecord: string } }>(token, `${MEET}/${state.space}`);
  if (!space.activeConference || space.activeConference.conferenceRecord !== conferenceName) throw new Error("The active call changed or already ended. Refresh before ending a call.");
  const conference = await google<GoogleConference>(token, `${MEET}/${conferenceName}`);
  await google(token, `${MEET}/${state.space}:endActiveConference`, "POST");
  await saveSelection(context, touchId, { ...state, conference, status: "waiting", message: "Call ended. Waiting for Google to finish preparing the files." });
}

async function ensureSupportEditor(context: TenantContext, token: string, id: string): Promise<void> {
  // Journal successful grants, not failed attempts. A later run retries permissions Google refused.
  const ref = database().doc(`tenants/${context.tenantId}/meetArtifactSharing/${createHash("sha256").update(`${id}:${SUPPORT}`).digest("hex")}`);
  const claim = randomUUID();
  const acquired = await database().runTransaction(async (tx) => {
    const existing = (await tx.get(ref)).data();
    if (existing?.role === "writer" || (existing?.leaseUntil || 0) > Date.now()) return false;
    tx.set(ref, { lease: claim, leaseUntil: Date.now() + 120_000 }, { merge: true });
    return true;
  });
  if (!acquired) {
    if ((await ref.get()).data()?.role === "writer") return;
    throw new Error("Sharing is already being processed; retry shortly.");
  }
  try {
    const url = new URL(`${DRIVE}/files/${encodeURIComponent(id)}/permissions`);
    url.searchParams.set("fields", "nextPageToken,permissions(id,emailAddress,role,type)");
    url.searchParams.set("supportsAllDrives", "true");
    const permissions = await pages<{ id: string; emailAddress?: string; role: string }>(token, url.toString(), "permissions");
    const existing = permissions.find((permission) => permission.emailAddress?.toLowerCase() === SUPPORT);
    if (!existing || !["writer", "owner", "organizer", "fileOrganizer"].includes(existing.role)) {
      if (existing) {
        await google(token, `${DRIVE}/files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(existing.id)}?supportsAllDrives=true`, "PATCH", { role: "writer" });
      } else {
        await google(token, `${DRIVE}/files/${encodeURIComponent(id)}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, "POST", { type: "user", role: "writer", emailAddress: SUPPORT });
      }
    }
    await ref.set({ role: "writer", email: SUPPORT, fileId: id, grantedAt: new Date().toISOString(), leaseUntil: 0 }, { merge: true });
  } catch (error) {
    await ref.set({ leaseUntil: 0, error: error instanceof Error ? error.message : "Sharing failed" }, { merge: true });
    throw error;
  }
}

async function collectArtifacts(context: TenantContext, token: string, conference: GoogleConference) {
  const transcripts = await pages<NativeArtifact>(token, `${MEET}/${conference.name}/transcripts`, "transcripts");
  const recordings = await pages<NativeArtifact>(token, `${MEET}/${conference.name}/recordings`, "recordings");
  const artifacts: GoogleMeetingArtifact[] = [];
  for (const [kind, list] of [["transcript", transcripts], ["recording", recordings]] as const) {
    for (const item of list) {
      const id = kind === "transcript" ? item.docsDestination?.document : item.driveDestination?.file;
      if (item.state !== "FILE_GENERATED" || !id) continue;
      const artifact: GoogleMeetingArtifact = { id, kind, url: kind === "transcript" ? `https://docs.google.com/document/d/${id}/edit` : `https://drive.google.com/file/d/${id}/view`, sharing: "editor" };
      try { await ensureSupportEditor(context, token, id); }
      catch (error) { artifact.sharing = "failed"; artifact.error = error instanceof Error ? error.message : "Sharing failed"; }
      artifacts.push(artifact);
    }
  }
  return { artifacts, transcripts, pending: [...transcripts, ...recordings].some((item) => item.state !== "FILE_GENERATED") };
}

export async function syncGoogleMeeting(context: TenantContext, touchId: string, analyze = true) {
  const { touch } = await visibleTouch(context, touchId);
  if (!touch.googleMeeting || touch.googleMeeting.userId !== context.userId) {
    const overview = await getGoogleMeetingOverview(context, touchId);
    const linked = overview.meetings.find((event) => event.eventId === touch.calendarEventId);
    if (!linked || !isRecentMeeting(linked.start, overview.timeZone)) throw new Error("Select this client's meeting from today or yesterday first.");
    await selectGoogleMeeting(context, touchId, linked.eventId);
  }
  const ref = database().doc(monthlyTouchPath(context.tenantId, touchId));
  const lease = randomUUID();
  await database().runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    if ((current?.meetingSyncLeaseUntil || 0) > Date.now()) throw new Error("This meeting is already syncing. Try again shortly.");
    tx.update(ref, { meetingSyncLease: lease, meetingSyncLeaseUntil: Date.now() + 10 * 60_000 });
  });
  try { return await syncSelectedMeeting(context, touchId, analyze); }
  finally {
    await database().runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data();
      if (current?.meetingSyncLease === lease) tx.update(ref, { meetingSyncLeaseUntil: 0 });
    });
  }
}

async function syncSelectedMeeting(context: TenantContext, touchId: string, analyze: boolean) {
  const { touch } = await visibleTouch(context, touchId);
  const token = await tokenFor(context);
  const timeZone = await calendarContext(token);
  let state = touch.googleMeeting!;
  if (state.userId !== context.userId) throw new Error("This meeting belongs to another connected user.");
  const code = meetingCode(state.meetingUrl);
  if (!code) throw new Error("Invalid Google Meet link.");
  const event = state.calendarEventId ? await google<CalendarEvent>(token, `${CALENDAR}/calendars/primary/events/${encodeURIComponent(state.calendarEventId)}`) : undefined;
  if (event && meetingCode(eventUrl(event)) !== code) throw new Error("The Calendar meeting link changed. Select the correct meeting again.");
  const records = await recordsFor(token, code);
  let conference = chooseConference(records, timeZone, event?.start?.dateTime, event?.end?.dateTime, state.conference?.name);
  // MTOS-created rooms are unique to this touch; still refuse multiple calls without selection.
  if (!conference && state.createdByMtos && !state.conference) {
    const recent = records.filter((record) => isRecentMeeting(record.startTime, timeZone));
    if (recent.length === 1) conference = recent[0];
  }
  if (!conference) throw new Error("No single matching call from today or yesterday. Choose the exact conference; MTOS will not guess.");
  const { artifacts, transcripts, pending } = await collectArtifacts(context, token, conference);
  state = { ...state, conference, artifacts, status: "waiting", message: "Waiting for the call to end and Google to prepare its transcript." };
  await saveSelection(context, touchId, state);
  const ready = transcripts.filter((item) => item.state === "FILE_GENERATED");
  if (!conference.endTime || !ready.length || transcripts.some((item) => item.state !== "FILE_GENERATED")) return state;
  const participants = await pages<{ name: string; signedinUser?: { displayName?: string }; anonymousUser?: { displayName?: string }; phoneUser?: { displayName?: string } }>(token, `${MEET}/${conference.name}/participants`, "participants");
  const names = new Map(participants.map((person) => [person.name, person.signedinUser?.displayName || person.anonymousUser?.displayName || person.phoneUser?.displayName || person.name]));
  const entries: { participant: string; text: string; startTime: string }[] = [];
  for (const transcript of ready) entries.push(...await pages<{ participant: string; text: string; startTime: string }>(token, `${MEET}/${transcript.name}/entries?pageSize=100`, "transcriptEntries"));
  const text = entries.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)).map((entry) => `[${entry.startTime}] ${names.get(entry.participant) || entry.participant}: ${entry.text}`).join("\n");
  if (text.trim().length < 40) {
    state = { ...state, message: "The transcript is empty or too short to analyze." };
    await saveSelection(context, touchId, state);
    return state;
  }
  const ref = database().doc(monthlyTouchPath(context.tenantId, touchId));
  state = { ...state, status: "ready", message: pending ? "Transcript ready; the recording is still processing." : "Transcript and available recording files retrieved." };
  await saveSelection(context, touchId, state);
  if (!analyze) return { ...state, transcript: text };
  const current = (await ref.get()).data();
  if (!current?.postMeeting?.transcript) {
    try {
      await analyzePostMeetingTranscript(context, touchId, text);
      state = { ...state, status: "analyzed", message: "Transcript analyzed. Review the draft follow-up before approving any actions." };
    } catch (error) {
      state = { ...state, status: "failed", message: error instanceof Error ? error.message : "Analysis failed; retry sync." };
    }
  } else {
    state = { ...state, status: current?.postMeeting?.transcript ? "analyzed" : "analyzing", message: current?.postMeeting?.transcript ? "An analysis already exists; your reviewed work was preserved." : "Transcript analysis is already running." };
  }
  await saveSelection(context, touchId, state);
  return state;
}

/** Durable scheduled sweep. Shares all accessible recent Meet artifacts, even without a touch.
 * Analysis runs only for an explicitly linked client/touch; no transcript content in cron logs.
 */
export async function runGoogleMeetingSweep() {
  const report: { tenantId: string; userId: string; status: string; detail?: string }[] = [];
  const deadline = Date.now() + 230_000;
  for (const tenantId of await listActiveTenantIds()) {
    const users = await database().collection(tenantUsersCollectionPath(tenantId)).get();
    for (const user of users.docs) {
      if (Date.now() > deadline) return { report, deferred: true };
      const context: TenantContext = { tenantId, userId: user.id, role: (user.data().role || "account_manager") as TenantContext["role"] };
      const connection = await getIntegrationConnection(context, "google-meet");
      if (connection?.status !== "connected") continue;
      try {
        const token = await tokenFor(context);
        // Retry delayed files for 3 days; today/yesterday matching is enforced separately for analysis.
        const conferences = await recordsFor(token, undefined, 3);
        let sharingFailures = 0;
        for (const conference of conferences) {
          if (Date.now() > deadline) return { report, deferred: true };
          const result = await collectArtifacts(context, token, conference);
          sharingFailures += result.artifacts.filter((artifact) => artifact.sharing === "failed").length;
        }
        const touches = await getMtosDataSource(context).getMonthlyTouches();
        const timeZone = await calendarContext(token);
        for (const touch of touches) {
          if (Date.now() > deadline) return { report, deferred: true };
          if (touch.googleMeeting ? touch.googleMeeting.userId !== user.id : !touch.calendarEventId || !touch.scheduledAt || !isRecentMeeting(touch.scheduledAt, timeZone)) continue;
          try { await syncGoogleMeeting(context, touch.id); }
          catch (error) { report.push({ tenantId, userId: user.id, status: "touch_deferred", detail: `${touch.id}: ${error instanceof Error ? error.message : "Sync failed"}` }); }
        }
        report.push({ tenantId, userId: user.id, status: sharingFailures ? "sharing_failed" : "processed", detail: `${conferences.length} recent conferences; ${sharingFailures} file sharing failures` });
      } catch (error) {
        report.push({ tenantId, userId: user.id, status: "failed", detail: error instanceof Error ? error.message : "Sync failed" });
      }
    }
  }
  return { report, deferred: false };
}
