/**
 * The five call labels, their three layers, and the two rules that cannot fire without text.
 *
 * The thing most worth pinning here is a negative: a call is never labelled "Job seeker" or
 * "Spam"-by-wording because it was short. Those two readings need to know what was said, and
 * GoHighLevel usually carries no transcript, so the rules must reach them only when there is text
 * and must say so when there is not. A dashboard that invented "Job seeker" from a duration would
 * put a word in a client's mouth.
 *
 *   npm run --silent check:call-labels
 */
import {
  CALL_LABELS,
  CALL_LABEL_LABEL,
  GOOD_CALL_MIN_SECONDS,
  HANGUP_MAX_SECONDS,
  automaticCallLabel,
  callLabelFromVerdict,
  hasRecordedDirection,
  isInboundCall,
  moreIsBetter,
  resolveCallLabel,
  type CallLabel,
} from "@/src/lib/contracts/call-labels";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAILED: ${label}`);
  }
}

console.log("\nnobody answered");
{
  for (const status of ["missed", "no-answer", "no_answer", "voicemail", "busy", "failed", "canceled", "unanswered", "declined"]) {
    check(`"${status}" is a missed call`, automaticCallLabel({ callStatus: status }).label === "missed");
  }
  check(
    "a voicemail mentioning hiring is still missed, not a job seeker",
    automaticCallLabel({ callStatus: "voicemail", text: "hi, are you hiring right now?" }).label === "missed",
  );
  check(
    "nothing recorded at all is missed",
    automaticCallLabel({}).label === "missed",
  );
  check(
    "the reason quotes what GoHighLevel actually said",
    automaticCallLabel({ callStatus: "voicemail" }).reason.includes("voicemail"),
  );
}

console.log("\nanswered, judged on length");
{
  check(
    `${GOOD_CALL_MIN_SECONDS}s is a good call`,
    automaticCallLabel({ durationSec: GOOD_CALL_MIN_SECONDS, callStatus: "completed" }).label === "good",
  );
  check(
    "a long call is a good call",
    automaticCallLabel({ durationSec: 240, callStatus: "completed" }).label === "good",
  );
  check(
    `${GOOD_CALL_MIN_SECONDS - 1}s is not yet good`,
    automaticCallLabel({ durationSec: GOOD_CALL_MIN_SECONDS - 1, callStatus: "completed" }).label !== "good",
  );
  check(
    `${HANGUP_MAX_SECONDS - 1}s is a hang-up, counted as spam`,
    automaticCallLabel({ durationSec: HANGUP_MAX_SECONDS - 1, callStatus: "completed" }).label === "spam",
  );
  check(
    `${HANGUP_MAX_SECONDS}s is past the hang-up ceiling`,
    automaticCallLabel({ durationSec: HANGUP_MAX_SECONDS, callStatus: "completed" }).label !== "spam",
  );
  check(
    "an in-between call is unrelated, not good",
    automaticCallLabel({ durationSec: 12, callStatus: "completed" }).label === "unrelated",
  );
  check(
    "and it admits the reading came from the length alone",
    automaticCallLabel({ durationSec: 12, callStatus: "completed" }).reason.includes("no call text"),
  );
  check(
    "with text present it stops saying that",
    !automaticCallLabel({ durationSec: 12, callStatus: "completed", text: "hello?" }).reason.includes("no call text"),
  );
  check(
    "the good-call reason gives the length",
    automaticCallLabel({ durationSec: 95, callStatus: "completed" }).reason.includes("95s"),
  );
}

console.log("\nthe two labels that need to know what was said");
{
  const jobSeekerLines = [
    "Hi, are you hiring at the moment?",
    "I'm looking for a job, do you have any openings",
    "I wanted to apply for a position I saw",
    "can I send you my resume",
    "are you accepting applications right now",
    "is the position still available",
  ];
  for (const line of jobSeekerLines) {
    check(
      `"${line.slice(0, 34)}…" is a job seeker`,
      automaticCallLabel({ durationSec: 45, callStatus: "completed", text: line }).label === "job_seeker",
    );
  }

  const spamLines = [
    "press one to speak to an agent about your listing",
    "this is not a sales call, we noticed your Google business is not verified",
    "final notice regarding your account",
    "we can rank your website on the first page",
    "calling about your medicare benefits",
  ];
  for (const line of spamLines) {
    check(
      `"${line.slice(0, 34)}…" is spam`,
      automaticCallLabel({ durationSec: 45, callStatus: "completed", text: line }).label === "spam",
    );
  }

  check(
    "a wrong number says so",
    automaticCallLabel({ durationSec: 9, callStatus: "completed", text: "oh sorry, wrong number" }).label === "unrelated",
  );

  // The point of the whole file.
  check(
    "a short call with NO text is never a job seeker",
    automaticCallLabel({ durationSec: 3, callStatus: "completed" }).label !== "job_seeker",
  );
  check(
    "a long call with NO text is never a job seeker",
    automaticCallLabel({ durationSec: 300, callStatus: "completed" }).label !== "job_seeker",
  );
  check(
    "no length alone ever produces a job seeker",
    [0, 1, 5, 6, 19, 20, 21, 59, 60, 120, 600].every(
      (durationSec) => automaticCallLabel({ durationSec, callStatus: "completed" }).label !== "job_seeker",
    ),
  );
  check(
    "a robocall about jobs is spam, not a job seeker",
    automaticCallLabel({
      durationSec: 40,
      callStatus: "completed",
      text: "press 1 if you are looking for a job with our hiring partners",
    }).label === "spam",
  );
}

console.log("\nreading an old nine-category verdict");
{
  check("a missed_call status reads as missed", callLabelFromVerdict("missed_call", "valid_new_lead") === "missed");
  check("spam reads as spam", callLabelFromVerdict("flagged", "spam") === "spam");
  check("a sales solicitation reads as spam", callLabelFromVerdict("flagged", "sales_solicitation") === "spam");
  check("a wrong number reads as unrelated", callLabelFromVerdict("flagged", "wrong_number") === "unrelated");
  check("out of area reads as unrelated", callLabelFromVerdict("flagged", "out_of_area") === "unrelated");
  check("a valid new lead reads as good", callLabelFromVerdict("valid", "valid_new_lead") === "good");
  check("an existing customer conversation reads as good", callLabelFromVerdict("valid", "existing_customer") === "good");
  check(
    "needs_review translates to nothing, because it means nobody could tell",
    callLabelFromVerdict("needs_review", "valid_new_lead") === undefined,
  );
  check("a duplicate translates to nothing", callLabelFromVerdict("valid", "duplicate") === undefined);
  check("an incomplete lead translates to nothing", callLabelFromVerdict("valid", "incomplete") === undefined);
  check("nothing in translates to nothing out", callLabelFromVerdict(undefined, undefined) === undefined);
  check(
    "no old verdict ever translates to a job seeker, because the old system had no such category",
    (["valid", "flagged", "needs_review", "missed_call"] as const).every((status) =>
      (
        [
          "valid_new_lead",
          "spam",
          "duplicate",
          "existing_customer",
          "wrong_number",
          "sales_solicitation",
          "out_of_area",
          "incomplete",
          "irrelevant",
        ] as const
      ).every((category) => callLabelFromVerdict(status, category) !== "job_seeker"),
    ),
  );
}

console.log("\nwhich layer wins");
{
  const base = { status: "valid", category: "valid_new_lead", callDurationSec: 300, callStatus: "completed" } as const;

  const manual = resolveCallLabel({ ...base, callLabel: "spam", labelSource: "manual" });
  check("a manual label wins over a 300s good call", manual.label === "spam");
  check("and is attributed to the person", manual.source === "manual");
  check("and has a reason even when none was stored", manual.reason.length > 0);

  const ai = resolveCallLabel({ ...base, callLabel: "job_seeker", labelSource: "ai", labelReason: "asked about work" });
  check("an AI label wins over the automatic rules", ai.label === "job_seeker");
  check("and is attributed to AI review", ai.source === "ai");
  check("and keeps its own stored reason", ai.reason === "asked about work");

  const auto = resolveCallLabel(base);
  check("with no stored label the rules answer", auto.label === "good");
  check("and are attributed to the rule", auto.source === "automatic");

  const manualWithoutLabel = resolveCallLabel({ ...base, labelSource: "manual" });
  check(
    "a manual source with no label falls through rather than crashing",
    manualWithoutLabel.source === "automatic" && manualWithoutLabel.label === "good",
  );

  const verdictWins = resolveCallLabel({
    status: "flagged",
    category: "spam",
    callDurationSec: 300,
    callStatus: "completed",
  });
  check("a stored spam verdict beats a long duration", verdictWins.label === "spam");
  check("and says where it came from", verdictWins.reason.includes("earlier verification"));

  const textBeatsVerdict = resolveCallLabel({
    status: "needs_review",
    category: "valid_new_lead",
    callDurationSec: 45,
    callStatus: "completed",
    transcript: "are you hiring",
  });
  check("an unhelpful old verdict gives way to the call text", textBeatsVerdict.label === "job_seeker");
}

console.log("\ndirection");
{
  check("inbound is inbound", isInboundCall("inbound"));
  check("outbound is not", !isInboundCall("outbound"));
  check("\"out\" is not", !isInboundCall("out"));
  check("case does not matter", !isInboundCall("OUTBOUND"));
  check("a missing direction is assumed inbound", isInboundCall(undefined));
  check("an empty direction is assumed inbound", isInboundCall(""));
  check("but a missing direction is known to be unrecorded", !hasRecordedDirection(undefined));
  check("and an empty one too", !hasRecordedDirection("  "));
  check("a real direction is recorded", hasRecordedDirection("inbound"));
}

console.log("\ndirection of good news");
{
  check("more good calls is better", moreIsBetter("good"));
  for (const label of ["missed", "spam", "job_seeker", "unrelated"] as CallLabel[]) {
    check(`more ${CALL_LABEL_LABEL[label]} is NOT better`, !moreIsBetter(label));
  }
  check("exactly one label rises in the good direction", CALL_LABELS.filter(moreIsBetter).length === 1);
}

console.log("\nthe label set itself");
{
  check("there are five labels", CALL_LABELS.length === 5);
  check("every label has a display name", CALL_LABELS.every((label) => Boolean(CALL_LABEL_LABEL[label])));
  check(
    "no display name is a snake_case internal",
    CALL_LABELS.every((label) => !CALL_LABEL_LABEL[label].includes("_")),
  );
  check("every automatic label is one of the five", CALL_LABELS.includes(automaticCallLabel({}).label));
  check(
    "every reason is a sentence, not a code",
    [
      automaticCallLabel({}),
      automaticCallLabel({ durationSec: 300, callStatus: "completed" }),
      automaticCallLabel({ durationSec: 2, callStatus: "completed" }),
      automaticCallLabel({ durationSec: 40, callStatus: "completed", text: "are you hiring" }),
    ].every((result) => result.reason.length > 20 && result.reason.endsWith(".")),
  );
}

console.log(
  [
    "",
    "Not covered by these checks: whether GoHighLevel actually supplies a transcript for any real",
    "call (it usually does not), whether the AI review pass sets labelSource correctly, whether a",
    "manual label survives a re-pull end to end, and whether these five labels match what an AM",
    "would have called the same call -- that one needs a person listening to recordings.",
    "",
    `${passed} passed, ${failed} failed`,
  ].join("\n"),
);

if (failed) {
  process.exit(1);
}
