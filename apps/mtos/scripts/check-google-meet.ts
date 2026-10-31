import assert from "node:assert/strict";
import { chooseConference, isRecentMeeting, meetingCode } from "@/src/lib/server/services/google-meet-matching";
import type { GoogleConference } from "@/src/lib/contracts/google-meet";

// Synthetic fixtures: no claim that these are actual meetings or live API results.
const now = new Date("2026-11-02T08:30:00Z");
const zone = "America/Los_Angeles";
assert.equal(isRecentMeeting("2026-11-01T07:30:00Z", zone, now), true, "yesterday across the DST fall-back");
assert.equal(isRecentMeeting("2026-10-31T23:30:00Z", zone, now), false, "two local dates ago is excluded");
assert.equal(isRecentMeeting("2026-11-02T09:30:00Z", zone, now), false, "future meetings cannot supply a transcript");
assert.equal(isRecentMeeting("bad date", zone, now), false);
assert.equal(meetingCode("https://meet.google.com/abc-defg-hij"), "abc-defg-hij");
assert.equal(meetingCode("https://meet.google.com.attacker.example/abc-defg-hij"), undefined);
assert.equal(meetingCode("javascript:alert(1)"), undefined);
assert.equal(meetingCode("http://meet.google.com/abc-defg-hij"), undefined);

const conference: GoogleConference = { name: "conferenceRecords/one", space: "spaces/room", startTime: "2026-11-02T07:45:00Z", endTime: "2026-11-02T08:15:00Z" };
const redial: GoogleConference = { ...conference, name: "conferenceRecords/two", startTime: "2026-11-02T07:55:00Z" };
const old: GoogleConference = { ...conference, name: "conferenceRecords/old", startTime: "2026-10-30T07:45:00Z" };
const start = "2026-11-02T07:30:00Z";
const end = "2026-11-02T08:30:00Z";
assert.equal(chooseConference([conference], zone, start, end, undefined, now)?.name, conference.name);
assert.equal(chooseConference([conference, redial], zone, start, end, undefined, now), undefined, "ambiguous redials require explicit selection");
assert.equal(chooseConference([conference, redial], zone, start, end, redial.name, now)?.name, redial.name);
assert.equal(chooseConference([old], zone, start, end, old.name, now), undefined, "even explicit pins must satisfy the date window");
assert.equal(chooseConference([conference], zone, undefined, undefined, undefined, now), undefined, "a room alone does not identify a call");
assert.equal(chooseConference([conference], zone, "2026-11-02T01:00:00Z", "2026-11-02T02:00:00Z", undefined, now), undefined, "a different occurrence of a reused link must not match");
const tokyoNow = new Date("2026-11-01T15:05:00Z");
assert.equal(isRecentMeeting("2026-10-31T15:10:00Z", "Asia/Tokyo", tokyoNow), true, "yesterday uses the user's local date");
console.log("Google Meet matching checks passed (synthetic fixtures, no Google calls).");
