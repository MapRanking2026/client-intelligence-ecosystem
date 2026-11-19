/**
 * Pins the shape of the recap email against the outline the AMs agreed on.
 *
 * The outline is five sections in a fixed order -- opening, what we discussed, goals, quick
 * recap, closing -- and the whole value of fixing it is that a client reading two recaps from two
 * account managers reads the same email. So the order is asserted by position, not by presence: a
 * goals section that rendered after the quick recap would pass an `includes` check and still be
 * the wrong email.
 *
 * The other half of this check is what the outline does NOT license: a heading with nothing under
 * it. An empty "Your goals and growth targets" band tells the client we discussed their goals.
 *
 * Run with: npm run check:recap-email-structure
 */
import {
  buildRecapEmailDraft,
  sanitizeRecapEmailHtml,
  type RecapEmailSource,
} from "@/src/lib/contracts/follow-through-recap-email";
import { buildAgendaEmailHtml } from "@/src/lib/contracts/agenda-email";
import type { NotesDraft } from "@/src/lib/contracts/follow-through-notes";

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`);
}

function scenario(name: string) {
  console.log(`\n${name}`);
}

const notes = {
  title: "Synthetic notes",
  summary: "We reviewed local visibility together.",
  bullets: { metrics: "" },
  goalText: "60 booked jobs a month",
  goalQuarter: "Q4 2026",
  goalStatus: "On track",
  goalEvidence: "",
  departments: [],
  clientActions: [],
  pending: [],
} as unknown as NotesDraft;

const full: RecapEmailSource = {
  businessName: "Synthetic Plumbing",
  contactName: "Jay Frias",
  metLabel: "Wed 18 November",
  nextCheckInLabel: "Thursday, December 17, 2026 at 2:00 PM PST",
  nextCheckInUrl: "",
  signoff: "Best regards,\nSynthetic AM\nMap Ranking",
  accountManagerName: "Synthetic AM",
  nextMeetingAgreed: true,
  overview: "We reviewed local visibility together.",
  discussionTopics: [
    {
      heading: "Competitors and keyword targeting",
      discussed: "We compared the three shops ranking above you in the north service area.",
      situation: "They each hold more review volume on the terms that convert.",
      direction: "We will target the emergency terms where the gap is smallest.",
      outcome: "You should see movement on those terms inside the month.",
    },
    {
      heading: "Map Check-Ins",
      discussed: "We walked through how check-ins are posted from completed jobs.",
      situation: "",
      direction: "",
      outcome: "",
    },
  ],
  goalTargets: ["60 booked jobs a month by the end of the quarter", "The north service area first"],
  meetingCommitments: [{ what: "Review the north location", due: "by December 1" }],
  meetingRequests: [{ what: "Send the updated photos", due: "by November 20" }],
  next30Days: [{ what: "Focus on local visibility", due: "" }],
  promisedInclusions: [
    { text: "What is your booked-jobs target next quarter?", requiresReply: true },
    { text: "The competitor list we looked at on the call.", requiresReply: false },
  ],
  highlights: [{ title: "North location", detail: "Average ranking improved from 17.5 to 12.4." }],
  wins: [{ what: "Service page rewritten", shipped: "" }],
};

const draft = buildRecapEmailDraft(full, notes, []);
const html = draft.html;
const at = (needle: string) => html.indexOf(needle);

scenario("The five sections, in the agreed order");
{
  const order = [
    "Thank you again for taking the time to meet with me",
    "What we discussed",
    "Your goals and growth targets",
    "Quick recap",
    "Before you go",
  ];
  for (const [index, section] of order.entries()) {
    check(`${index + 1}. ${section} is present`, at(section) >= 0);
  }
  const positions = order.map(at);
  check(
    "they run in that order and nowhere else",
    positions.every((position, index) => index === 0 || position > positions[index - 1]),
    JSON.stringify(positions),
  );
  check("the greeting comes first of all", at("Hello Jay,") < positions[0], String(at("Hello Jay,")));
}

scenario("1 - Opening and meeting acknowledgment");
{
  check("it thanks them for the time", html.includes("Thank you again for taking the time to meet with me"));
  check(
    "and says what the email covers",
    html.includes("the priorities for the next 30 days") && html.includes("what we will be working on"),
  );
}

scenario("2 - Main discussion points, numbered");
{
  check("the topic heading is rendered", html.includes("Competitors and keyword targeting"));
  check("the topics are numbered", html.includes(">1</div>") && html.includes(">2</div>"));
  for (const [label, value] of [
    ["what we discussed", "We compared the three shops ranking above you"],
    ["where things stand", "They each hold more review volume"],
    ["what we'll focus on", "We will target the emergency terms"],
    ["what to expect", "You should see movement on those terms"],
  ]) {
    check(`the ${label} line carries its text`, html.includes(value), value);
  }
  const secondCard = html.slice(at("Map Check-Ins"), at("Performance highlights"));
  check("a topic with only one field gets only one line", !secondCard.includes("Where things stand"), secondCard.slice(0, 200));
  check(
    "performance highlights stay in this section",
    at("Performance highlights") > at("What we discussed") && at("Performance highlights") < at("Your goals and growth targets"),
  );
  check("so does completed work", at("Completed work") > at("What we discussed") && at("Completed work") < at("Your goals and growth targets"));
  check("and the 30-day priorities", at("The next 30 days") < at("Your goals and growth targets"));
  check("anything else promised sits with the conversation", at("As promised") < at("Your goals and growth targets"));
}

scenario("3 - Client goals and growth targets");
{
  check("the quarterly goal is named", html.includes("60 booked jobs a month"));
  check("the client's own target is listed", html.includes("The north service area first"));
  check(
    "the questions they owe us are in this section",
    at("Questions for your reply") > at("Your goals and growth targets") && at("Questions for your reply") < at("Quick recap"),
  );
  check("and they are numbered", html.slice(at("Questions for your reply")).includes("<ol"));
}

scenario("4 - Quick recap, in two parts");
{
  check("part A is ours", html.includes("A &middot; What you can expect from us"));
  check("part B is theirs", html.includes("B &middot; What we need from you"));
  check("A comes before B", at("A &middot; What you can") < at("B &middot; What we need"));
  check("both sit under the quick recap band", at("Quick recap") < at("A &middot; What you can"));
  check("ours carries the agreed timing", html.includes("Agreed timing: by December 1"));
  check("theirs carries the client's date", html.includes("by November 20"));
}

scenario("5 - Closing and call to action");
{
  const closing = html.slice(at("Before you go"));
  check("the next meeting is named", closing.includes("December 17, 2026"));
  check("it thanks them by name", closing.includes("Thank you again, Jay."));
  check("it acknowledges their help", closing.includes("I appreciate your help with these items"));
  check("it invites the reply", closing.includes("Please reply with your answers to the questions above"));
  check("the signature is the AM's own", closing.includes("Synthetic AM"));
}

scenario("A section with nothing in it is not rendered");
{
  const bare = buildRecapEmailDraft(
    {
      ...full,
      discussionTopics: [],
      goalTargets: [],
      highlights: [],
      wins: [],
      next30Days: [],
      meetingCommitments: [],
      meetingRequests: [],
      promisedInclusions: [],
    },
    { ...notes, goalText: "" } as NotesDraft,
    [],
  ).html;
  check("no goals band without goals", !bare.includes("Your goals and growth targets"));
  check("no quick recap band without either side", !bare.includes("Quick recap"));
  check("no questions block without questions", !bare.includes("Questions for your reply"));
  check("the opening and closing always stand", bare.includes("Thank you again for taking") && bare.includes("Before you go"));
  check("and the overview still has its band", bare.includes("What we discussed"));
}

scenario("It still looks like the confirmation email");
{
  const agenda = buildAgendaEmailHtml({
    businessName: "Synthetic Plumbing",
    contactFirstName: "Jay",
    monthLabel: "November",
    dateLabel: "Wed 18 November",
    timeLabel: "2:00 PM",
    lengthLabel: "30 minutes",
    intro: "Here is what we will cover.",
    topics: [{ emoji: "", title: "Local visibility", line: "Where the north area stands." }],
    // The agenda email uses the pale callout background only for its one ask, so the fixture has
    // to carry one for the palette comparison below to mean anything.
    ask: "Your current booked-job numbers, if you have them.",
    meetingUrl: "",
    signoff: ["Best regards,", "Synthetic AM"],
    logoUrl: "",
  } as Parameters<typeof buildAgendaEmailHtml>[0]);
  for (const shared of [
    "#1A73E8",
    "#0D1B2A",
    "#E8F0FD",
    "#C8D8F0",
    "max-width:620px",
    "border-radius:14px",
    "MapRanking",
    "mapranking.com",
  ]) {
    check(`shares ${shared} with the confirmation email`, html.includes(shared) && agenda.includes(shared), shared);
  }
  check(
    "the brand bar is at the top of both",
    html.includes('<div style="height:8px;background:') && agenda.includes('<div style="height:8px;background:'),
  );
  check("both are table based for Outlook", html.includes('role="presentation"') && agenda.includes('role="presentation"'));
  check("neither carries a class name to be stripped", !html.includes('class="') && !agenda.includes('class="'));
}

scenario("The whole thing survives the editor");
{
  const cleaned = sanitizeRecapEmailHtml(html);
  for (const section of ["What we discussed", "Your goals and growth targets", "Quick recap", "Before you go"]) {
    check(`${section} survives the sanitiser`, cleaned.includes(section));
  }
  check("the topic cards keep their styling", cleaned.includes("border-radius:12px"));
  check("a heading typed into the editor is kept", sanitizeRecapEmailHtml("<h3>My own section</h3>").includes("<h3>"));
  check("a rewritten section is kept verbatim", sanitizeRecapEmailHtml("<p>My own wording.</p>") === "<p>My own wording.</p>");
}

scenario("Escaping, in every new field");
{
  const nasty = buildRecapEmailDraft(
    {
      ...full,
      discussionTopics: [{ heading: 'Oak & "Line"', discussed: "<b>bold</b> claim", situation: "", direction: "", outcome: "" }],
      goalTargets: ["<script>evil()</script>"],
    },
    notes,
    [],
  ).html;
  check("a topic heading is escaped", nasty.includes("Oak &amp; &quot;Line&quot;"));
  check("a topic body is escaped", nasty.includes("&lt;b&gt;bold&lt;/b&gt;"));
  check("a goal target is escaped", nasty.includes("&lt;script&gt;") && !nasty.includes("<script>"));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(
  "\nNot covered here (needs an LLM provider):\n" +
    "  - whether the model fills discussionTopics with the topics an AM would have chosen\n" +
    "  - whether a real mail client renders the section bands as intended",
);
if (failures) {
  process.exitCode = 1;
}
