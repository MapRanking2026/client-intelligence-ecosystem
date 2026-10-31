/**
 * Pins the post-meeting review's rules.
 *
 * Three things here are requirements rather than behaviour that happens to work:
 *
 *   1. The score is a gate, not a label. A score of 6 or below REQUIRES a Risk Register entry;
 *      7 or above does not. The account manager may still decline a required entry -- the notes
 *      then carry an open "skipped at review" line -- but they cannot leave it undecided.
 *   2. One submission. The score, every ticket, both register entries and the client email are
 *      checked together and applied together. Nothing is written before that one press, and
 *      nothing the AM typed is lost on the way to it.
 *   3. The post-meeting notes live INSIDE that touch's `Pre-Monthly Touch Notes` page, never
 *      beside it. The parent is matched by name and date across every format the team writes, and
 *      when nothing matches -- or more than one page could -- nothing is guessed.
 *
 * Exercises the pure rule modules rather than the services around them, for the same reason the
 * preparation checks do: a rule that needs Firestore, ClickUp and a model provider to run is a rule
 * nobody checks. What is NOT covered is the live I/O, noted at the end of the run.
 *
 * Run with: npm run check:post-meeting-review
 */
import type { RiskRegisterEntry, StakeholderMapEntry } from "@/src/lib/mtos-data";
import {
  healthFromNps,
  npsBand,
  reviewBlockers,
  riskFlagCount,
  riskRegisterGaps,
  riskRegisterRequired,
  riskTierFromFlagCount,
  stakeholderMapGaps,
  type ReviewSubmission,
} from "@/src/lib/contracts/post-meeting-review";
import {
  dateVariants,
  findPostNotesPage,
  findPreNotesPage,
  postNotesPageName,
  preNotesPageName,
} from "@/src/lib/server/services/client-book-pages";

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

/** The meeting this file reasons about: 28 October 2026, 10am Pacific. */
const TOUCH_DATE = "2026-10-28T17:00:00.000Z";

// ---------------------------------------------------------------------------
scenario("The score decides whether the Risk Register entry is mandatory");
{
  check("6 requires it", riskRegisterRequired(6));
  check("5 requires it", riskRegisterRequired(5));
  check("1 requires it", riskRegisterRequired(1));
  check("0 requires it", riskRegisterRequired(0));
  check("7 does not", !riskRegisterRequired(7));
  check("8 does not", !riskRegisterRequired(8));
  check("10 does not", !riskRegisterRequired(10));
  check(
    "no score given requires nothing — a missing score is not a low score",
    !riskRegisterRequired(null),
  );
}

// ---------------------------------------------------------------------------
scenario("Bands and the Health Tracker line follow the score");
{
  check("9 is healthy", npsBand(9) === "Healthy");
  check("10 is healthy", npsBand(10) === "Healthy");
  check("8 is stable with friction", npsBand(8) === "Stable with friction");
  check("7 is stable with friction", npsBand(7) === "Stable with friction");
  check("6 is at risk", npsBand(6) === "At risk");
  check("5 is at risk", npsBand(5) === "At risk");
  check("4 is critical", npsBand(4) === "Critical");
  check("2 is churn imminent", npsBand(2) === "Churn imminent");

  check("9 reads Good on the row", healthFromNps(9) === "Good");
  check("7 reads Neutral on the row", healthFromNps(7) === "Neutral");
  check("6 reads Risk on the row", healthFromNps(6) === "Risk");
  check("no score writes nothing to the row", healthFromNps(null) === null);
}

// ---------------------------------------------------------------------------
scenario("Risk Score counts answered flags; the tier follows the count");
{
  const none: RiskRegisterEntry = {
    money: "No",
    responsiveness: "No",
    lifeChange: "No",
    technical: "No",
    otherAgency: "No",
    performance: "No",
  };
  check("six explicit Nos are zero flags, not six", riskFlagCount(none) === 0);
  check("zero flags is Healthy", riskTierFromFlagCount(0) === "Healthy");
  check("one flag is Low", riskTierFromFlagCount(1) === "Low");
  check("two flags is Medium", riskTierFromFlagCount(2) === "Medium");
  check("three flags is Medium", riskTierFromFlagCount(3) === "Medium");
  check("four flags is High", riskTierFromFlagCount(4) === "High");
  check("five flags is High", riskTierFromFlagCount(5) === "High");
  check("six flags is Critical", riskTierFromFlagCount(6) === "Critical");
  check(
    "a maybe is not a Yes",
    riskFlagCount({ ...none, lifeChange: "maybe" }) === 0,
  );
  check(
    "a kind-of is not a Yes",
    riskFlagCount({ ...none, otherAgency: "kind of" }) === 0,
  );
  check("two Yes answers count two", riskFlagCount({ ...none, money: "Yes", performance: "Yes" }) === 2);
}

// ---------------------------------------------------------------------------
scenario("A half-filled entry is not an entry");
{
  const bare: RiskRegisterEntry = { caseStatus: "Watching", dateFlagged: "2026-10-28" };
  const gaps = riskRegisterGaps(bare);
  check("a case status and a flag date alone leaves gaps", gaps.length > 0);
  check("the unanswered threat fields are named", gaps.includes("Performance"));
  check("the tier is named", gaps.includes("Risk Tier"));
  check("the owner is named", gaps.includes("Next Action Owner"));
  check("the category is named", gaps.includes("Primary Category"));
  check("what IS filled is not reported missing", !gaps.includes("Case Status"));

  const full: RiskRegisterEntry = {
    caseStatus: "Working",
    money: "No",
    responsiveness: "Yes",
    lifeChange: "No",
    technical: "No",
    otherAgency: "No",
    performance: "Yes",
    riskScore: 2,
    riskTier: "Medium",
    dateFlagged: "2026-10-28",
    nextAction: "Call Thursday",
    nextActionOwner: "Ian",
    primaryCategory: "Communication",
  };
  check("a complete entry has no gaps", riskRegisterGaps(full).length === 0, riskRegisterGaps(full).join(", "));
  check(
    "an explicit No counts as answered",
    riskRegisterGaps({ ...full, money: "No" }).length === 0,
  );
  check(
    "a blank threat field does not",
    riskRegisterGaps({ ...full, money: undefined }).includes("Money / Cash Flow"),
  );

  const stake: StakeholderMapEntry = {
    clientName: "Tal Lancry",
    role: "owner/CEO",
    communicationPreference: "Text/Chat",
    marketingLiteracy: "Low",
    personality: "Distant",
    whatTheyCareAbout: "Leads + Calls",
  };
  check("a complete stakeholder entry has no gaps", stakeholderMapGaps(stake).length === 0);
  check(
    "email is not required — it is only known when given",
    stakeholderMapGaps({ ...stake }).length === 0,
  );
  check(
    "a missing role is reported",
    stakeholderMapGaps({ ...stake, role: "" }).includes("Role / Title"),
  );
}

// ---------------------------------------------------------------------------
scenario("The whole review submits in one press, or says exactly what is left");

const COMPLETE_RISK: RiskRegisterEntry = {
  caseStatus: "Working",
  money: "No",
  responsiveness: "Yes",
  lifeChange: "No",
  technical: "No",
  otherAgency: "No",
  performance: "No",
  riskTier: "Low",
  dateFlagged: "2026-10-28",
  nextAction: "Call Thursday",
  nextActionOwner: "Ian",
  primaryCategory: "Communication",
};

function submission(patch: Partial<ReviewSubmission> = {}): ReviewSubmission {
  return {
    nps: 8,
    npsReason: "replies slowed to weekly, still warm",
    npsChosen: true,
    tickets: [{ decision: "approved", title: "Add geo negatives — Comfort Pro", description: "Out-of-area terms are burning spend." }],
    email: { subject: "Your October recap", body: "Here is where we landed.", approve: true },
    ...patch,
  };
}

{
  check("a complete review has nothing left", reviewBlockers(submission()).length === 0, reviewBlockers(submission()).join(" | "));

  const unchosen = reviewBlockers(submission({ npsChosen: false }));
  check("the score has to be picked", unchosen.some((line) => line.includes("Pick the NPS")));
  check(
    "and the reason why says what the score decides",
    unchosen.some((line) => line.includes("mandatory")),
  );

  check(
    "a score with no reason is not finished",
    reviewBlockers(submission({ npsReason: "  " })).some((line) => line.includes("one short line")),
  );

  check(
    "an undecided ticket blocks",
    reviewBlockers(submission({ tickets: [{ decision: undefined, title: "x", description: "y" }] })).some((line) =>
      line.includes("Decide the remaining"),
    ),
  );
  check(
    "two undecided tickets are counted, not listed one at a time",
    reviewBlockers(
      submission({
        tickets: [
          { decision: undefined, title: "a", description: "b" },
          { decision: undefined, title: "c", description: "d" },
        ],
      }),
    ).some((line) => line.includes("2 tickets")),
  );
  check(
    "an approved ticket with no description blocks",
    reviewBlockers(submission({ tickets: [{ decision: "approved", title: "a", description: " " }] })).some((line) =>
      line.includes("missing a name or a description"),
    ),
  );
  check(
    "a declined ticket needs no content",
    reviewBlockers(submission({ tickets: [{ decision: "declined", title: "", description: "" }] })).length === 0,
  );
  check(
    "a billing ticket needs its change type",
    reviewBlockers(
      submission({
        tickets: [{ decision: "approved", title: "Pause billing — Comfort Pro", description: "Client asked to pause.", ticketType: "billing" }],
      }),
    ).some((line) => line.includes("change type")),
  );

  // The gate itself.
  const lowUndecided = reviewBlockers(
    submission({ nps: 6, risk: { decision: undefined, entry: COMPLETE_RISK, offered: true } }),
  );
  check("a score of 6 with the entry undecided blocks", lowUndecided.some((line) => line.includes("requires a Risk Register entry")));
  check("the blocker names the score", lowUndecided.some((line) => line.includes("score of 6")));

  check(
    "a score of 7 with the entry undecided does not block",
    reviewBlockers(submission({ nps: 7, risk: { decision: undefined, entry: {}, offered: true } })).length === 0,
  );

  check(
    "declining a required entry is allowed — the notes carry it as an open item instead",
    reviewBlockers(submission({ nps: 6, risk: { decision: "declined", entry: {}, offered: true } })).length === 0,
  );

  check(
    "approving a required entry with gaps blocks, and names them",
    reviewBlockers(
      submission({ nps: 6, risk: { decision: "approved", entry: { caseStatus: "Working" }, offered: true } }),
    ).some((line) => line.includes("Risk Tier")),
  );
  check(
    "approving a complete required entry does not block",
    reviewBlockers(submission({ nps: 6, risk: { decision: "approved", entry: COMPLETE_RISK, offered: true } })).length === 0,
  );
  check(
    "a required entry MTOS never produced is said plainly, not silently skipped",
    reviewBlockers(submission({ nps: 6, risk: { decision: undefined, entry: {}, offered: false } })).some((line) =>
      line.includes("by hand"),
    ),
  );

  check(
    "approving a stakeholder entry with gaps blocks",
    reviewBlockers(
      submission({ stakeholder: { decision: "approved", entry: { clientName: "Tal Lancry" }, offered: true } }),
    ).some((line) => line.includes("Role / Title")),
  );
  check(
    "declining a stakeholder entry never blocks",
    reviewBlockers(submission({ stakeholder: { decision: "declined", entry: {}, offered: true } })).length === 0,
  );

  check(
    "an approved email with no body blocks",
    reviewBlockers(submission({ email: { subject: "x", body: " ", approve: true } })).some((line) =>
      line.includes("recap email"),
    ),
  );
  check(
    "an unapproved email needs nothing",
    reviewBlockers(submission({ email: { subject: "", body: "", approve: false } })).length === 0,
  );

  check(
    "several things left are all reported, not just the first",
    reviewBlockers(
      submission({
        npsChosen: false,
        tickets: [{ decision: undefined, title: "", description: "" }],
        email: { subject: "", body: "", approve: true },
      }),
    ).length >= 3,
  );
}

// ---------------------------------------------------------------------------
scenario("The post notes go inside this touch's pre-notes page, never beside it");
{
  check(
    "the prep page carries the new name and the touch's local date",
    preNotesPageName(TOUCH_DATE) === "Pre-Monthly Touch Notes 10/28/2026",
    preNotesPageName(TOUCH_DATE),
  );
  check(
    "a late-evening Pacific call does not file itself under tomorrow",
    preNotesPageName("2026-10-29T03:00:00.000Z") === "Pre-Monthly Touch Notes 10/28/2026",
    preNotesPageName("2026-10-29T03:00:00.000Z"),
  );

  check(
    "the subpage copies the parent's own date format",
    postNotesPageName("Pre-Monthly Touch Notes Oct 28, 2026", TOUCH_DATE) === "Post-Monthly Touch Notes Oct 28, 2026",
    postNotesPageName("Pre-Monthly Touch Notes Oct 28, 2026", TOUCH_DATE),
  );
  check(
    "an ISO-dated parent gets an ISO-dated child",
    postNotesPageName("Pre-Monthly Touch Notes 2026-10-28", TOUCH_DATE) === "Post-Monthly Touch Notes 2026-10-28",
    postNotesPageName("Pre-Monthly Touch Notes 2026-10-28", TOUCH_DATE),
  );
  check(
    "a parent whose title has no date still gets a dated child",
    postNotesPageName("Pre-Monthly Touch Notes", TOUCH_DATE) === "Post-Monthly Touch Notes 10/28/2026",
    postNotesPageName("Pre-Monthly Touch Notes", TOUCH_DATE),
  );

  const variants = dateVariants(TOUCH_DATE);
  for (const expected of ["2026-10-28", "10/28/2026", "oct 28, 2026", "october 28", "10/28/26"]) {
    check(`"${expected}" is a date format the match understands`, variants.includes(expected));
  }

  const found = findPreNotesPage(
    [
      { id: "sep", name: "Pre-Monthly Touch Notes 9/28/2026" },
      { id: "oct", name: "Pre Monthly Touch Notes Oct 28, 2026" },
      { id: "plan", name: "Strategic Action Plan" },
    ],
    TOUCH_DATE,
  );
  check("this touch's page is found across spelling and date format", found.kind === "found" && found.page.id === "oct");

  const wrongMonth = findPreNotesPage([{ id: "sep", name: "Pre-Monthly Touch Notes 9/28/2026" }], TOUCH_DATE);
  check("last month's page is not this month's", wrongMonth.kind === "none");

  const ambiguous = findPreNotesPage(
    [
      { id: "a", name: "Pre-Monthly Touch Notes 10/28/2026" },
      { id: "b", name: "Pre-MT Notes Oct 28" },
    ],
    TOUCH_DATE,
  );
  check("two candidates for one date is ambiguous, never a guess", ambiguous.kind === "ambiguous");
  check(
    "and both candidates come back so the AM can pick",
    ambiguous.kind === "ambiguous" && ambiguous.candidates.length === 2,
  );

  const legacy = findPreNotesPage([{ id: "old", name: "Monthly Touch (10/28/2026)" }], TOUCH_DATE);
  check("a page under the old naming is not treated as a pre-notes page", legacy.kind === "none");
  check(
    "but it is offered as the page the AM probably means",
    legacy.kind === "none" && legacy.legacyCandidates.some((page) => page.id === "old"),
  );

  check("no pages at all means none, not a crash", findPreNotesPage([], TOUCH_DATE).kind === "none");

  check(
    "an existing post subpage is recognised",
    findPostNotesPage([{ id: "p", name: "Post-Monthly Touch Notes 10/28/2026" }])?.id === "p",
  );
  check(
    "and so is the unhyphenated spelling",
    findPostNotesPage([{ id: "p", name: "Post Monthly Touch Notes Oct 28" }])?.id === "p",
  );
  check(
    "an unrelated subpage is not mistaken for one",
    findPostNotesPage([{ id: "x", name: "Call recording" }]) === undefined,
  );
}

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures} of ${checks} checks passed.`);
console.log(
  [
    "",
    "Not covered here (needs live credentials, so it is checked by hand against a real account):",
    "  - the ClickUp ticket creation, and the Health Tracker row write for each approved entry",
    "  - the ClickUp page write: the pre-notes page, and the post-notes subpage under it",
    "  - the Intercom conversation read, and its refusal when the app lacks the permission",
    "  - the model calls that suggest the score and write the notes",
  ].join("\n"),
);

if (failures > 0) {
  process.exitCode = 1;
}
