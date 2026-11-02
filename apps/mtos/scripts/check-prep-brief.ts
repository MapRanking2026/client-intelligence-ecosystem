/**
 * Pins the Pre-Monthly Touch brief and its source chips.
 *
 * Four things here are requirements rather than behaviour that happens to work:
 *
 *   1. Two numbering systems, mapped. The preparation agent numbers its sections the way the
 *      manual skill does (R, 0, 1–16); the brief the AM reads is numbered 1–15. Both are in the
 *      handoff. The map is the only place that knows, and if it drifts the AM reads the snapshot
 *      under the heading "Retention assessment".
 *   2. A section the preparation could not write says so. A brief that silently omits the goal
 *      reads as a client with no goal.
 *   3. A malformed section costs that section, not the preparation. The six fields the call guide
 *      is built from are validated strictly elsewhere; everything here is read tolerantly, because
 *      the alternative is a blank screen half an hour before a client call.
 *   4. A source chip never invents a link. A transcript chip has to name the call it belongs to,
 *      and a URL that is not http(s) is dropped — a plausible wrong link is worse than no link.
 *
 * Run with: npm run check:prep-brief
 */
import {
  BRIEF_SECTIONS,
  DECLINABLE_SECTION_IDS,
  PROMPT_SECTION_TO_BRIEF,
  approvalSummary,
  approvedSectionIds,
  normalizePrepBrief,
  reviewSections,
  type BriefSectionId,
} from "@/src/lib/contracts/prep-brief";
import {
  RANK_TRACKER_FIND_CLIENT_URL,
  RANK_TRACKER_HEATMAP_URL,
  SOURCE_ICON,
  clickupTaskChip,
  findClientChip,
  intercomConversationChip,
  normalizeChips,
  rankTrackerChip,
  transcriptAnchor,
  transcriptChip,
} from "@/src/lib/contracts/brief-sources";

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

const PT = "America/Los_Angeles";

// ---------------------------------------------------------------------------
scenario("The sections of the brief");

check("the header, fifteen sections, in order", BRIEF_SECTIONS.length === 16);
check("the first is the header", BRIEF_SECTIONS[0].id === "h" && BRIEF_SECTIONS[0].n === "i");
check("the last is the client-facing agenda", BRIEF_SECTIONS[15].id === "15");
check(
  "fourteen sections can be declined",
  DECLINABLE_SECTION_IDS.length === 14,
  `${DECLINABLE_SECTION_IDS.length}`,
);
check(
  "the header and the client email cannot be declined",
  !DECLINABLE_SECTION_IDS.includes("h") && !DECLINABLE_SECTION_IDS.includes("15"),
);
check(
  "every section has a purpose line",
  BRIEF_SECTIONS.every((section) => section.purpose.trim().length > 10),
);

// ---------------------------------------------------------------------------
scenario("The agent's numbering, mapped onto the brief");

check("the agent's section 1 is the client snapshot, brief section 3", PROMPT_SECTION_TO_BRIEF["1"].brief === "3");
check("the QC feedback loop (agent 0) is brief section 1", PROMPT_SECTION_TO_BRIEF["0"].brief === "1");
check("retention is brief section 2", PROMPT_SECTION_TO_BRIEF.r.brief === "2");
check("an upper-case R maps too", PROMPT_SECTION_TO_BRIEF.R.brief === "2");
check(
  "SEO, Google Ads and Meta all fold into the service review",
  ["8", "9", "10"].every((id) => PROMPT_SECTION_TO_BRIEF[id].brief === "10"),
);
check(
  "each folded one keeps its own subheading",
  PROMPT_SECTION_TO_BRIEF["9"].subtitle === "Google Ads" && PROMPT_SECTION_TO_BRIEF["10"].subtitle === "Meta Ads",
);
check(
  "the pre-call checklist (agent 16) has no brief section",
  PROMPT_SECTION_TO_BRIEF["16"] === undefined,
  "it is the review screen's footer, which is still the last thing read before the call",
);
check(
  "every mapped target is a real brief section",
  Object.values(PROMPT_SECTION_TO_BRIEF).every((entry) =>
    BRIEF_SECTIONS.some((section) => section.id === entry.brief),
  ),
);

// ---------------------------------------------------------------------------
scenario("Reading what the agent returned");

const raw = {
  executiveBrief: "unused here",
  missing: [
    { item: "Client's own time zone", whyItMatters: "The agenda email states a time", askOrCheck: "Ask on the call" },
    { item: "", whyItMatters: "x", askOrCheck: "y" },
  ],
  retention: { level: 2, section: "Level 2 — recover. The form is two weeks late." },
  qcPromises: [
    { what: "Ship the mobile form", byWhen: "Jun 19", status: "not_delivered", source: "QC Jun 5", howToOwnIt: "Open with it" },
    { what: "Send the June report", byWhen: "Jun 12", status: "delivered", source: "Intercom", howToOwnIt: "" },
    { what: "Reply about pricing", byWhen: "", status: "probably?", source: "", howToOwnIt: "" },
    { what: "", byWhen: "", status: "delivered", source: "", howToOwnIt: "" },
  ],
  qcFocus: [
    { idea: "a", why: "w", howItCouldSound: "s", whenToSkip: "k" },
    { idea: "b", why: "w", howItCouldSound: "s", whenToSkip: "k" },
    { idea: "c", why: "w", howItCouldSound: "s", whenToSkip: "k" },
    { idea: "d", why: "w", howItCouldSound: "s", whenToSkip: "k" },
  ],
  qcProposals: [{ idea: "Ask about the Sunday call", why: "w", howItCouldSound: "s", whenToSkip: "k", agreedWithJavier: true }],
  sections: [
    { id: "11", title: "Client Goal", markdown: "30 implant consultations a quarter." },
    { id: "1", title: "Quick Client Snapshot", markdown: "Two offices, wants more implant consultations." },
    { id: "9", title: "Google Ads Review", markdown: "Spend $1,850, 24 leads, CPL $77 (Jun 1–30, Google Ads)." },
    { id: "8", title: "SEO & GBP", markdown: "Implant page reached #3 (Jun 21 scan)." },
    { id: "99", title: "Not a section", markdown: "should be dropped" },
    { id: "12", title: "Growth", markdown: "" },
  ],
  agendaReadAloud: { opener: "Here's what we'll cover…", items: ["June results", "The form"], closeMinutes: 0 },
  clientAgendaEmail: {
    channel: "WhatsApp",
    subject: "Agenda for our July check-in",
    items: ["a", "b", "c", "d", "e", "f"],
    ask: "Bring your booked-job count",
    blockingGaps: ["meeting link missing"],
  },
  unreportedSeoWins: [{ win: "Implant page live", shippedOn: "Jun 18", source: "ClickUp" }, { win: "" }],
};

const brief = normalizePrepBrief(raw, "2026-07-01T17:00:00.000Z");

check("a gap with no item is dropped", brief.gaps.length === 1);
check("the retention level is read", brief.retention.level === 2);
check(
  "retention becomes brief section 2 rather than a field nobody renders",
  brief.sections.some((section) => section.id === "2" && section.markdown.startsWith("Level 2")),
);
check("a promise with no text is dropped", brief.promises.length === 3);
check(
  "an unrecognised promise status reads as unverified, never as delivered",
  brief.promises[2].status === "unknown",
  "claiming we kept a promise we cannot evidence is the worst failure this screen has",
);
check("coaching focus is capped at three", brief.focus.length === 3);
check("a focus item gets a stable id when the agent gives none", brief.focus[0].id === "focus-1");
check("the compliance flag survives", brief.proposals[0].agreedWithJavier === true);

check("an unknown section id is dropped", !brief.sections.some((section) => section.title === "Not a section"));
check("a section with no text is dropped", !brief.sections.some((section) => section.id === "12"));
check(
  "sections come back in the brief's order, not the agent's",
  brief.sections.map((section) => section.id).join(",") === "2,3,10,10,11",
  brief.sections.map((section) => section.id).join(","),
);
check(
  "the two service subsections keep their own subheadings",
  brief.sections.filter((section) => section.id === "10").map((section) => section.subtitle).join("|") ===
    "SEO & Google Business Profile|Google Ads",
);
check("a zero close time falls back to seven minutes", brief.agendaReadAloud?.closeMinutes === 7);
check("the email channel is read case-insensitively", brief.clientAgendaEmail?.channel === "whatsapp");
check("the email is capped at five items", brief.clientAgendaEmail?.items.length === 5);
check("a blocking gap survives", brief.clientAgendaEmail?.blockingGaps[0] === "meeting link missing");
check("white label defaults to false rather than undefined", brief.clientAgendaEmail?.whiteLabel === false);
check("an unreported win with no text is dropped", brief.unreportedSeoWins.length === 1);
check("the generation time is kept", brief.generatedAt === "2026-07-01T17:00:00.000Z");

check("a response that is not an object gives an empty brief", normalizePrepBrief("nope").sections.length === 0);
check("null gives an empty brief rather than throwing", normalizePrepBrief(null).promises.length === 0);
check(
  "a response from before the v2 prompt gives an empty brief, not an error",
  normalizePrepBrief({ executiveBrief: "x", agenda: ["a"], wins: [] }).sections.length === 0,
);
check(
  "retention level 0 writes no section 2",
  !normalizePrepBrief({ retention: { level: 0, section: "ignored" }, sections: [] }).sections.some(
    (section) => section.id === "2",
  ),
);

// ---------------------------------------------------------------------------
scenario("What the review screen shows");

const rows = reviewSections(brief, { declinedSections: ["4"], sectionEdits: { "3": "<p>mine</p>" } });

check("every section in the registry is shown", rows.length === 16);
check("a declined section says so", rows.find((row) => row.id === "4")?.state === "declined");
check("an edited section says so", rows.find((row) => row.id === "3")?.state === "edited");
check("an edited section keeps the AM's text", rows.find((row) => row.id === "3")?.edited === "<p>mine</p>");
check(
  "a section the preparation did not write is marked missing, not hidden",
  rows.find((row) => row.id === "13")?.state === "missing",
);
check(
  "the header and the email are never marked missing",
  rows.find((row) => row.id === "h")?.state === "written" &&
    rows.find((row) => row.id === "15")?.state === "written",
);
check(
  "the service review carries both its blocks",
  rows.find((row) => row.id === "10")?.blocks.length === 2,
);

check("nothing declined approves all fourteen", approvalSummary().approving === 14);
check("one declined approves thirteen", approvalSummary({ declinedSections: ["4"] }).approving === 13);
check(
  "declining the header does not change the count",
  approvalSummary({ declinedSections: ["h"] }).approving === 14,
  "the header is not a declinable section",
);
check(
  "a declined section is left out of what gets posted",
  !approvedSectionIds({ declinedSections: ["8"] }).includes("8" as BriefSectionId),
);

// ---------------------------------------------------------------------------
scenario("Source chips never invent a link");

check("a ClickUp task chip points at the task", clickupTaskChip("86b3kq1fm", "Ticket · Form")?.url === "https://app.clickup.com/t/86b3kq1fm");
check("an empty task id gives no chip", clickupTaskChip("  ", "x") === undefined);
check(
  "an Intercom conversation chip points at the conversation",
  intercomConversationChip("2219034417", "Jun 12 report")?.url ===
    "https://app.intercom.com/a/inbox/_/inbox/conversation/2219034417",
);

check("mm:ss becomes a document anchor", transcriptAnchor("18:20") === "#t=18m20s");
check("h:mm:ss carries the hour into the minutes", transcriptAnchor("1:05:09") === "#t=65m9s");
check("a word is not a timestamp", transcriptAnchor("later") === undefined);
check("sixty-one seconds is not a timestamp", transcriptAnchor("18:61") === undefined);
check("an empty timestamp gives no anchor", transcriptAnchor("") === undefined);

const tx = transcriptChip({ docId: "1OaklineJun5", callDateIso: "2026-06-05T17:00:00.000Z", timestamp: "18:20", timeZone: PT });
check("a transcript chip names the call it belongs to", tx?.label === "Jun 5 call · 18:20", tx?.label);
check(
  "a transcript chip opens that call's transcript tab at the moment",
  tx?.url === "https://docs.google.com/document/d/1OaklineJun5/edit?tab=transcript#t=18m20s",
  tx?.url,
);
check(
  "a chip for the whole call is fine without a timestamp",
  transcriptChip({ docId: "d", callDateIso: "2026-06-05T17:00:00.000Z", timeZone: PT })?.label === "Jun 5 call",
);
check(
  "no document means no chip",
  transcriptChip({ docId: "", callDateIso: "2026-06-05T17:00:00.000Z" }) === undefined,
);
check(
  "no call date means no chip — this is what stops this month's fact pointing at last month's call",
  transcriptChip({ docId: "d", callDateIso: "whenever" }) === undefined,
);

check("the Rank Tracker chip uses the dashboard heatmap address", rankTrackerChip().url === RANK_TRACKER_HEATMAP_URL);
check("finding a client uses the business list address", findClientChip().url === RANK_TRACKER_FIND_CLIENT_URL);

const chips = normalizeChips([
  { kind: "clickup", label: "Ticket", url: "https://app.clickup.com/t/1" },
  { kind: "clickup", label: "No link" },
  { kind: "clickup", label: "Bad link", url: "javascript:alert(1)" },
  { kind: "notasystem", label: "Nope", url: "https://x.test" },
  { kind: "gmail", label: "   " },
  "not an object",
]);
check("a good chip survives", chips.length === 3, `${chips.length}`);
check("a chip with no link is kept — naming the system still helps", chips[1].url === undefined);
check(
  "a non-http link is dropped while the chip's label is kept",
  chips[2].label === "Bad link" && chips[2].url === undefined,
);
check("an unknown system is dropped entirely", !chips.some((chip) => chip.label === "Nope"));
check("a blank label is dropped", !chips.some((chip) => !chip.label.trim()));

check(
  "GoHighLevel carries no icon rather than a third-party favicon request",
  SOURCE_ICON.ghl === undefined,
  "a favicon service would send the client's identity off-site on every brief citing a call",
);
check(
  "every other system's icon is served from this app",
  Object.entries(SOURCE_ICON)
    .filter(([key]) => key !== "ghl")
    .every(([, value]) => typeof value === "string" && value.startsWith("/")),
);

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures} of ${checks} checks passed.`);
console.log(
  [
    "",
    "Not covered here (needs live credentials or a model call, so it is checked by hand):",
    "  - the preparation agent actually returning the new fields, and the chips it builds",
    "    from real ClickUp, Intercom and Drive ids in the bundle",
    "  - the ClickUp page write of the approved sections, and the agenda email send",
    "  - the rich-text editor's stored HTML round-tripping through Firestore",
  ].join("\n"),
);

if (failures > 0) {
  process.exitCode = 1;
}
