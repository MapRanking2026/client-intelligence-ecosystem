/**
 * Pins the agenda email: what it refuses to send, and what it never invents.
 *
 * This is the one piece of the Monthly Touch that a client reads. Three things here are
 * requirements rather than behaviour that happens to work:
 *
 *   1. A missing fact is a refusal, not a default. No date, no agenda items, no meeting link, no
 *      sign-off -- each one blocks the send and says what to do about it. An email that tells a
 *      client the wrong hour is worse than one that was never sent, because the client is the one
 *      person who cannot check it.
 *   2. The preparation's own blocking gaps survive. They come from the agent that saw the
 *      evidence, so they are listed first and ours are appended -- never merged away.
 *   3. Every interpolated value is escaped and every link is https. The business name and the
 *      agenda items are free text that reached us through a model; a quote in a client's name must
 *      not be able to end an attribute, and a `javascript:` join button must never render.
 *
 * Exercises the pure rules only. The Intercom send, the admin-seat lookup and the recipient
 * resolution all need a live token, and are listed at the end of the run.
 *
 * Run with: npm run check:agenda-email
 */
import {
  agendaEmailHasBody,
  agendaTopic,
  buildAgendaEmailDraft,
  buildAgendaEmailHtml,
  sanitizeAgendaEmailHtml,
  type AgendaEmailFacts,
} from "@/src/lib/contracts/agenda-email";
import type { ClientAgendaEmail } from "@/src/lib/contracts/prep-brief";

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

/** A complete agenda email from the preparation, so each check can take one fact away. */
function agendaEmail(overrides: Partial<ClientAgendaEmail> = {}): ClientAgendaEmail {
  return {
    channel: "email",
    whiteLabel: false,
    subject: "",
    items: [
      "Your October results — more patients calling you straight from Maps",
      "The contact form fix — what broke and what we changed",
      "Next steps — who does what before December",
    ],
    ask: "Your booked-job count for October, if you have it handy.",
    length: "",
    link: "https://meet.google.com/abc-defg-hij",
    signoff: "Talk soon,\nJavier\nMap Ranking",
    blockingGaps: [],
    ...overrides,
  };
}

/** 2026-11-05 10:00 Pacific — after DST ends, so the zone reads PST. */
const SOURCE = {
  businessName: "Oakline Dental Group",
  contactName: "Maya Brooks",
  scheduledAt: "2026-11-05T18:00:00.000Z",
  timeZone: PT,
  timeZoneIsClients: false,
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  lengthMinutes: 40,
  accountManagerName: "Javier",
  appUrl: "https://mtos.mapranking.com",
};

// ---------------------------------------------------------------------------
scenario("One agenda sentence becomes a topic row");

check(
  "an em dash splits the title from the explanation",
  agendaTopic("Your October results — more patients calling you from Maps").title === "Your October results",
);
check(
  "the explanation is the rest of the sentence, not a guess",
  agendaTopic("Your October results — more patients calling you from Maps").line ===
    "more patients calling you from Maps",
);
check("a colon splits too", agendaTopic("Next steps: who does what").line === "who does what");
check(
  "no separator leaves the line empty rather than cutting the sentence in half",
  agendaTopic("A quick look at how the quarter is shaping up").line === "",
  JSON.stringify(agendaTopic("A quick look at how the quarter is shaping up")),
);
check(
  "no separator keeps the whole sentence as the title",
  agendaTopic("A quick look at how the quarter is shaping up").title ===
    "A quick look at how the quarter is shaping up",
);
check("results pick the chart emoji", agendaTopic("Your October results — better").emoji === "📈");
check("a website fix picks the tools emoji", agendaTopic("The contact form fix — what broke").emoji === "🛠️");
check("next steps pick the tick", agendaTopic("Next steps — who does what").emoji === "✅");
check("billing picks the card", agendaTopic("Billing — your plan changes in December").emoji === "💳");
check(
  "an emoji the preparation already wrote is kept, not replaced",
  agendaTopic("🦷 Your October results — better").emoji === "🦷",
);
check(
  "that kept emoji is not left in the title as well",
  agendaTopic("🦷 Your October results — better").title === "Your October results",
);
check(
  "a multi-part emoji survives whole",
  agendaTopic("🛠️ The form fix — what broke").emoji === "🛠️",
  JSON.stringify(agendaTopic("🛠️ The form fix — what broke").emoji),
);
check("a sentence with no keyword gets no emoji", agendaTopic("Something else entirely").emoji === "");
check("a leading separator is not treated as a split", agendaTopic("— stray").title === "— stray");

// ---------------------------------------------------------------------------
scenario("A complete draft blocks only on the time zone MTOS does not hold");

const full = buildAgendaEmailDraft(agendaEmail(), SOURCE);

check(
  "a complete touch has exactly one gap: the unknown client zone",
  full.blockingGaps.length === 1,
  full.blockingGaps.join(" | "),
);
check(
  "and that gap names what the AM must confirm",
  /confirm the client reads that hour/i.test(full.blockingGaps[0] || ""),
);
check("the date reads in the AM's zone", full.facts.dateLabel === "Thu, November 5", full.facts.dateLabel);
check(
  "the time reads in the AM's zone",
  full.facts.timeLabel.includes("10:00") && full.facts.timeLabel.includes("PST"),
  full.facts.timeLabel,
);
check("the eyebrow month comes from the call date", full.facts.monthLabel === "November 2026", full.facts.monthLabel);
check("the length comes from the touch when the agent gave none", full.facts.lengthLabel === "About 40 min");
check("the greeting uses a first name only", full.facts.contactFirstName === "Maya");
check("the subject falls back to the date when the agent wrote none", /November 5/.test(full.subject), full.subject);
check("all three agenda items become topics", full.facts.topics.length === 3);
check("the sign-off is one entry per line", full.facts.signoff.length === 3, full.facts.signoff.join(" / "));
check(
  "the logo is an absolute https URL",
  full.facts.logoUrl === "https://mtos.mapranking.com/brand/mapranking-mark.png",
  full.facts.logoUrl,
);

// ---------------------------------------------------------------------------
scenario("An honorific keeps the surname, because that is what an AM writes");

check(
  "Dr. Maya Brooks is greeted as Dr. Brooks",
  buildAgendaEmailDraft(agendaEmail(), { ...SOURCE, contactName: "Dr. Maya Brooks" }).facts.contactFirstName ===
    "Dr. Brooks",
);
check(
  "a one-word contact is used as it stands",
  buildAgendaEmailDraft(agendaEmail(), { ...SOURCE, contactName: "Maya" }).facts.contactFirstName === "Maya",
);
check(
  "no contact gives an empty name rather than a greeting with a hole in it",
  buildAgendaEmailDraft(agendaEmail(), { ...SOURCE, contactName: undefined }).facts.contactFirstName === "",
);

// ---------------------------------------------------------------------------
scenario("Each missing fact is a refusal that says what to do");

const noDate = buildAgendaEmailDraft(agendaEmail(), { ...SOURCE, scheduledAt: undefined });
check("no date and time blocks the send", noDate.blockingGaps.some((gap) => /no date and time/i.test(gap)));
check(
  "and the labels are left empty rather than guessed",
  noDate.facts.dateLabel === "" && noDate.facts.timeLabel === "",
);
check(
  "no date means no zone warning either, because there is no hour to misread",
  !noDate.blockingGaps.some((gap) => /working time zone/i.test(gap)),
);
check(
  "an unparseable date is treated as no date, not as a crash",
  buildAgendaEmailDraft(agendaEmail(), { ...SOURCE, scheduledAt: "not a date" }).facts.dateLabel === "",
);

const clientZone = buildAgendaEmailDraft(agendaEmail(), { ...SOURCE, timeZoneIsClients: true });
check(
  "a known client zone raises no gap at all",
  clientZone.blockingGaps.length === 0,
  clientZone.blockingGaps.join(" | "),
);

const noItems = buildAgendaEmailDraft(agendaEmail({ items: [] }), SOURCE);
check("no agenda items blocks the send", noItems.blockingGaps.some((gap) => /no agenda items/i.test(gap)));
check("and the intro line is left out rather than written empty", noItems.facts.intro === "");
check(
  "blank items are the same as none",
  buildAgendaEmailDraft(agendaEmail({ items: ["", "   "] }), SOURCE).facts.topics.length === 0,
);

const noLink = buildAgendaEmailDraft(agendaEmail({ link: "" }), { ...SOURCE, meetingUrl: undefined });
check("no meeting link blocks the send", noLink.blockingGaps.some((gap) => /no Google Meet link/i.test(gap)));
check("and no join button is rendered", !noLink.html.includes("Join on Google Meet"));

check(
  "a non-https join link is dropped rather than linked",
  buildAgendaEmailDraft(agendaEmail({ link: "javascript:alert(1)" }), { ...SOURCE, meetingUrl: undefined }).facts
    .meetingUrl === "",
);
check(
  "an http join link is dropped too",
  buildAgendaEmailDraft(agendaEmail({ link: "http://meet.google.com/x" }), { ...SOURCE, meetingUrl: undefined }).facts
    .meetingUrl === "",
);
check(
  "the agent's link wins over the touch's",
  buildAgendaEmailDraft(agendaEmail({ link: "https://meet.google.com/from-agent" }), SOURCE).facts.meetingUrl ===
    "https://meet.google.com/from-agent",
);

const noSignoff = buildAgendaEmailDraft(agendaEmail({ signoff: "" }), SOURCE);
check(
  "no sign-off falls back to the AM's name",
  noSignoff.facts.signoff.join(" / ") === "Talk soon, / Javier / Map Ranking",
  noSignoff.facts.signoff.join(" / "),
);
check("and that fallback raises no gap", !noSignoff.blockingGaps.some((gap) => /unsigned/i.test(gap)));

const anonymous = buildAgendaEmailDraft(agendaEmail({ signoff: "" }), {
  ...SOURCE,
  accountManagerName: "",
  signoff: undefined,
});
check(
  "no sign-off and no name blocks the send rather than ending unsigned",
  anonymous.blockingGaps.some((gap) => /end unsigned/i.test(gap)),
  anonymous.blockingGaps.join(" | "),
);

check(
  "a non-https deployment URL leaves the logo out instead of hotlinking",
  buildAgendaEmailDraft(agendaEmail(), { ...SOURCE, appUrl: "http://localhost:3000" }).facts.logoUrl === "",
);
check(
  "no deployment URL leaves the logo out",
  buildAgendaEmailDraft(agendaEmail(), { ...SOURCE, appUrl: "" }).facts.logoUrl === "",
);

// ---------------------------------------------------------------------------
scenario("The preparation's own gaps are listed first and never merged away");

const bothGaps = buildAgendaEmailDraft(
  agendaEmail({ blockingGaps: ["The client never confirmed the new contact address."] }),
  { ...SOURCE, scheduledAt: undefined },
);
check("the agent's gap comes first", bothGaps.blockingGaps[0] === "The client never confirmed the new contact address.");
check("ours are appended, not substituted", bothGaps.blockingGaps.length >= 2, bothGaps.blockingGaps.join(" | "));
check(
  "and ours is still the date gap",
  bothGaps.blockingGaps.slice(1).some((gap) => /no date and time/i.test(gap)),
);

// ---------------------------------------------------------------------------
scenario("Every interpolated value is escaped on the way into the HTML");

const hostile = buildAgendaEmailDraft(
  agendaEmail({
    items: ['Results <script>alert(1)</script> & "quoted"'],
    ask: 'Bring the <b>numbers</b> & a "list"',
  }),
  { ...SOURCE, businessName: 'Smith & Sons "Plumbing" <Ltd>' },
);

check("a raw script tag cannot survive into the body", !hostile.html.includes("<script>"));
check("an ampersand in a business name is escaped", hostile.html.includes("Smith &amp; Sons"));
check("a quote in a business name is escaped", hostile.html.includes("&quot;Plumbing&quot;"));
check("an angle bracket in a business name is escaped", hostile.html.includes("&lt;Ltd&gt;"));
check("an agenda item's markup is escaped, not rendered", hostile.html.includes("&lt;script&gt;"));
check("the ask's markup is escaped too", hostile.html.includes("&lt;b&gt;numbers&lt;/b&gt;"));

// ---------------------------------------------------------------------------
scenario("The rendered email is email-safe and leaves out what it does not know");

function facts(overrides: Partial<AgendaEmailFacts> = {}): AgendaEmailFacts {
  return { ...full.facts, ...overrides };
}

const html = buildAgendaEmailHtml(full.facts);
check("it is table-based", html.includes("<table"));
check("it carries inline styles rather than a stylesheet", html.includes("style=") && !html.includes("<style"));
check("it loads no external stylesheet", !/<link\b/i.test(html));
check("the join button is there when there is a link", html.includes("Join on Google Meet"));
check("the client's business is named", html.includes("Oakline Dental Group"));
check("the ask box is there when there is an ask", html.includes("One thing to bring"));
check("no ask leaves the box out entirely", !buildAgendaEmailHtml(facts({ ask: "" })).includes("One thing to bring"));
check(
  "no length leaves the facts row shorter rather than saying About 0 min",
  !buildAgendaEmailHtml(facts({ lengthLabel: "" })).includes("Length"),
);
check(
  "no logo renders the wordmark as text instead of a broken image",
  !buildAgendaEmailHtml(facts({ logoUrl: "" })).includes("<img"),
);
check("the footer carries the support address", html.includes("support@mapranking.com"));
check("the agenda items are in the body", html.includes("Your October results"));

// ---------------------------------------------------------------------------
scenario("The sanitizer takes out what a paste drags in, and leaves the tables alone");

check(
  "a script body goes, contents and all",
  sanitizeAgendaEmailHtml('<p>Hi</p><script>fetch("/steal")</script>') === "<p>Hi</p>",
  sanitizeAgendaEmailHtml('<p>Hi</p><script>fetch("/steal")</script>'),
);
check("a style block goes", !sanitizeAgendaEmailHtml("<style>p{color:red}</style><p>Hi</p>").includes("color:red"));
check("an iframe goes", !sanitizeAgendaEmailHtml('<iframe src="https://x.test"></iframe>').includes("iframe"));
check(
  "a stylesheet link goes",
  !sanitizeAgendaEmailHtml('<link rel="stylesheet" href="https://x.test/a.css">').includes("link"),
);
check("a form fragment goes", !sanitizeAgendaEmailHtml("<form><input name=a></form>").includes("form"));
check(
  "an onerror handler goes",
  !/onerror/i.test(sanitizeAgendaEmailHtml('<img src="https://x.test/a.png" onerror="alert(1)">')),
);
check("an onclick with no quotes goes too", !/onclick/i.test(sanitizeAgendaEmailHtml("<p onclick=alert(1)>Hi</p>")));
check(
  "a javascript: href loses its address",
  !sanitizeAgendaEmailHtml('<a href="javascript:alert(1)">Click</a>').includes("javascript:"),
);
check(
  "but the link text is kept, because the AM wrote it",
  sanitizeAgendaEmailHtml('<a href="javascript:alert(1)">Click</a>').includes("Click"),
);
check(
  "an https href is left intact",
  sanitizeAgendaEmailHtml('<a href="https://mapranking.com">Us</a>').includes('href="https://mapranking.com"'),
);
check("a mailto href is left intact", sanitizeAgendaEmailHtml('<a href="mailto:a@b.test">Mail</a>').includes("mailto:"));
check("the whole branded email survives the sanitizer unchanged", sanitizeAgendaEmailHtml(html) === html.trim());
check("an empty input is handled", sanitizeAgendaEmailHtml("") === "");

check("a near-empty body is not worth sending", agendaEmailHasBody("<p></p>") === false);
check("whitespace and tags alone are not a body", agendaEmailHasBody("<div><p>&nbsp;</p></div>") === false);
check("a short line is still not a body", agendaEmailHasBody("<p>Hi there</p>") === false);
check("the real email is a body", agendaEmailHasBody(html) === true);

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures} of ${checks} checks passed.`);
console.log(
  [
    "",
    "Not covered here (needs a live Intercom token, so it is checked by hand against a real touch):",
    "  - `findAdminByEmail`: that the AM's own seat is matched, and that no match refuses rather",
    "    than falling back to the app's identity — sending as somebody else routes the client's",
    "    reply to the wrong inbox",
    "  - the `POST /messages` call itself, and that a response carrying no conversation id is",
    "    reported as not sent",
    "  - `resolveRecipient`: that an address is read only from the synced ClickUp fields or the",
    "    Client's Book, and never guessed from the business name",
    "  - that Intercom carries no cc, so a copied office contact is named in the warning instead",
  ].join("\n"),
);

if (failures > 0) {
  process.exitCode = 1;
}
