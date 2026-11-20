/**
 * "Good morning" has to mean it is morning where the reader is.
 *
 * The greeting was computed with `date.getHours()`, which is the hour on the SERVER's clock --
 * and the server runs in UTC. For everybody in the Americas that turned the evening into UTC's
 * small hours, so the Command Center said "Good morning" at nine at night, every night. It is
 * the first line of the first screen after signing in, so it was also the first thing in the app
 * that was visibly wrong.
 *
 * The zone is the one in the AM's own settings. Nothing here guesses it from the server, from the
 * browser or from the data.
 *
 * Run with: npm run check:greeting
 */
import { greetingFor } from "@/src/lib/server/services/command-center-v2-service";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`FAILED: ${label}`);
  }
}

/** 03:00 UTC on a Friday: late Thursday evening on the US west coast. */
const lateEveningInLA = new Date("2026-11-20T03:00:00Z");
check(
  "nine at night in Los Angeles is an evening",
  greetingFor(lateEveningInLA, "America/Los_Angeles").part === "evening",
);
check(
  "the same instant is still the small hours in UTC",
  greetingFor(lateEveningInLA, "UTC").part === "morning",
);
check("and it says so in words", greetingFor(lateEveningInLA, "America/Los_Angeles").label === "Good evening.");

check("eight in the morning in Los Angeles is a morning", greetingFor(new Date("2026-11-20T16:00:00Z"), "America/Los_Angeles").part === "morning");

// One instant, two readers: early afternoon on the west coast is late evening in Madrid, and each
// of them should be greeted for the hour they are actually living in.
const earlyAfternoonInLA = new Date("2026-11-20T21:00:00Z");
check("one in the afternoon in Los Angeles is an afternoon", greetingFor(earlyAfternoonInLA, "America/Los_Angeles").part === "afternoon");
check("the same instant is an evening in Madrid", greetingFor(earlyAfternoonInLA, "Europe/Madrid").part === "evening");

// The boundaries, because an off-by-one here is a greeting that is wrong for a whole hour.
check("noon is the first afternoon hour", greetingFor(new Date("2026-11-20T12:00:00Z"), "UTC").part === "afternoon");
check("11:59 is still morning", greetingFor(new Date("2026-11-20T11:59:00Z"), "UTC").part === "morning");
check("six is the first evening hour", greetingFor(new Date("2026-11-20T18:00:00Z"), "UTC").part === "evening");
check("17:59 is still afternoon", greetingFor(new Date("2026-11-20T17:59:00Z"), "UTC").part === "afternoon");
// Midnight is reported as hour 24 by some ICU builds; both ends of the day are the same hour.
check("midnight is a morning, not an hour past the end of the day", greetingFor(new Date("2026-11-20T00:00:00Z"), "UTC").part === "morning");

// A zone name Intl does not know throws rather than falling back on its own, so it is caught and
// read in UTC. Wrong for some readers, but not a zone invented for them.
check("an unknown zone does not take the page down", greetingFor(earlyAfternoonInLA, "Mars/Olympus").part === "evening");
check("an empty zone does not either", greetingFor(earlyAfternoonInLA, "").part === "evening");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - whether the AM's stored time zone is the one they are actually in");
console.log("  - the day-boundary queries (today's calls, this week), which still use the server's day");
if (failed) process.exitCode = 1;
