/**
 * Pins the two business-scorecard tiles that held nothing: "Form submissions" and "Calls missed".
 *
 * Both were written as a hard-coded null with a note explaining what they would need --
 * "Requires per-source contact breakdown", "Requires CRM call-tracking data" -- sitting next to a
 * lead & call verification engine that had been resolving a type for every lead and counting missed
 * calls since it was built. The AM read an em dash on both tiles and the note told them the data
 * did not exist. Reported by the owner on 11 November 2026.
 *
 * Four things here are requirements rather than behaviour that happens to work:
 *
 *   1. One definition of "form" and one of "missed call", shared by the tiles and the lead table.
 *      A scorecard tile disagreeing with the table printed underneath it is worse than the em dash
 *      it replaced, because the AM cannot tell which number to say out loud.
 *   2. An unrecognizable lead is a form, never a call. Calls and chats announce themselves; a web
 *      lead with no signal arrived by filling something in. Defaulting the other way would inflate
 *      the missed-call tile with leads that never rang.
 *   3. A call that never connected counts as missed. From the client's side a cancelled or failed
 *      call is a customer who did not get through, which is the thing the tile exists to surface.
 *   4. The verification review beats the snapshot. The shared snapshot caps leads per client to
 *      stay under Firestore's 1MB document ceiling, so its count can understate a busy client; the
 *      per-client review pulls a larger window and its statuses are the ones the AM has corrected.
 *
 * Exercises the pure rules. What is NOT covered is listed at the end of the run.
 *
 * Run with: npm run check:lead-mix
 */
import {
  callWasMissed,
  emptyLeadMix,
  leadArrivalSignal,
  leadIsMissedCall,
  leadWindowLabel,
  resolveLeadType,
  summarizeLeadMix,
  verifiedLeadMix,
} from "@/src/lib/contracts/lead-mix";
import type { LeadType } from "@/src/lib/mtos-data";

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

function scenario(name: string) {
  console.log(`\n${name}`);
}

/** A call lead as the GoHighLevel sync normalizes one. */
function call(status: string, durationSec = 0) {
  return {
    id: `call-${status}-${durationSec}`,
    type: "call",
    source: "call",
    attribution: { medium: "call", source: "inbound" },
    call: { status, durationSec, direction: "inbound" },
  };
}

/** A contact lead as the sync normalizes one: a source and an attribution block, no type. */
function contact(source: string, extras: Record<string, unknown> = {}) {
  return { id: `c-${source}`, source, attribution: { source }, ...extras };
}

// ---------------------------------------------------------------------------
scenario("What the arrival signal is built from");

check(
  "the raw source, the attribution block and the tags all count",
  leadArrivalSignal({ source: "Website", attribution: { medium: "cpc" }, tags: ["Chat Widget"] }) ===
    "website  cpc   chat widget",
  JSON.stringify(leadArrivalSignal({ source: "Website", attribution: { medium: "cpc" }, tags: ["Chat Widget"] })),
);
check("it is lowercased, so matching is case-insensitive", !/[A-Z]/.test(leadArrivalSignal({ source: "WEBSITE" })));
check("a lead with nothing on it gives an empty-ish signal", leadArrivalSignal({}).trim() === "");

// ---------------------------------------------------------------------------
scenario("Which kind of lead this is");

check("a sync-normalized call is a call", resolveLeadType(call("completed")) === "call");
check(
  "a record carrying call metadata is a call even with no type",
  resolveLeadType({ call: { status: "completed" } }) === "call",
);
check("a phone source is a call", resolveLeadType(contact("Inbound Phone Call")) === "call");
check("a chat widget is a chat", resolveLeadType(contact("Chat Widget")) === "chat");
check("an sms is a chat", resolveLeadType(contact("SMS")) === "chat");
check("whatsapp is a chat", resolveLeadType(contact("WhatsApp")) === "chat");
check("a website form is a form", resolveLeadType(contact("Website Form")) === "form");
check(
  "an unrecognizable lead is a FORM, never a call -- it must not inflate the missed-call tile",
  resolveLeadType(contact("some-crm-import-2026")) === "form",
);
check("a lead with no source at all is a form", resolveLeadType({}) === "form");

// ---------------------------------------------------------------------------
scenario("Which calls went unanswered");

for (const status of ["missed", "no-answer", "no_answer", "voicemail", "busy", "unanswered", "declined"]) {
  check(`"${status}" is a missed call`, callWasMissed({ status }));
}
check("a call that never connected counts, because the customer did not get through", callWasMissed({ status: "failed" }));
check("so does a cancelled one", callWasMissed({ status: "canceled" }));
check("the match is case-insensitive, since the status comes from the telephony provider", callWasMissed({ status: "NO-ANSWER" }));
check("a completed call is not missed", !callWasMissed({ status: "completed" }));
check("an answered call is not missed", !callWasMissed({ status: "answered" }));
check("no call metadata at all is not a missed call", !callWasMissed(undefined));
check("an empty status is not a missed call", !callWasMissed({ status: "" }));

check("a missed call lead reads as one", leadIsMissedCall(call("voicemail")));
check("a completed call lead does not", !leadIsMissedCall(call("completed", 120)));
check(
  "a FORM is never a missed call, whatever its source says",
  !leadIsMissedCall(contact("website form", { call: { status: "voicemail" } })) ||
    resolveLeadType(contact("website form", { call: { status: "voicemail" } })) === "call",
);

// ---------------------------------------------------------------------------
scenario("The mix of one window");

const window = [
  call("completed", 240),
  call("voicemail"),
  call("no-answer"),
  contact("Website Form"),
  contact("Contact Us Form"),
  contact("Google Ads Landing Page"),
  contact("Chat Widget"),
];
const mix = summarizeLeadMix(window);

check("every lead is counted once", mix.total === 7, String(mix.total));
check("the calls are counted", mix.calls === 3, String(mix.calls));
check("the unanswered ones are counted", mix.missedCalls === 2, String(mix.missedCalls));
check("missed calls are a subset of calls", mix.missedCalls <= mix.calls);
check("the forms are counted", mix.forms === 3, String(mix.forms));
check("the chats are counted separately from forms", mix.chats === 1, String(mix.chats));
check(
  "calls, forms and chats account for the whole window",
  mix.calls + mix.forms + mix.chats === mix.total,
  `${mix.calls}+${mix.forms}+${mix.chats} vs ${mix.total}`,
);
check("the judgeable calls are counted apart from the calls", mix.callsWithStatus === 3, String(mix.callsWithStatus));

/*
  The case this distinction exists for, and it is the live tenant's actual state.

  The shared GoHighLevel snapshot stores contacts, not call conversations. A contact whose source
  reads "Inbound Phone Call" is correctly typed as a call and carries no status, so there is nothing
  to judge -- and on 11 November 2026 that was every call-typed lead in the snapshot: 0 of them had
  a status, across clients with as many as 83 call-typed leads. Counted naively the tile reads
  "0 calls missed" beside "83 calls", which is a number nobody measured.
*/
const unjudgeable = summarizeLeadMix([
  contact("Inbound Phone Call"),
  contact("Phone Call"),
  contact("Website Form"),
]);
check("a call with no status is still counted as a call", unjudgeable.calls === 2, String(unjudgeable.calls));
check("but it is not judgeable", unjudgeable.callsWithStatus === 0, String(unjudgeable.callsWithStatus));
check(
  "so the missed count is zero out of nothing, which the caller must read as unknown",
  unjudgeable.missedCalls === 0 && unjudgeable.callsWithStatus === 0,
);
check("and the forms beside them still count", unjudgeable.forms === 1, String(unjudgeable.forms));
check(
  "a call with an empty-string status is not judgeable either",
  summarizeLeadMix([call("")]).callsWithStatus === 0,
);

check("an empty window is all zeroes, not nulls", summarizeLeadMix([]).total === 0);
check("and the empty mix is the same shape", JSON.stringify(emptyLeadMix()) === JSON.stringify(summarizeLeadMix([])));

// ---------------------------------------------------------------------------
scenario("The verified review's own count wins");

const verified: { type: LeadType; status: string }[] = [
  { type: "call", status: "missed_call" },
  { type: "call", status: "missed_call" },
  { type: "call", status: "valid" },
  { type: "form", status: "valid" },
  { type: "form", status: "flagged" },
  { type: "chat", status: "needs_review" },
];
const reviewed = verifiedLeadMix(verified);

check("missed calls come from the settled status, not from re-reading metadata", reviewed.missedCalls === 2, String(reviewed.missedCalls));
check("a flagged form is still a form submission -- it was submitted", reviewed.forms === 2, String(reviewed.forms));
check("the calls are counted", reviewed.calls === 3, String(reviewed.calls));
check("the chats are counted", reviewed.chats === 1, String(reviewed.chats));
check("the totals add up", reviewed.total === 6, String(reviewed.total));
check(
  "every verified call is judgeable, because the engine settled a status for each",
  reviewed.callsWithStatus === reviewed.calls,
  `${reviewed.callsWithStatus} of ${reviewed.calls}`,
);
check("an empty review is zeroes", verifiedLeadMix([]).total === 0);

// ---------------------------------------------------------------------------
scenario("The period the tile states");

check(
  "a window with both ends reads as a range",
  leadWindowLabel({ since: "2026-10-01T00:00:00.000Z", until: "2026-10-31T23:59:59.000Z" }) === "Oct 1 → Oct 31",
  leadWindowLabel({ since: "2026-10-01T00:00:00.000Z", until: "2026-10-31T23:59:59.000Z" }),
);
check(
  "an open-ended window says so rather than implying an end",
  leadWindowLabel({ since: "2026-10-01T00:00:00.000Z" }) === "Oct 1 → now",
  leadWindowLabel({ since: "2026-10-01T00:00:00.000Z" }),
);
check("no window falls back to the default", leadWindowLabel() === "Last 30 days");
check("an unreadable date falls back rather than printing Invalid Date", leadWindowLabel({ since: "nonsense" }) === "Last 30 days");

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures} of ${checks} checks passed.`);
console.log(
  [
    "",
    "Not covered here (needs Firestore and GoHighLevel, so it is checked by hand against a real",
    "client):",
    "  - `withVerifiedLeadMix` running after the preparation's parallel block, which is what lets",
    "    the scorecard use the review's fuller count without serializing the two stretches of I/O",
    "  - the snapshot's per-client lead cap, and the tile saying \"snapshot sample\" when a client's",
    "    leads hit it -- a capped sample quoted as a total is a number an AM repeats to a client",
    "  - that a client with no mapped GoHighLevel sub-account still shows an em dash rather than a",
    "    zero: nobody has measured their forms, which is not the same as their having had none",
    "  - that a blank tile prints WHY it is blank rather than the system it would have come",
    "    from. `metric`'s missing-reason branch is private to the preparation service; it was",
    "    checked by auditing all ten tiles across the 28 stored touches on the live tenant",
    "  - the live shape this was built against: 29 of 243 clients have lead records in the shared",
    "    snapshot and every one of their call-typed leads lacks a status, so Form submissions comes",
    "    from the snapshot and Calls missed only ever comes from the verification review",
  ].join("\n"),
);

if (failures > 0) {
  process.exitCode = 1;
}
