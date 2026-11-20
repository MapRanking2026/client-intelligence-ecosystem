/**
 * The signature arrives in the client's inbox the way the AM wrote it.
 *
 * Settings used to take the signature as flat lines, so an AM who wanted their name in bold had
 * no way to say so. It is a formatted field now, which means the stored value is markup -- and
 * markup that is dropped into a message to a client has to survive two opposite failures: being
 * escaped into visible angle brackets, and being passed through with whatever a paste from a web
 * page brought with it.
 *
 * The signature typed as plain lines has to keep behaving exactly as it did, because most of them
 * are, and nobody should have to open the toolbar to keep what they already had.
 *
 * Run with: npm run check:email-signature
 */
import {
  buildAgendaEmailHtml,
  emailSignatureHtml,
  emailSignatureLines,
  isFormattedSignature,
  sanitizeAgendaEmailHtml,
  type AgendaEmailFacts,
} from "@/src/lib/contracts/agenda-email";
import { buildRecapEmailDraft, type RecapEmailSource } from "@/src/lib/contracts/follow-through-recap-email";
import { normalizePreferences, PREFERENCE_GROUPS } from "@/src/lib/contracts/user-preferences";
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

const FORMATTED = "Best regards,<br><strong>Francisco Quintero</strong><br><em>Senior Account Manager</em> | Map Ranking";
const PLAIN = "Best regards,\nFrancisco Quintero\nSenior Account Manager | Map Ranking";

scenario("A formatted signature keeps its formatting");
{
  check("it is recognised as formatted", isFormattedSignature(FORMATTED));
  const html = emailSignatureHtml(FORMATTED, "Francisco Quintero");
  check("the bold survives", html.includes("<strong>Francisco Quintero</strong>"), html);
  check("so does the italic", html.includes("<em>Senior Account Manager</em>"));
  check("the markup is not escaped into the body", !html.includes("&lt;strong&gt;"));
  check("the name is not doubled by the fallback", html.split("Francisco Quintero").length === 2, html);
}

scenario("A plain signature behaves exactly as before");
{
  check("it is not mistaken for markup", !isFormattedSignature(PLAIN));
  const html = emailSignatureHtml(PLAIN, "Francisco Quintero");
  check("the lines are joined with breaks", html === "Best regards,<br>Francisco Quintero<br>Senior Account Manager | Map Ranking", html);
  check("an empty line is dropped", emailSignatureHtml("A\n\n\nB") === "A<br>B");
  check(
    "a typed angle bracket is still escaped",
    emailSignatureHtml("Best <regards>,\nFrancisco") === "Best &lt;regards&gt;,<br>Francisco",
    emailSignatureHtml("Best <regards>,\nFrancisco"),
  );
  check("no signature still falls back to the AM's name", emailSignatureHtml("", "Ana Reyes") === "Best regards,<br>Ana Reyes<br>Map Ranking");
  check("and to nothing at all when there is no name either", emailSignatureHtml("", "") === "");
}

scenario("Plain lines are still available to readers that cannot show formatting");
{
  const lines = emailSignatureLines(FORMATTED, "Francisco Quintero");
  check("the formatted signature reduces to its text", lines.length === 3, JSON.stringify(lines));
  check("the first line is the closing", lines[0] === "Best regards,");
  check("the name comes through without its tags", lines[1] === "Francisco Quintero", JSON.stringify(lines));
  check("so does the title line", lines[2] === "Senior Account Manager | Map Ranking", JSON.stringify(lines));
  check("an entity is turned back into its character", emailSignatureLines("<p>Oak &amp; Line</p>")[0] === "Oak & Line");
  check(
    "a signature of only markup counts as no signature",
    emailSignatureLines("<p></p>", "").length === 0,
    JSON.stringify(emailSignatureLines("<p></p>", "")),
  );
}

scenario("Nothing dangerous reaches a client from the signature field");
{
  check("a pasted script is removed", !emailSignatureHtml("<p>Hi</p><script>evil()</script>").includes("script"));
  check("an onerror attribute is removed", !emailSignatureHtml('<img src="https://x/y.png" onerror="evil()">').includes("onerror"));
  check("a stylesheet link is removed", !emailSignatureHtml('<link rel="stylesheet" href="https://x/y.css">Best regards').includes("<link"));
  check("an https image survives", emailSignatureHtml('<img src="https://x/y.png">').includes("https://x/y.png"));
  check(
    "the stored preference is cleaned on the way in",
    !String(normalizePreferences({ emailSignoff: "<p>Hi</p><script>evil()</script>" }).emailSignoff).includes("script"),
  );
  check(
    "but the formatting is kept",
    String(normalizePreferences({ emailSignoff: FORMATTED }).emailSignoff).includes("<strong>"),
  );
  check(
    "a real formatted signature fits inside the stored limit",
    normalizePreferences({ emailSignoff: FORMATTED }).emailSignoff === sanitizeAgendaEmailHtml(FORMATTED),
  );
}

scenario("It reaches both emails");
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
    ask: "",
    meetingUrl: "",
    signoff: emailSignatureLines(FORMATTED),
    signoffHtml: emailSignatureHtml(FORMATTED),
    logoUrl: "",
  } as AgendaEmailFacts);
  check("the confirmation email carries the bold name", agenda.includes("<strong>Francisco Quintero</strong>"), agenda.slice(-400));
  check("and shows no escaped markup", !agenda.includes("&lt;strong&gt;"));

  const notes = {
    title: "Synthetic notes",
    summary: "We reviewed local visibility together.",
    bullets: { metrics: "" },
    goalText: "",
    goalQuarter: "Q4 2026",
    goalStatus: "On track",
    goalEvidence: "",
    departments: [],
    clientActions: [],
    pending: [],
  } as unknown as NotesDraft;
  const recap = buildRecapEmailDraft(
    {
      businessName: "Synthetic Plumbing",
      contactName: "Jay Frias",
      metLabel: "Wed 18 November",
      nextCheckInLabel: "",
      nextCheckInUrl: "",
      signoff: FORMATTED,
      accountManagerName: "Francisco Quintero",
      overview: "We reviewed local visibility together.",
      wins: [],
    } as RecapEmailSource,
    notes,
    [],
  );
  check("the recap email carries it too", recap.html.includes("<strong>Francisco Quintero</strong>"), recap.html.slice(-400));
  check("and it is not treated as a missing signature", !recap.blockingGaps.some((gap) => gap.includes("signature")), JSON.stringify(recap.blockingGaps));
  check("the markup survives the editor's sanitiser", sanitizeAgendaEmailHtml(recap.html).includes("<strong>Francisco Quintero</strong>"));
}

scenario("The Settings field offers the formatting");
{
  const field = PREFERENCE_GROUPS.flatMap((group) => group.fields).find((entry) => entry.key === "emailSignoff");
  check("the signature field is a formatted one", field?.kind === "richtext", String(field?.kind));
  check("and its hint says the formatting is kept", /bold/i.test(field?.hint || ""), field?.hint);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(
  "\nNot covered here (needs a browser):\n" +
    "  - the toolbar buttons themselves, which are exercised by the follow-through editor checks\n" +
    "  - how a given mail client renders a signature pasted in from somewhere else",
);
if (failures) {
  process.exitCode = 1;
}
