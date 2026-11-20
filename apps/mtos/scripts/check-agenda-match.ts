/**
 * The deck covers what the confirmation email promised.
 *
 * These were two separate model runs from the same brief, so the client read one agenda two days
 * before the call and saw a different one on the screen during it. Nothing was wrong with either;
 * they simply had no reason to agree.
 *
 * The workflow settles which one has to move. The email is approved in Review and the deck is
 * built at the approval after it, so by the time there is a deck the client has already been told
 * what the call will cover -- and the deck is the only one of the two that can still be changed
 * without writing to the client again.
 *
 * The case this check cares most about is the hand-edited email: an AM who rewrites the agenda in
 * the body has changed what the client was promised, and the body, not the brief, is the record
 * of it.
 *
 * Run with: npm run check:agenda-match
 */
import { agendaTopicsFromHtml, agreedAgendaItems, agreedAgendaRule, withAgreedAgenda } from "@/src/lib/contracts/agreed-agenda";
import { buildAgendaEmailDraft } from "@/src/lib/contracts/agenda-email";
import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";

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

const ITEMS = [
  "Your view of the month",
  "The concierge OB/GYN visibility win — more patients finding you on Maps",
  "Google Business Profile: searches, clicks, directions and calls",
  "Your goal, and where to focus next",
];

const TITLES = [
  "Your view of the month",
  "The concierge OB/GYN visibility win",
  "Google Business Profile",
  "Your goal, and where to focus next",
];

const draft = buildAgendaEmailDraft(
  { subject: "Agenda for our check-in", items: ITEMS, ask: "" } as Parameters<typeof buildAgendaEmailDraft>[0],
  {
    businessName: "Synthetic Women's Health",
    contactName: "Jay Frias",
    scheduledAt: "2026-11-20T22:00:00Z",
    timeZone: "America/Los_Angeles",
    timeZoneIsClients: true,
    meetingUrl: "",
    lengthMinutes: 30,
    signoff: "Best regards,\nSynthetic AM",
    accountManagerName: "Synthetic AM",
  },
);

scenario("The agenda can be read back out of the email that was sent");
{
  const read = agendaTopicsFromHtml(draft.html);
  check("every row comes back", read.length === ITEMS.length, JSON.stringify(read));
  check("in the order the client reads them", read.join("|").includes("Your view of the month"), JSON.stringify(read));
  check(
    "the emoji the email adds is not mistaken for the topic",
    read.every((row) => !/^[^A-Za-z0-9]+$/.test(row)),
    JSON.stringify(read),
  );
  check(
    "each row is the topic the brief wrote",
    TITLES.every((title) => read.some((row) => row.includes(title))),
    JSON.stringify(read),
  );
  check("an email with no agenda rows returns nothing", agendaTopicsFromHtml("<p>Hello</p>").length === 0);
  check("and so does an empty body", agendaTopicsFromHtml("").length === 0);
}

scenario("What the client was promised wins over what the brief proposed");
{
  const edited = draft.html.replace("Your view of the month", "How the quarter is tracking");
  const touch = {
    agendaEmail: { html: edited },
    prepBrief: { clientAgendaEmail: { items: ITEMS } },
  } as unknown as MonthlyTouchRecord;
  const agreed = agreedAgendaItems(touch);
  check("the AM's own wording is what counts", agreed[0] === "How the quarter is tracking", JSON.stringify(agreed));
  check("and the brief's original line is gone", !agreed.includes("Your view of the month"));

  const unsent = { prepBrief: { clientAgendaEmail: { items: ITEMS } } } as unknown as MonthlyTouchRecord;
  const proposed = agreedAgendaItems(unsent);
  check("with no body yet, the brief's items stand in", proposed.length === ITEMS.length, JSON.stringify(proposed));
  check(
    "reduced to the same titles the email would render",
    proposed[1] === "The concierge OB/GYN visibility win",
    JSON.stringify(proposed),
  );

  check("a touch with no email at all agrees to nothing", agreedAgendaItems({} as MonthlyTouchRecord).length === 0);
}

scenario("The deck is held to it, not merely asked");
{
  const generated = {
    slides: [
      { layout: "cover", title: "Monthly Touch" },
      { layout: "agenda", title: "What we will cover today", bullets: ["Something else entirely", "And another thing"] },
      { layout: "stat_callouts", title: "Calls", bullets: ["26 versus 34"] },
    ],
  };
  const fixed = withAgreedAgenda(generated, TITLES);
  const agenda = fixed.slides.find((slide) => slide.layout === "agenda")!;
  check("the agenda slide lists the agreed lines", JSON.stringify(agenda.bullets) === JSON.stringify(TITLES), JSON.stringify(agenda.bullets));
  check("the model's own agenda is gone", !JSON.stringify(agenda.bullets).includes("Something else entirely"));
  check("the slide keeps its title and place", agenda.title === "What we will cover today" && fixed.slides[1].layout === "agenda");
  check("no other slide is touched", JSON.stringify(fixed.slides[2]) === JSON.stringify(generated.slides[2]));
  check(
    "an agenda slide built as items loses them rather than showing two lists",
    withAgreedAgenda({ slides: [{ layout: "agenda", items: [{ label: "Stale" }] }] }, TITLES).slides[0].items === undefined,
  );
  check(
    "a deck with no agenda slide is left alone",
    JSON.stringify(withAgreedAgenda({ slides: [{ layout: "cover" }] }, TITLES)) === JSON.stringify({ slides: [{ layout: "cover" }] }),
  );
  check(
    "and nothing agreed means nothing imposed",
    JSON.stringify(withAgreedAgenda(generated, [])) === JSON.stringify(generated),
  );
}

scenario("The model is asked for it first");
{
  const rule = agreedAgendaRule(TITLES);
  check("the rule names the lines", TITLES.every((title) => rule.includes(title)));
  check("and says they are what the client already received", /already received a confirmation email/i.test(rule));
  check("and forbids rewording them", /do not reword them/i.test(rule));
}

scenario("End to end: one agenda, two surfaces");
{
  const touch = { agendaEmail: { html: draft.html } } as unknown as MonthlyTouchRecord;
  const agreed = agreedAgendaItems(touch);
  const deck = withAgreedAgenda({ slides: [{ layout: "agenda", title: "What we will cover today", bullets: ["Drifted"] }] }, agreed);
  const onScreen = deck.slides[0].bullets || [];
  const inEmail = agendaTopicsFromHtml(draft.html);
  check("the slide and the email say the same thing", JSON.stringify(onScreen) === JSON.stringify(inEmail), JSON.stringify({ onScreen, inEmail }));
  check("in the same order", onScreen[0] === inEmail[0] && onScreen[onScreen.length - 1] === inEmail[inEmail.length - 1]);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(
  "\nNot covered here (needs an LLM provider):\n" +
    "  - whether the deck's content slides actually follow the agenda's order, which the prompt asks for\n" +
    "  - the call guide format, whose sections are not held to the email agenda",
);
if (failures) {
  process.exitCode = 1;
}
