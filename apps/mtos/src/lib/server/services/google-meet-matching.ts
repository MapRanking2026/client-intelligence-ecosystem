import type { GoogleConference } from "@/src/lib/contracts/google-meet";

export function meetingCode(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "meet.google.com") return;
    return /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/.exec(url.pathname)?.[1];
  } catch { return; }
}

export function isRecentMeeting(instant: string, timeZone: string, now = new Date()): boolean {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const start = new Date(instant);
  if (!Number.isFinite(start.getTime()) || start.getTime() > now.getTime()) return false;
  // Derive yesterday from the local calendar date, rather than subtracting 24h across DST.
  const parts = format.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const yesterdayNoon = new Date(Date.UTC(part("year"), part("month") - 1, part("day") - 1, 12));
  const yesterday = yesterdayNoon.toISOString().slice(0, 10);
  const dateKey = (date: Date) => {
    const p = format.formatToParts(date);
    return ["year", "month", "day"].map((type) => p.find((entry) => entry.type === type)?.value).join("-");
  };
  return dateKey(start) === dateKey(now) || dateKey(start) === yesterday;
}

export function chooseConference(
  records: GoogleConference[],
  timeZone: string,
  eventStart?: string,
  eventEnd?: string,
  pinnedName?: string,
  now = new Date(),
): GoogleConference | undefined {
  const recent = records.filter((record) => isRecentMeeting(record.startTime, timeZone, now));
  if (pinnedName) return recent.find((record) => record.name === pinnedName);
  // A recurring Meet link identifies a room, not a specific call. Require the selected
  // event's time window, and refuse multiple redials rather than choosing the longest.
  if (!eventStart || !isRecentMeeting(eventStart, timeZone, now)) return;
  const start = Date.parse(eventStart) - 30 * 60_000;
  const end = Date.parse(eventEnd || eventStart) + 30 * 60_000;
  const matches = recent.filter((record) => Date.parse(record.startTime) >= start && Date.parse(record.startTime) <= end);
  return matches.length === 1 ? matches[0] : undefined;
}
