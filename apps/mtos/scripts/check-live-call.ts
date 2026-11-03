/**
 * Pins the live call: its three states, its clock, and how the approved brief becomes the parts
 * the account manager reads while a client is talking.
 *
 * Four things here are requirements rather than behaviour that happens to work:
 *
 *   1. The clock belongs to the call. Approving the brief puts the touch into READY and starts
 *      nothing; the elapsed time is measured from `callStartedAt` alone, so a brief approved on
 *      Monday for a Thursday call does not open with a three-day timer.
 *   2. A declined section is never presented. The guide and the deck are generated from the
 *      approved sections, but the decision is applied again at render, because an AM can decline a
 *      section after approving the brief.
 *   3. A part keeps its key when another part is dropped. The AM's capture notes are stored
 *      against the part, so the key is its position in the GENERATED guide. If it were the
 *      position on screen, declining a section would move somebody's notes under another heading.
 *   4. The part windows add up to the length the call was booked for. The last part ends on the
 *      planned minute rather than several minutes short of it, which is what makes "min 32–40 of
 *      40" worth reading mid-call.
 *
 * Exercises the pure rules rather than the screen around them. What is NOT covered is the
 * BroadcastChannel handshake between the presenter and the client window, and the autosave, both
 * noted at the end of the run.
 *
 * Run with: npm run check:live-call
 */
import {
  CALL_LENGTH_OPTIONS,
  DEFAULT_CALL_LENGTH_MINUTES,
  buildGuideParts,
  callBudget,
  callElapsedSeconds,
  callLengthMinutes,
  clientScreenChannel,
  clientScreenPath,
  formatClock,
  guidePartKey,
  isCallLength,
  isClientScreenMessage,
  liveHeader,
  livePhase,
  plannedClock,
  visibleSlides,
} from "@/src/lib/contracts/live-call";
import type { CallGuideSection, PresentationSlide } from "@/src/lib/mtos-data";

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

// ---------------------------------------------------------------------------

scenario("The call length the guide is timed against");
{
  check("forty minutes when the AM has set no default", callLengthMinutes(undefined) === 40);
  check("the default is one of the real lengths", isCallLength(DEFAULT_CALL_LENGTH_MINUTES));
  check("a length the team books is kept", callLengthMinutes(30) === 30 && callLengthMinutes(60) === 60);
  check("a length nobody books falls back to the default", callLengthMinutes(37) === 40);
  check("a string from a stored document is not a length", callLengthMinutes("45") === 40);
  check("every option is an option", CALL_LENGTH_OPTIONS.every((value) => isCallLength(value)));
}

// ---------------------------------------------------------------------------

scenario("The three states of the call, and READY is not one of them before approval");
{
  check("nothing recorded is not ready", livePhase(undefined) === "not_ready");
  check("an approval with no call is READY", livePhase({ readyAt: "2026-11-05T17:00:00.000Z" }) === "ready");
  check(
    "a started call is LIVE",
    livePhase({ readyAt: "2026-11-05T17:00:00.000Z", callStartedAt: "2026-11-05T18:00:00.000Z" }) === "live",
  );
  check(
    "an ended call is ENDED, whatever else is set",
    livePhase({
      readyAt: "2026-11-05T17:00:00.000Z",
      callStartedAt: "2026-11-05T18:00:00.000Z",
      callEndedAt: "2026-11-05T18:41:00.000Z",
    }) === "ended",
  );
}

// ---------------------------------------------------------------------------

scenario("The clock is the call's, not the approval's");
{
  // A touch in READY has a `readyAt` and no `callStartedAt`, which is the whole point: the clock
  // has nothing to count from until somebody presses Start call.
  check("a brief approved three days early shows no elapsed time", callElapsedSeconds({}) === 0);

  const live = { callStartedAt: "2026-11-05T18:00:00.000Z" };
  check(
    "a live call counts from the moment it was started",
    callElapsedSeconds(live, "2026-11-05T18:12:34.000Z") === 754,
    String(callElapsedSeconds(live, "2026-11-05T18:12:34.000Z")),
  );

  const ended = { callStartedAt: "2026-11-05T18:00:00.000Z", callEndedAt: "2026-11-05T18:41:30.000Z" };
  check(
    "an ended call is frozen at its own length, however long ago it was",
    callElapsedSeconds(ended, "2026-11-20T09:00:00.000Z") === 2490,
    String(callElapsedSeconds(ended, "2026-11-20T09:00:00.000Z")),
  );

  check(
    "a start in the future shows 00:00 rather than counting backwards",
    callElapsedSeconds({ callStartedAt: "2026-11-05T19:00:00.000Z" }, "2026-11-05T18:00:00.000Z") === 0,
  );
  check("an unparseable start is no call at all", callElapsedSeconds({ callStartedAt: "whenever" }) === 0);
}

scenario("The clock as it is read out");
{
  check("under a minute", formatClock(42) === "00:42", formatClock(42));
  check("minutes and seconds", formatClock(754) === "12:34", formatClock(754));
  check("past the hour it grows an hour", formatClock(3754) === "1:02:34", formatClock(3754));
  check("a negative never renders", formatClock(-5) === "00:00", formatClock(-5));
  check("the planned length matches the clock's shape", plannedClock(45) === "45:00", plannedClock(45));
}

scenario("How the call is doing against the time it was booked for");
{
  check("early in a 40-minute call", callBudget(600, 40).label === "30 min left", callBudget(600, 40).label);
  check("not over yet", callBudget(600, 40).over === false);
  check("on the planned minute reads as on the hour", callBudget(2400, 40).label === "on the hour");
  check(
    "forty seconds past is not yet a minute over",
    callBudget(2440, 40).over === false,
    callBudget(2440, 40).label,
  );
  check("three minutes over says so", callBudget(2580, 40).label === "3 min over", callBudget(2580, 40).label);
  check("and is marked over", callBudget(2580, 40).over === true);
}

// ---------------------------------------------------------------------------

scenario("The header says which state the call is in, and what to do about it");
{
  const notReady = liveHeader({ plannedMinutes: 40, formatLabel: "Call guide" });
  check("before approval there is no Start call button", notReady.canStart === false && notReady.canEnd === false);
  check("and it says what is missing", notReady.note.includes("Approve the brief"));
  check("with no clock, because there is no call", notReady.clock === "");

  const ready = liveHeader({
    live: { readyAt: "2026-11-05T17:00:00.000Z" },
    plannedMinutes: 45,
    formatLabel: "Client presentation",
  });
  check("READY offers Start call and nothing else", ready.canStart === true && ready.canEnd === false);
  check("READY names the format the approval built", ready.note.includes("Client presentation"));
  check("READY shows no clock", ready.clock === "");

  const live = liveHeader({
    live: { readyAt: "2026-11-05T17:00:00.000Z", callStartedAt: "2026-11-05T18:00:00.000Z" },
    plannedMinutes: 40,
    formatLabel: "Call guide",
    nowIso: "2026-11-05T18:12:34.000Z",
  });
  check("LIVE shows the clock", live.clock === "12:34", live.clock);
  check("LIVE shows the planned length beside it", live.note.includes("of 40:00 planned"), live.note);
  check("LIVE offers End call and not Start", live.canEnd === true && live.canStart === false);

  const ended = liveHeader({
    live: {
      readyAt: "2026-11-05T17:00:00.000Z",
      callStartedAt: "2026-11-05T18:00:00.000Z",
      callEndedAt: "2026-11-05T18:41:30.000Z",
    },
    plannedMinutes: 40,
    formatLabel: "Call guide",
  });
  check("CALL ENDED shows the length the call ran", ended.clock === "41:30", ended.clock);
  check("and offers neither button", ended.canStart === false && ended.canEnd === false);
}

// ---------------------------------------------------------------------------

const SECTIONS: CallGuideSection[] = [
  {
    title: "Open and set the agenda",
    minutes: 3,
    sectionId: "4",
    goal: "A warm start, then read the agenda.",
    say: "Thanks for making time — how was the month?",
    talkingPoints: ["Let her talk for a minute."],
    points: [{ text: "Let her talk for a minute.", chips: [{ kind: "mtos", label: "MTOS" }] }],
    clientPrompts: ["How was your month overall?"],
    qaChips: ["Client engagement"],
    next: "Before results — one thing I owe you.",
  },
  {
    title: "What I owe you",
    minutes: 5,
    sectionId: "1",
    talkingPoints: ["The mobile form is still not fixed."],
    clientPrompts: ["Is a Monday email the right way to keep you posted?"],
    ifSays: [{ says: "This should have been fixed weeks ago.", response: "Agree. Do not defend it." }],
  },
  {
    title: "June results",
    minutes: 8,
    sectionId: "8",
    talkingPoints: ["Calls from your profiles went up 18%."],
    clientPrompts: ["What is your first reaction?"],
  },
  {
    title: "Recap and close",
    minutes: 4,
    sectionId: "14",
    talkingPoints: ["Restate what was agreed, with owners and dates."],
    clientPrompts: ["Can you give me a date for the items on your side?"],
  },
];

scenario("The guide parts, timed for the call this client actually booked");
{
  const forty = buildGuideParts({ sections: SECTIONS, plannedMinutes: 40 });
  check("every part is there when nothing is declined", forty.length === 4, String(forty.length));
  check("the first part starts the call", forty[0].startMinute === 0);
  check(
    "the last part ends on the planned minute",
    forty[forty.length - 1].endMinute === 40,
    String(forty[forty.length - 1].endMinute),
  );
  check(
    "the windows run end to end with no gap",
    forty.every((part, index) => index === 0 || part.startMinute === forty[index - 1].endMinute),
  );
  // The four parts above total 20 generated minutes, so a 40-minute call stretches them to fill
  // it rather than leaving the AM twenty minutes of guide and twenty of silence.
  check("the window is written for reading mid-call", forty[0].window === "min 0–6 of 40", forty[0].window);
  check("a guide shorter than the call is stretched to fit it", forty[0].minutes === 6, String(forty[0].minutes));
  check("the parts are numbered as they are shown", forty.map((part) => part.n).join(",") === "1,2,3,4");

  const thirty = buildGuideParts({ sections: SECTIONS, plannedMinutes: 30 });
  check(
    "a shorter call scales the parts down",
    thirty[thirty.length - 1].endMinute === 30,
    String(thirty[thirty.length - 1].endMinute),
  );
  check("and nothing is dropped to make it fit", thirty.length === 4);
  check("every part keeps at least a minute", thirty.every((part) => part.minutes >= 1));

  const sixty = buildGuideParts({ sections: SECTIONS, plannedMinutes: 60 });
  check("a longer call gives every part more room", sixty[sixty.length - 1].endMinute === 60);
  check(
    "the recap grows with the call rather than staying at four minutes",
    sixty[3].minutes > forty[3].minutes,
    `${sixty[3].minutes} vs ${forty[3].minutes}`,
  );

  // Nine parts in a thirty-minute call: more parts than minutes once the minimum applies. The
  // windows must still read in order rather than collapsing onto one minute.
  const many = buildGuideParts({
    sections: Array.from({ length: 9 }, (_, index) => ({
      title: `Part ${index + 1}`,
      minutes: 1,
      talkingPoints: ["x"],
      clientPrompts: ["y"],
    })),
    plannedMinutes: 30,
  });
  check("a crowded guide is still in order", many.every((part, i) => i === 0 || part.startMinute >= many[i - 1].startMinute));
  check("and every part still has a minute", many.every((part) => part.minutes >= 1));
}

scenario("A section declined after the brief was approved is not presented");
{
  const parts = buildGuideParts({ sections: SECTIONS, plannedMinutes: 40, declinedSections: ["1"] });
  check("the declined part is gone", parts.length === 3 && !parts.some((part) => part.sectionId === "1"));
  check("the remaining parts are renumbered on screen", parts.map((part) => part.n).join(",") === "1,2,3");
  check(
    "but each keeps the key its notes are stored under",
    parts.map((part) => part.key).join(",") === "part-1,part-3,part-4",
    parts.map((part) => part.key).join(","),
  );
  check("the key is the generated position", guidePartKey(2) === "part-3");
  check(
    "and the shortened call still fills the planned length",
    parts[parts.length - 1].endMinute === 40,
    String(parts[parts.length - 1].endMinute),
  );

  const noSection = buildGuideParts({
    sections: [{ title: "Anything", minutes: 5, talkingPoints: ["x"], clientPrompts: ["y"] }],
    plannedMinutes: 40,
    declinedSections: ["1", "4", "8", "14"],
  });
  check(
    "a part that names no brief section is always presented",
    noSection.length === 1,
    "dropping a part that might belong to an approved section is the worse failure",
  );

  check("no guide at all is no parts, not a crash", buildGuideParts({ plannedMinutes: 40 }).length === 0);
  check(
    "every section declined leaves nothing to present",
    buildGuideParts({ sections: SECTIONS, plannedMinutes: 40, declinedSections: ["1", "4", "8", "14"] }).length === 0,
  );
}

scenario("A part carries what the AM reads, and an older guide still reads");
{
  const parts = buildGuideParts({ sections: SECTIONS, plannedMinutes: 40 });
  check("the line to say comes through", parts[0].say.startsWith("Thanks for making time"));
  check("so does the goal", parts[0].goal.includes("warm start"));
  check("the points keep their source chips", parts[0].points[0].chips?.[0]?.kind === "mtos");
  check("the client prompts are the asks", parts[0].ask[0] === "How was your month overall?");
  check("the pushback rows come through", parts[1].ifSays.length === 1);
  check("the QA chips come through", parts[0].qaChips[0] === "Client engagement");
  check("so does the bridge into the next part", parts[0].next.includes("one thing I owe you"));

  // A guide generated before the richer part existed: talking points, no `points`.
  const older = buildGuideParts({
    sections: [{ title: "Results", minutes: 8, talkingPoints: ["Calls up 18%", "  "], clientPrompts: ["Reaction?"] }],
    plannedMinutes: 40,
  });
  check("an older guide's talking points are its points", older[0].points[0].text === "Calls up 18%");
  check("and a blank one is not drawn as an empty bullet", older[0].points.length === 1);
  check("the fields it never had are empty, not missing", older[0].goal === "" && older[0].say === "");
}

// ---------------------------------------------------------------------------

const SLIDES: PresentationSlide[] = [
  { layout: "cover", title: "Monthly check-in" },
  { layout: "agenda", title: "What we will cover" },
  { layout: "bullets", title: "What we owe you", sectionId: "1" },
  { layout: "stat_callouts", title: "June results", sectionId: "8" },
  { layout: "closing", title: "Thank you" },
];

scenario("The deck shown on the call leaves out the declined sections");
{
  check("nothing declined shows the whole deck", visibleSlides(SLIDES).length === 5);
  const kept = visibleSlides(SLIDES, ["1"]);
  check("a declined section's slide is gone", kept.length === 4 && !kept.some((slide) => slide.sectionId === "1"));
  check(
    "the cover, the agenda and the closing stay, whatever is declined",
    visibleSlides(SLIDES, ["1", "8"]).map((slide) => slide.layout).join(",") === "cover,agenda,closing",
  );
  check("no deck is no slides, not a crash", visibleSlides(undefined, ["1"]).length === 0);
}

// ---------------------------------------------------------------------------

scenario("The client window follows the presenter and cannot be driven by anything else");
{
  check(
    "one channel per touch, so two clients cannot cross",
    clientScreenChannel("MT-002") !== clientScreenChannel("MT-003"),
  );
  check("the channel names the touch", clientScreenChannel("MT-002") === "mtos-client-screen:MT-002");
  check("the window has its own address", clientScreenPath("MT-002") === "/monthly-touch/MT-002/client-screen");
  check(
    "a touch id is escaped rather than pasted into the path",
    clientScreenPath("a/b") === "/monthly-touch/a%2Fb/client-screen",
    clientScreenPath("a/b"),
  );

  check("the handshake is a message", isClientScreenMessage({ type: "hello" }));
  check("so is a slide move", isClientScreenMessage({ type: "slide", index: 3 }));
  check("and the window closing", isClientScreenMessage({ type: "closed" }));
  check("a slide with no index is not a message", !isClientScreenMessage({ type: "slide" }));
  check("nor a fractional one", !isClientScreenMessage({ type: "slide", index: 1.5 }));
  check("nor a negative one", !isClientScreenMessage({ type: "slide", index: -1 }));
  check("nor something else entirely", !isClientScreenMessage({ type: "navigate", url: "https://example.com" }));
  check("nor a bare string", !isClientScreenMessage("slide"));
  check("nor nothing", !isClientScreenMessage(null));
}

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures} of ${checks} checks passed.`);
console.log(
  [
    "",
    "Not covered here (needs a browser or Firestore, so it is checked by hand on a real call):",
    "  - the BroadcastChannel handshake between the presenter and the client window, and what the",
    "    client sees when the presenter window is closed mid-call",
    "  - the capture notes autosave, and that `live.notes` is replaced rather than merged",
    "  - whether the slide the client window renders is pixel-identical to the exported .pptx",
  ].join("\n"),
);

if (failures > 0) {
  process.exitCode = 1;
}
