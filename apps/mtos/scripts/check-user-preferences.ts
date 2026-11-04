/**
 * The per-user preferences: what is stored, what is dropped, and what every unset field means.
 *
 * Pure checks: nothing is read from or written to Firestore. The preferences decide which screen
 * an AM lands on, how long a call guide is written for, and which address a client email goes out
 * from, so what the normalizer accepts is worth pinning exactly.
 */
import {
  CALL_LENGTH_CHOICES,
  DEFAULT_PREFERENCES,
  PREFERENCE_GROUPS,
  PREP_REVIEW_REMINDERS,
  START_PAGES,
  THEME_CHOICES,
  changedPreferenceCount,
  isStartPage,
  isTimeZone,
  normalizePreferences,
  notWiredPreferenceLabels,
  resolvePreferences,
  type NotificationPreferences,
  type UserPreferences,
} from "@/src/lib/contracts/user-preferences";
import { CALL_LENGTH_OPTIONS, DEFAULT_CALL_LENGTH_MINUTES } from "@/src/lib/contracts/live-call";

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

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

check("an AM who never opened Settings has no stored preferences", Object.keys(normalizePreferences(undefined)).length === 0);
check("and resolves to the defaults", resolvePreferences(undefined).startPage === "/command-center");
check("the default theme is light, which is what the CSS paints first", DEFAULT_PREFERENCES.theme === "light");
check(
  "the default call length is the one the guide is written against",
  DEFAULT_PREFERENCES.callLengthMinutes === DEFAULT_CALL_LENGTH_MINUTES,
);
check("the call lengths are the live-call contract's, not a second list", CALL_LENGTH_CHOICES === CALL_LENGTH_OPTIONS);
check("highlight facts starts off", DEFAULT_PREFERENCES.highlightFacts === false);
check("QA chips in presenter view start on", DEFAULT_PREFERENCES.qaChipsInPresenterView === true);
// The digests send real email to the AM's own address, so nobody starts receiving mail because of
// a default somebody else chose.
check("neither digest ships on", !DEFAULT_PREFERENCES.notifications.dailyDigest && !DEFAULT_PREFERENCES.notifications.weeklyDigest);
check("every notification flag has a default", Object.keys(DEFAULT_PREFERENCES.notifications).length === 5);

// ---------------------------------------------------------------------------
// What is kept
// ---------------------------------------------------------------------------

const full: UserPreferences = {
  displayName: "Francisco Poet",
  jobTitle: "Senior Account Manager",
  timeZone: "America/Phoenix",
  emailSignoff: "Francisco\nMap Ranking",
  clientEmailsSendThrough: "francisco@mapranking.com",
  theme: "dark",
  startPage: "/monthly-touch",
  highlightFacts: true,
  liveCallFormat: "deck",
  callLengthMinutes: 60,
  prepReviewReminder: "2d",
  chartsInReviewBrief: false,
  ccOfficeContact: true,
  qaChipsInPresenterView: false,
  notifications: { dailyDigest: true, prepFinished: false },
};

const kept = normalizePreferences(full);
check("every field of a complete set survives", Object.keys(kept).length === Object.keys(full).length);
check("the theme is kept", kept.theme === "dark");
check("the start page is kept", kept.startPage === "/monthly-touch");
check("the call length is kept", kept.callLengthMinutes === 60);
check("the two notification flags given are kept", Object.keys(kept.notifications || {}).length === 2);
check(
  "and the three not given resolve to their defaults",
  resolvePreferences(kept).notifications.overdueFollowThrough === true &&
    resolvePreferences(kept).notifications.weeklyDigest === false,
);
check("a name is trimmed", normalizePreferences({ displayName: "  Ana  " }).displayName === "Ana");
// The sign-off is the one text field whose shape is the AM's: its newlines and leading spaces are
// how the email reads, so it is length-capped and otherwise left exactly as typed.
check(
  "the sign-off keeps its own line breaks and spacing",
  normalizePreferences({ emailSignoff: "Ana\n  Map Ranking" }).emailSignoff === "Ana\n  Map Ranking",
);
check("an empty string clears a field rather than being ignored", normalizePreferences({ displayName: "" }).displayName === "");

// ---------------------------------------------------------------------------
// What is dropped
// ---------------------------------------------------------------------------

check("an unknown field is dropped", !("nope" in normalizePreferences({ nope: 1 })));
check("a theme we do not have is dropped", normalizePreferences({ theme: "sepia" }).theme === undefined);
// This value is handed to a redirect, so anything outside our own pages must never reach it.
check("a start page outside the app is dropped", normalizePreferences({ startPage: "https://example.com" }).startPage === undefined);
check("and so is a path we do not own", normalizePreferences({ startPage: "/admin" }).startPage === undefined);
check("every offered start page passes its own guard", START_PAGES.every((page) => isStartPage(page.value)));
// A length from anywhere else would scale the guide to a call nobody books, and the guide is what
// the AM reads out loud.
check("a call length nobody books is dropped", normalizePreferences({ callLengthMinutes: 37 }).callLengthMinutes === undefined);
check("a call length as a string is dropped", normalizePreferences({ callLengthMinutes: "60" }).callLengthMinutes === undefined);
check("a made-up time zone is dropped", normalizePreferences({ timeZone: "Mars/Olympus" }).timeZone === undefined);
check("a real time zone passes", isTimeZone("Europe/Madrid"));
check("an empty time zone does not", !isTimeZone("   "));
check("a switch given a string is dropped", normalizePreferences({ highlightFacts: "yes" }).highlightFacts === undefined);
check("a notification flag given a number is dropped", normalizePreferences({ notifications: { dailyDigest: 1 } }).notifications === undefined);
check("notifications given a string are dropped", normalizePreferences({ notifications: "all" }).notifications === undefined);
check("a reminder we do not offer is dropped", normalizePreferences({ prepReviewReminder: "1h" }).prepReviewReminder === undefined);
check("every offered reminder is accepted", PREP_REVIEW_REMINDERS.every((value) => normalizePreferences({ prepReviewReminder: value }).prepReviewReminder === value));
check("every offered theme is accepted", THEME_CHOICES.every((value) => normalizePreferences({ theme: value }).theme === value));
check("a non-object is no preferences at all", Object.keys(normalizePreferences("dark")).length === 0);

// A long paste into a text field is cut rather than stored whole: these end up in the sidebar and
// in a client's inbox.
check("a very long name is cut", (normalizePreferences({ displayName: "x".repeat(500) }).displayName || "").length === 120);

// ---------------------------------------------------------------------------
// "N away from the defaults"
// ---------------------------------------------------------------------------

check("nothing stored is nothing changed", changedPreferenceCount(undefined) === 0);
check("an empty object is nothing changed", changedPreferenceCount({}) === 0);
check("a preference set to its own default does not count", changedPreferenceCount({ theme: "light" }) === 0);
check("a real change counts once", changedPreferenceCount({ theme: "dark" }) === 1);
check(
  "a changed notification flag counts",
  changedPreferenceCount({ notifications: { dailyDigest: true } }) === 1,
);
check(
  "a notification flag set to its default does not",
  changedPreferenceCount({ notifications: { prepFinished: true } }) === 0,
);
const everyField = Object.keys(DEFAULT_PREFERENCES).length - 1 + Object.keys(DEFAULT_PREFERENCES.notifications).length;
check("a fully changed set counts every field", changedPreferenceCount(full) === everyField - countUnchanged(full));

function countUnchanged(value: UserPreferences): number {
  // `full` sets two notification flags away from their defaults and leaves three alone, so the
  // three it leaves alone are the only unchanged fields in it.
  const flags = Object.keys(DEFAULT_PREFERENCES.notifications) as (keyof NotificationPreferences)[];
  return flags.filter((flag) => (value.notifications || {})[flag] === undefined).length;
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

const fields = PREFERENCE_GROUPS.flatMap((group) => group.fields);
check("there are four groups", PREFERENCE_GROUPS.length === 4);
check("every field says where it takes effect", fields.every((field) => field.hint.length > 25));
check("every select offers options", fields.filter((field) => field.kind === "select").every((field) => (field.options || []).length >= 2));
check(
  "every field maps to something the contract stores",
  fields.every((field) =>
    field.key.startsWith("notifications.")
      ? field.key.slice("notifications.".length) in DEFAULT_PREFERENCES.notifications
      : field.key in DEFAULT_PREFERENCES,
  ),
);
check(
  "every stored preference is on the screen",
  Object.keys(DEFAULT_PREFERENCES)
    .filter((key) => key !== "notifications")
    .every((key) => fields.some((field) => field.key === key)),
);
check(
  "and so is every notification flag",
  Object.keys(DEFAULT_PREFERENCES.notifications).every((flag) =>
    fields.some((field) => field.key === `notifications.${flag}`),
  ),
);
check("no field is listed twice", new Set(fields.map((field) => field.key)).size === fields.length);
// The honest part: only what nothing reads yet is marked, and once a sender exists the mark goes.
const notWired = notWiredPreferenceLabels();
check("nothing is marked as recorded but not yet acted on", notWired.length === 0);
check(
  "the charts switch is no longer marked, because the brief draws them",
  fields.find((field) => field.key === "chartsInReviewBrief")?.notWiredYet !== true,
);
check(
  "no notification switch is marked any more",
  PREFERENCE_GROUPS.find((group) => group.id === "notifications")?.fields.every((field) => !field.notWiredYet) === true,
);
// The group has to say where each kind is delivered, because the two channels are not the same.
check(
  "the notifications group names both channels",
  (() => {
    const subtitle = PREFERENCE_GROUPS.find((group) => group.id === "notifications")?.subtitle || "";
    return subtitle.includes("notifications in the header") && subtitle.includes("emailed");
  })(),
);
check("the prep reminder is no longer marked", fields.find((field) => field.key === "prepReviewReminder")?.notWiredYet !== true);
check(
  "every field that does work is not marked",
  [
    "theme",
    "startPage",
    "highlightFacts",
    "liveCallFormat",
    "callLengthMinutes",
    "timeZone",
    "emailSignoff",
    "prepReviewReminder",
  ].every((key) => fields.find((field) => field.key === key)?.notWiredYet !== true),
);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the Firestore read and write, which need a real tenant document");
console.log("  - whether the browser applies the theme before first paint, which is the layout script");
if (failed) process.exit(1);
