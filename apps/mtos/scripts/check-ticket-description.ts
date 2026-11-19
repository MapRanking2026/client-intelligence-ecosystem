/**
 * Pins what a ticket may say about whose account it is.
 *
 * The SEO team is not told which client they are working for, and the business already has its
 * own field on the form. So a description opens with the work, and the person on the call is "the
 * client" -- never their first name, which is the part that identifies them to someone who was
 * not on the call.
 *
 * The case that matters most is the one that does NOT change: "client ID", "client secret" and a
 * business whose name is an ordinary phrase all have to survive, because a rule that mangles the
 * ticket is worse than the leak it prevents.
 *
 * Run with: npm run check:ticket-description
 */
import {
  ACTION_LINE_ANONYMITY_RULE,
  CLIENT_ANONYMITY_RULE,
  maskedNames,
  withoutClientIdentity,
} from "@/src/lib/contracts/ticket-description";

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

const plumber = { businessName: "Most Valuable Plumber", contactName: "Jay Frias" };

scenario("The ticket from the screenshot");
{
  const written =
    "This is for the client Most Valuable Plumber. Jay Frias is trying to finish the ServiceTitan " +
    "API setup by end of day Nov 19, 2026. He has the tenant ID but still needs the client ID, " +
    "client secret and app key via developer.servicetitan.io. Once the credentials arrive, please " +
    "import past jobs and photos into Map Check-Ins and schedule the posts across all profiles.";
  const cleaned = withoutClientIdentity(written, plumber);

  check("the preamble is gone", !/^This is for/.test(cleaned), cleaned.slice(0, 60));
  check("it opens on the work", cleaned.startsWith("The client is trying to finish the ServiceTitan"), cleaned.slice(0, 60));
  check("the contact is not named", !/Jay|Frias/.test(cleaned), cleaned);
  check("the business is not named", !/Most Valuable Plumber/i.test(cleaned), cleaned);
  check("the client ID survives", cleaned.includes("still needs the client ID, client secret and app key"), cleaned);
  check("the rest of the work survives", cleaned.includes("import past jobs and photos into Map Check-Ins"));
  check("nothing else was rewritten", cleaned.endsWith("schedule the posts across all profiles."));
}

scenario("Names, wherever they stand");
{
  check(
    "a first name on its own goes",
    withoutClientIdentity("Jay is waiting on the credentials.", plumber) === "The client is waiting on the credentials.",
    withoutClientIdentity("Jay is waiting on the credentials.", plumber),
  );
  check(
    "a surname on its own goes",
    withoutClientIdentity("Send Frias the report.", plumber) === "Send the client the report.",
    withoutClientIdentity("Send Frias the report.", plumber),
  );
  check(
    "a possessive stays possessive",
    withoutClientIdentity("Update Jay's listing.", plumber) === "Update the client's listing.",
    withoutClientIdentity("Update Jay's listing.", plumber),
  );
  check(
    "a curly apostrophe too",
    withoutClientIdentity("Update Jay’s listing.", plumber) === "Update the client's listing.",
  );
  check(
    "the business mid-sentence goes, without doubling the article",
    withoutClientIdentity("Audit the Most Valuable Plumber profile.", plumber) === "Audit the client profile.",
    withoutClientIdentity("Audit the Most Valuable Plumber profile.", plumber),
  );
  check(
    "two names in a row do not double up",
    !/the client the client/i.test(withoutClientIdentity("Most Valuable Plumber Jay Frias asked for this.", plumber)),
    withoutClientIdentity("Most Valuable Plumber Jay Frias asked for this.", plumber),
  );
  check(
    "a title on the contact is not needed to match",
    withoutClientIdentity("Maya asked for the report.", { contactName: "Dr. Maya Brooks" }) === "The client asked for the report.",
    withoutClientIdentity("Maya asked for the report.", { contactName: "Dr. Maya Brooks" }),
  );
}

scenario("What must not change");
{
  check(
    "the word client is left alone",
    withoutClientIdentity("Needs the client ID and client secret.", plumber) === "Needs the client ID and client secret.",
  );
  check(
    "a lower-case word that happens to be the name survives",
    withoutClientIdentity("Please mark the page as done.", { contactName: "Mark Powell" }) === "Please mark the page as done.",
    withoutClientIdentity("Please mark the page as done.", { contactName: "Mark Powell" }),
  );
  check(
    "a description with no name is untouched",
    withoutClientIdentity("Import past jobs into Map Check-Ins.", plumber) === "Import past jobs into Map Check-Ins.",
  );
  check(
    "a real sentence starting \"This is for\" is kept",
    withoutClientIdentity("This is for the credentials to arrive. Then import the jobs.", plumber)
      === "This is for the credentials to arrive. Then import the jobs.",
    withoutClientIdentity("This is for the credentials to arrive. Then import the jobs.", plumber),
  );
  check("an empty description stays empty", withoutClientIdentity("", plumber) === "");
  check("no identity means no masking", withoutClientIdentity("Jay Frias asked for this.", {}) === "Jay Frias asked for this.");
  check(
    "paragraph breaks survive",
    withoutClientIdentity("Jay asked for this.\n\nAgreed on the call: Friday.", plumber)
      === "The client asked for this.\n\nAgreed on the call: Friday.",
    JSON.stringify(withoutClientIdentity("Jay asked for this.\n\nAgreed on the call: Friday.", plumber)),
  );
}

scenario("A title is a fragment, not a document");
{
  check(
    "a title is masked the same way",
    withoutClientIdentity("Finish Jay Frias's ServiceTitan setup", plumber) === "Finish the client's ServiceTitan setup",
    withoutClientIdentity("Finish Jay Frias's ServiceTitan setup", plumber),
  );
  check("a title loses no words to the preamble rule",
    withoutClientIdentity("Import past jobs", plumber) === "Import past jobs");
}

scenario("The names that get masked");
{
  const names = maskedNames(plumber);
  check("the full name comes before its parts", names.indexOf("Jay Frias") < names.indexOf("Jay"), JSON.stringify(names));
  check("a two-letter name is not masked", !maskedNames({ contactName: "Jo Li" }).includes("Jo"), JSON.stringify(maskedNames({ contactName: "Jo Li" })));
  check("the rule is one the prompts can carry", CLIENT_ANONYMITY_RULE.includes("the client"));
  // The notes are filed in the account's own Client's Book, where the business is the title.
  check(
    "the notes rule is scoped to the fields that become tickets",
    ACTION_LINE_ANONYMITY_RULE.includes("departments[].actions[].what")
      && /rest of the notes.*names them normally/i.test(ACTION_LINE_ANONYMITY_RULE),
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(
  "\nNot covered here (needs an LLM provider):\n  - whether the model follows CLIENT_ANONYMITY_RULE without the masking behind it\n  - a name that appears in neither the client record nor the stakeholder map",
);
if (failures) {
  process.exitCode = 1;
}
