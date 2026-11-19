import { createHash } from "node:crypto";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { NextTouchBooking, NextTouchBookingRequest } from "@/src/lib/contracts/next-touch-booking";
import { calendarSlotAvailable } from "@/src/lib/contracts/no-show";
import { resolveClientTimeZone } from "@/src/lib/contracts/client-time-zone";
import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { clientPath, monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { calendarAccessToken } from "./google-meet-service";
import { resolveRecipient } from "./confirmation-email-service";

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
interface Event { id: string; summary?: string; status?: string; description?: string; htmlLink?: string; hangoutLink?: string; transparency?: string; start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string }; attendees?: { email?: string; self?: boolean; responseStatus?: string }[]; extendedProperties?: { private?: Record<string, string> }; }
export const nextTouchEventId = (tenantId: string, touchId: string) => "mtos" + createHash("sha256").update(tenantId + ":" + touchId + ":next-monthly-touch").digest("hex");
async function request<T>(token: string, url: string, method = "GET", body?: unknown, allowMissing = false): Promise<T | undefined> {
  const response = await fetch(url, { method, cache: "no-store", signal: AbortSignal.timeout(25000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (allowMissing && response.status === 404) return;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Google Calendar returned ${response.status}.`);
  return data as T;
}
async function visible(context: TenantContext, touchId: string) {
  const source = getMtosDataSource(context); const touch = await source.getMonthlyTouchById(touchId);
  const client = touch && await source.getClientById(touch.clientId);
  if (!touch || !client) throw new Error("This Monthly Touch is not available to your account.");
  return { touch, client };
}
function fromEvent(event: Event, context: TenantContext, previous?: NextTouchBooking): NextTouchBooking {
  if (event.status === "cancelled" || !event.start?.dateTime || !event.end?.dateTime) throw new Error("The next meeting was cancelled or is no longer a timed event. Review it in Google Calendar.");
  return { status: "booked", eventId: event.id, ownerUserId: context.userId, scheduledAt: event.start.dateTime, endAt: event.end.dateTime, title: event.summary || "Monthly Touch", attendees: (event.attendees || []).flatMap(person => person.email ? [person.email] : []), description: event.description || "", ...(event.htmlLink ? { htmlLink: event.htmlLink } : {}), ...(event.hangoutLink ? { meetLink: event.hangoutLink } : {}), bookedAt: previous?.bookedAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
async function availability(token: string, durationMinutes: number, excludeId?: string) {
  const now = new Date(); const until = new Date(now.getTime() + 90 * 86400000);
  const calendars: { id: string; primary?: boolean; selected?: boolean; summary?: string }[] = [];
  let listPage = "";
  for (let page = 0; page < 4; page++) {
    const query = new URLSearchParams({ maxResults: "250", showHidden: "false", ...(listPage ? { pageToken: listPage } : {}) });
    const list = await request<{ items?: typeof calendars; nextPageToken?: string }>(token, "https://www.googleapis.com/calendar/v3/users/me/calendarList?" + query);
    calendars.push(...(list?.items || []).filter(calendar => calendar.primary || calendar.selected));
    listPage = list?.nextPageToken || ""; if (!listPage) break;
  }
  if (listPage || calendars.length > 20) throw new Error("Too many selected calendars to verify availability. Review your Google Calendar selection first.");
  if (!calendars.some(calendar => calendar.primary)) calendars.unshift({ id: "primary", primary: true, summary: "Primary calendar" });
  const results = await Promise.all(calendars.map(async calendar => {
    const events: Event[] = []; let pageToken = ""; let timeZone = "UTC";
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ timeMin: now.toISOString(), timeMax: until.toISOString(), singleEvents: "true", maxResults: "2500", ...(pageToken ? { pageToken } : {}) });
      const base = "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calendar.id) + "/events";
      const data = await request<{ items?: Event[]; nextPageToken?: string; timeZone?: string }>(token, base + "?" + query);
      if (!data) throw new Error("Google Calendar did not return availability.");
      events.push(...(data.items || [])); timeZone = data.timeZone || timeZone; pageToken = data.nextPageToken || ""; if (!pageToken) break;
    }
    if (pageToken) throw new Error("A selected calendar is too large to verify availability.");
    return { events, timeZone, primary: calendar.primary };
  }));
  return { durationMinutes, until: until.toISOString(), timeZone: results.find(result => result.primary)?.timeZone || "UTC", checkedAt: now.toISOString(), calendarCount: calendars.length,
    busy: results.flatMap(result => result.events.filter(event => event.id !== excludeId && event.status !== "cancelled" && event.transparency !== "transparent" && !event.attendees?.some(person => person.self && person.responseStatus === "declined")).map(event => ({ start: event.start?.dateTime || event.start?.date, end: event.end?.dateTime || event.end?.date, timeZone: result.timeZone }))) };
}
export async function readNextTouchAvailability(context: TenantContext, touchId: string, durationMinutes = 60) {
  const { touch, client } = await visible(context, touchId); const token = await calendarAccessToken(context);
  const eventId = nextTouchEventId(context.tenantId, touchId);
  const [slots, original, existing] = await Promise.all([
    availability(token, durationMinutes, eventId),
    touch.calendarEventId ? request<Event>(token, API + "/" + encodeURIComponent(touch.calendarEventId), "GET", undefined, true) : Promise.resolve(undefined),
    request<Event>(token, API + "/" + eventId, "GET", undefined, true),
  ]);
  const recipient = resolveRecipient(client, touch).recipient;
  const defaultAttendees = [...new Set([...(original?.attendees || []).flatMap(person => person.email ? [person.email] : []), ...(client.googleMeetingEmails || []), ...(recipient ? [recipient] : [])])];
  const booking = existing ? fromEvent(existing, context, touch.nextMeetingBooking) : undefined;
  if (booking && touch.nextMeetingBooking?.ownerUserId === context.userId) {
    const db = getFirebaseAdminDb();
    if (db) await db.doc(monthlyTouchPath(context.tenantId, touchId)).update({ nextMeetingBooking: booking });
  }
  return { ...slots, ...(booking ? { currentBooking: { start: booking.scheduledAt, end: booking.endAt } } : {}), clientTimeZone: resolveClientTimeZone(client).timeZone, defaultTitle: "Monthly Touch — " + client.name, defaultAttendees, ...(booking ? { booking } : {}) };
}
/** Refresh a saved booking from the same AM's Google calendar before using it in recap/completion. */
export async function readBookedNextMeeting(context: TenantContext, touchId: string) {
  const { touch } = await visible(context, touchId);
  if (!touch.nextMeetingBooking) return;
  if (touch.nextMeetingBooking.ownerUserId !== context.userId) throw new Error("The next meeting is on another AM's calendar. Confirm its details with them.");
  const token = await calendarAccessToken(context);
  const event = await request<Event>(token, API + "/" + nextTouchEventId(context.tenantId, touchId), "GET", undefined, true);
  if (!event) throw new Error("The booked next meeting is no longer in Google Calendar.");
  const booking = fromEvent(event, context, touch.nextMeetingBooking);
  const db = getFirebaseAdminDb();
  if (db) await db.doc(monthlyTouchPath(context.tenantId, touchId)).update({ nextMeetingBooking: booking });
  return booking;
}

export async function bookNextMonthlyTouch(context: TenantContext, touchId: string, input: NextTouchBookingRequest) {
  const { touch, client } = await visible(context, touchId);
  if (!input.confirmed || !Number.isInteger(input.durationMinutes) || input.durationMinutes < 15 || input.durationMinutes > 240 || !input.attendees.length || !input.title.trim()) throw new Error("Confirm the meeting details, duration and attendees before booking.");
  if (!["live", "follow"].includes(touch.progress || "") && !touch.followThrough?.startedAt) throw new Error("Book the next meeting during the Live Call or Follow-Through stage.");
  if (touch.nextMeetingBooking?.ownerUserId && touch.nextMeetingBooking.ownerUserId !== context.userId) throw new Error("This next meeting belongs to the AM who booked it. Ask them to update it in their calendar.");
  const db = getFirebaseAdminDb(); if (!db) throw new Error("MTOS storage is unavailable.");
  const token = await calendarAccessToken(context, true); const eventId = nextTouchEventId(context.tenantId, touchId); const ref = db.doc(monthlyTouchPath(context.tenantId, touchId));
  const at = new Date().toISOString(); const scheduled = Date.parse(input.scheduledAt); const endAt = new Date(scheduled + input.durationMinutes * 60000).toISOString();
  const candidate: NextTouchBooking = { status: "creating", eventId, ownerUserId: context.userId, scheduledAt: input.scheduledAt, endAt, title: input.title, attendees: [...new Set(input.attendees.map(email => email.trim().toLowerCase()))], description: input.description, updatedAt: at };
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as MonthlyTouchRecord | undefined; if (!current) throw new Error("Monthly Touch not found.");
    const previous = current.nextMeetingBooking;
    if (previous?.ownerUserId && previous.ownerUserId !== context.userId) throw new Error("The next meeting belongs to another AM's calendar.");
    if (previous?.status === "creating" && Date.now() - Date.parse(previous.updatedAt || "") < 120000) throw new Error("A booking is in progress. Wait for it to finish before trying again.");
    tx.update(ref, { nextMeetingBooking: candidate });
  });
  try {
    const endpoint = API + "/" + eventId; const existing = await request<Event>(token, endpoint, "GET", undefined, true);
    if (existing && existing.extendedProperties?.private?.mtosSourceTouch !== touchId) throw new Error("The calendar event does not match this Monthly Touch. Review it in Google Calendar.");
    let event = existing;
    if (!existing || input.action === "update") {
      if (input.action === "update" && !existing) throw new Error("The saved next meeting no longer exists in Google Calendar. Refresh before booking.");
      const free = await availability(token, input.durationMinutes, eventId);
      if (!calendarSlotAvailable(input.scheduledAt, free, Date.now())) throw new Error("That time is no longer available. Refresh the calendar and choose another free block.");
      const timeZone = resolveClientTimeZone(client).timeZone || free.timeZone;
      const payload = { summary: input.title.trim(), description: input.description, start: { dateTime: input.scheduledAt, timeZone }, end: { dateTime: endAt, timeZone }, attendees: candidate.attendees.map(email => ({ email })), ...(!existing ? { id: eventId, extendedProperties: { private: { mtosSourceTouch: touchId, mtosClientId: client.id } }, conferenceData: { createRequest: { requestId: eventId, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}) };
      try { event = await request<Event>(token, (existing ? endpoint : API) + "?sendUpdates=all&conferenceDataVersion=1", existing ? "PATCH" : "POST", payload); }
      catch (error) {
        // Deterministic event IDs let a lost response be reconciled without creating a second invite.
        const recovered = await request<Event>(token, endpoint, "GET", undefined, true).catch(() => undefined);
        if (!recovered || recovered.extendedProperties?.private?.mtosSourceTouch !== touchId || (input.action === "update" && (Date.parse(recovered.start?.dateTime || "") !== scheduled || Date.parse(recovered.end?.dateTime || "") !== Date.parse(endAt) || recovered.summary !== input.title.trim() || (recovered.description || "") !== input.description || [...(recovered.attendees || [])].flatMap(person => person.email ? [person.email.toLowerCase()] : []).sort().join(",") !== [...candidate.attendees].sort().join(",")))) throw error;
        event = recovered;
      }
    }
    if (!event) throw new Error("Google Calendar did not confirm the booking.");
    const booking = fromEvent(event, context, touch.nextMeetingBooking);
    await db.runTransaction(async tx => {
      tx.update(ref, { nextMeetingBooking: booking });
      tx.update(db.doc(clientPath(context.tenantId, client.id)), { nextTouchStartAt: booking.scheduledAt, nextTouchEventId: booking.eventId });
    });
    return booking;
  } catch (error) {
    await ref.update({ nextMeetingBooking: { ...candidate, status: "unknown" } }).catch(() => undefined);
    throw error;
  }
}
