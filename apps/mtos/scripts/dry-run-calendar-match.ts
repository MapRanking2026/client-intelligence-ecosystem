/**
 * Dry run: matches real calendar events against real clients and prints the result. Writes nothing.
 */
import { readFileSync } from "node:fs";
import { createDecipheriv, createHash } from "node:crypto";

import admin from "firebase-admin";

import {
  matchCalendarEventsToClients,
  selectLastTouchPerClient,
  selectNextTouchPerClient,
  type CalendarEventLike,
} from "@/src/lib/server/calendar-touch-matching";

async function main() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }

  const key = createHash("sha256").update(env.MTOS_INTEGRATIONS_SECRET).digest();
  function unseal(ciphertext: string) {
    const b = Buffer.from(ciphertext, "base64url");
    const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"));
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
  const db = admin.firestore();
  const TENANT = "map-ranking";

  const creds = unseal(
    (await db.doc(`tenants/${TENANT}/integrations/google-calendar`).get()).data()!.credentialCiphertext,
  );

  const now = new Date();
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", new Date(now.getTime() - 90 * 864e5).toISOString());
  url.searchParams.set("timeMax", new Date(now.getTime() + 90 * 864e5).toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "2500");

  const body = (await (await fetch(url, { headers: { Authorization: `Bearer ${creds.accessToken}` } })).json()) as {
    items?: Array<{
      id?: string;
      summary?: string;
      status?: string;
      start?: { dateTime?: string; date?: string };
      attendees?: Array<{ email?: string }>;
    }>;
  };

  const events: CalendarEventLike[] = (body.items || [])
    .filter((e) => e.status !== "cancelled" && e.summary)
    .map((e) => ({
      id: e.id || "",
      summary: e.summary || "",
      startIso: e.start?.dateTime || e.start?.date || "",
      attendeeEmails: (e.attendees || []).map((a) => a.email || "").filter(Boolean),
    }))
    .filter((e) => e.id && e.startIso);

  const clientsSnap = await db.collection(`tenants/${TENANT}/clients`).get();
  const clients = clientsSnap.docs.map((d) => ({ id: d.id, name: String(d.data().name || "") })).filter((c) => c.name);

  console.log(`events: ${events.length}   clients: ${clients.length}`);

  const matches = matchCalendarEventsToClients(events, clients);
  const byReason = matches.reduce<Record<string, number>>((acc, m) => {
    acc[m.reason] = (acc[m.reason] || 0) + 1;
    return acc;
  }, {});
  console.log(`\nmatched events: ${matches.length}`, byReason);

  console.log("\n=== matches ===");
  for (const m of matches.sort((a, b) => a.startIso.localeCompare(b.startIso))) {
    console.log(
      `${m.startIso.slice(0, 10)}  ${m.reason === "title" ? "T" : "E"}  ${JSON.stringify(m.summary).padEnd(60).slice(0, 60)} -> ${m.clientName}`,
    );
  }

  const nowIso = now.toISOString();
  const next = selectNextTouchPerClient(matches, nowIso);
  const last = selectLastTouchPerClient(matches, nowIso);
  console.log(`\nclients with an UPCOMING touch: ${next.size}`);
  for (const [, m] of next) console.log(`  ${m.startIso.slice(0, 10)}  ${m.clientName}  <- ${JSON.stringify(m.summary)}`);
  console.log(`\nclients with a PAST touch: ${last.size}`);

  // Surface touch-marked events that found no client, so misses are visible rather than silent.
  const matchedIds = new Set(matches.map((m) => m.eventId));
  const missed = events.filter(
    (e) => !matchedIds.has(e.id) && /\bap+ointment\b|\bmonthly\s*touch\b/i.test(e.summary),
  );
  console.log(`\n=== touch-marked events with NO client match: ${missed.length} ===`);
  for (const e of missed.slice(0, 30)) {
    console.log(`  ${e.startIso.slice(0, 10)}  ${JSON.stringify(e.summary)}  ${(e.attendeeEmails || []).join(",")}`);
  }
  process.exit(0);

}

void main();
