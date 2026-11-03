/**
 * What MTOS is allowed to do, read from the scopes a connection actually stored.
 *
 * Pure checks: no connection is read, no token is touched and nothing is granted. The point of
 * these is the four states and the difference between them -- the handoff's bug was a permission
 * that looked granted on one screen and not on another, and the fix is that there is now one
 * answer and it comes from the stored record.
 */
import type { IntegrationConnectionRecord } from "@/src/lib/contracts/integrations";
import {
  INTEGRATION_PERMISSIONS,
  permissionDetail,
  permissionState,
  permissionSummary,
  permissionsNeedingAttention,
  type PermissionStatus,
  type PermissionView,
} from "@/src/lib/contracts/integration-permissions";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAILED: ${label}`);
}

const CALENDAR_WRITE = "https://www.googleapis.com/auth/calendar.events";
const CALENDAR_READ = "https://www.googleapis.com/auth/calendar.readonly";

const calendarWrite = INTEGRATION_PERMISSIONS.find((entry) => entry.id === "calendar-write")!;
const calendarRead = INTEGRATION_PERMISSIONS.find((entry) => entry.id === "calendar-read")!;
const gmailSend = INTEGRATION_PERMISSIONS.find((entry) => entry.id === "gmail-send")!;

function connection(scopes: string[], status: IntegrationConnectionRecord["status"] = "connected") {
  return {
    providerId: "google-meet",
    providerName: "Google Meet",
    tenantId: "map-ranking",
    authMode: "oauth",
    status,
    category: "communications",
    connectedBy: "ana@mapranking.com",
    connectedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    scopes,
  } as IntegrationConnectionRecord;
}

function view(status: PermissionStatus): PermissionView {
  return { ...calendarRead, status, detail: permissionDetail(calendarRead, status) };
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

check("there are six permissions", INTEGRATION_PERMISSIONS.length === 6);
check("each has a distinct id", new Set(INTEGRATION_PERMISSIONS.map((entry) => entry.id)).size === 6);
// An AM deciding whether to reconnect needs to know what they get, not which string Google wants.
check(
  "no label is a scope string",
  INTEGRATION_PERMISSIONS.every((entry) => !entry.label.includes("googleapis.com") && !entry.label.includes("/")),
);
check("every one says what it is for", INTEGRATION_PERMISSIONS.every((entry) => entry.purpose.length > 30));
// Missing must never mean broken: every caller degrades, so every entry carries what it does instead.
check("every one carries a fallback", INTEGRATION_PERMISSIONS.every((entry) => entry.fallback.length > 30));
check("and says where that fallback shows up", INTEGRATION_PERMISSIONS.every((entry) => entry.usedBy.length > 5));
check(
  "the booking permission names the reminder ticket as its fallback",
  calendarWrite.fallback.includes("ticket"),
);

// ---------------------------------------------------------------------------
// The four states
// ---------------------------------------------------------------------------

check(
  "a connection holding the scope is granted",
  permissionState(calendarRead, connection([CALENDAR_READ]), [CALENDAR_READ]) === "granted",
);
// This is the real case the handoff describes: the scope was added to the definition after the AM
// connected, so the token on file does not carry it and no amount of re-reading will change that.
check(
  "a connection authorized before the scope was asked for needs re-consent",
  permissionState(calendarRead, connection([]), [CALENDAR_READ]) === "needs_reconsent",
);
check(
  "no connection is not_connected",
  permissionState(calendarRead, undefined, [CALENDAR_READ]) === "not_connected",
);
check(
  "a connection in error is not treated as connected",
  permissionState(calendarRead, connection([CALENDAR_READ], "error"), [CALENDAR_READ]) === "not_connected",
);
// The honest state: MTOS asks for no calendar write scope anywhere, so an AM cannot grant it by
// reconnecting, and telling them to try would send them round a loop that changes nothing.
check(
  "a scope MTOS never asks for is not_requested, not denied",
  permissionState(calendarWrite, connection([CALENDAR_READ]), [CALENDAR_READ]) === "not_requested",
);
check(
  "even when the connection somehow holds it, the definition decides whether it is asked for",
  permissionState(calendarWrite, connection([CALENDAR_WRITE]), [CALENDAR_READ]) === "not_requested",
);
check(
  "and it is granted once the definition asks for it and the connection has it",
  permissionState(calendarWrite, connection([CALENDAR_WRITE]), [CALENDAR_WRITE]) === "granted",
);

// ---------------------------------------------------------------------------
// What the AM is told
// ---------------------------------------------------------------------------

check("granted says so in one short sentence", permissionDetail(calendarRead, "granted") === "Granted. MTOS can do this.");
check(
  "needing re-consent says where to go",
  permissionDetail(calendarRead, "needs_reconsent").includes("Settings → Integrations"),
);
check(
  "and still says what happens meanwhile",
  permissionDetail(calendarRead, "needs_reconsent").includes(calendarRead.fallback),
);
check(
  "not connected names the provider in plain words",
  permissionDetail(gmailSend, "not_connected").startsWith("Gmail is not connected"),
);
// The one sentence that stops an AM reconnecting over and over for something reconnecting cannot fix.
check(
  "not asked for says reconnecting will not fix it",
  permissionDetail(calendarWrite, "not_requested").includes("reconnecting will"),
);
check(
  "and that it is a change to the Google app",
  permissionDetail(calendarWrite, "not_requested").includes("Google app"),
);

// ---------------------------------------------------------------------------
// The chip
// ---------------------------------------------------------------------------

check("nothing to do counts zero", permissionsNeedingAttention([view("granted")]).length === 0);
check("re-consent counts", permissionsNeedingAttention([view("needs_reconsent")]).length === 1);
check("not connected counts", permissionsNeedingAttention([view("not_connected")]).length === 1);
// A chip that can never reach zero is a chip people learn to ignore.
check("a permission MTOS does not ask for never counts", permissionsNeedingAttention([view("not_requested")]).length === 0);

const mixed = [view("granted"), view("granted"), view("needs_reconsent"), view("not_requested")];
check("the summary counts what is granted", permissionSummary(mixed).startsWith("2 of 4 permissions granted"));
check("names what needs attention", permissionSummary(mixed).includes("1 needs attention"));
check("and is honest about what cannot be granted", permissionSummary(mixed).includes("does not ask for yet"));
check(
  "a clean set says nothing about attention",
  !permissionSummary([view("granted")]).includes("attention"),
);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - reading a real connection, which needs a stored OAuth record");
console.log("  - whether Google honours a scope once granted, which only a live call shows");
if (failed) process.exit(1);
