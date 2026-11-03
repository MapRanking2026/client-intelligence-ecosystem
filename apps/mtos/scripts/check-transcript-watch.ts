/**
 * Pins which Gemini notes Doc is the call, and when the follow-through may be opened.
 *
 * This is the one judgement in the whole touch that nothing downstream can correct. The recap
 * email, the tickets, the notes and the QA review are all written from whatever comes out of
 * here, so picking the wrong Doc produces a confident, well-written account of a meeting that
 * did not happen. Four rules follow from that:
 *
 *   1. A Doc earns its place by carrying dialogue. Gemini writes one notes Doc per language and
 *      for a Spanish-speaking client the English one is a summary with no transcript at all, so
 *      the language orders the reads and breaks ties — it never decides on its own.
 *   2. Two Docs with dialogue in the SAME language are one call in two parts (stopped and
 *      redialled) and are joined in time order.
 *   3. Two Docs with dialogue in DIFFERENT languages are the same call written twice. One is
 *      used and the other is kept for reference, because joining both counts every sentence
 *      twice.
 *   4. The wait ends either way. Fifteen minutes, and the poll continues afterwards.
 *
 * And one that is easy to lose: `/transcript/i` does not match "Transcripción", so a Spanish
 * call read with the English-only pattern comes back as a call nobody transcribed.
 *
 * Exercises the pure rules. What is NOT covered is the Google reads themselves and the Firestore
 * writes, noted at the end of the run.
 *
 * Run with: npm run check:transcript-watch
 */
import {
  FULL_NOTES_TAB_PATTERN,
  MIN_DIALOGUE_CHARS,
  TRANSCRIPT_TAB_PATTERN,
  TX_POLL_MS,
  TX_WAIT_MS,
  geminiDocLanguage,
  geminiDocWallClock,
  orderNotesDocs,
  selectTranscriptDocs,
  transcriptWaitPanel,
  transcriptWaitView,
  type NotesDocRead,
} from "@/src/lib/contracts/transcript-watch";

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

/** Dialogue long enough to be taken for the call, without filling this file with it. */
function dialogue(words: number): string {
  return Array.from({ length: words }, (_, index) => `line ${index + 1} of what was said`).join("\n");
}

function doc(partial: Partial<NotesDocRead> & { docId: string; name: string }): NotesDocRead {
  return { transcript: "", fullNotes: "", ...partial };
}

// ---------------------------------------------------------------------------

scenario("The Transcript tab, in both languages");
{
  check("the English tab matches", TRANSCRIPT_TAB_PATTERN.test("Transcript"));
  check(
    "and so does the Spanish one",
    TRANSCRIPT_TAB_PATTERN.test("Transcripción"),
    "`/transcript/i` does not — its tenth letter is a c, not a t",
  );
  check("a mojibaked tab emoji does not hide it", TRANSCRIPT_TAB_PATTERN.test("ð Transcript"));
  check("full notes matches both", FULL_NOTES_TAB_PATTERN.test("Full notes") && FULL_NOTES_TAB_PATTERN.test("Notas completas"));
  check(
    "and never the abbreviated duplicate",
    !FULL_NOTES_TAB_PATTERN.test("Quick notes") && !FULL_NOTES_TAB_PATTERN.test("Notas rápidas"),
  );
}

scenario("Which language a notes Doc is in, read off its title");
{
  check("the parenthesis Gemini appends", geminiDocLanguage("Call - Notes by Gemini (Spanish)") === "es");
  check("the Spanish word for it", geminiDocLanguage("Llamada - Notes by Gemini (Español)") === "es");
  check("the Spanish product name", geminiDocLanguage("Llamada - 2026/07/03 10:00 PT - Notas de Gemini") === "es");
  check("plain English notes", geminiDocLanguage("Call - 2026/07/03 10:00 PT - Notes by Gemini") === "en");
  check("the English parenthesis", geminiDocLanguage("Call - Notes by Gemini (English)") === "en");
  check(
    "an unlabelled Doc is not assumed English",
    geminiDocLanguage("Oakline monthly touch notes") === undefined,
    "assuming English is what sends a Spanish call's dialogue to the bottom of the pile",
  );
}

scenario("The call time out of a Gemini title");
{
  check(
    "parsed as a sortable wall clock",
    geminiDocWallClock("Oakline - 2026/07/03 10:00 PT - Notes by Gemini") === "2026/07/03 10:00",
    String(geminiDocWallClock("Oakline - 2026/07/03 10:00 PT - Notes by Gemini")),
  );
  check(
    "a single-digit hour is padded, so it sorts",
    geminiDocWallClock("Oakline - 2026/07/03 9:05 PT - Notes by Gemini") === "2026/07/03 09:05",
    String(geminiDocWallClock("Oakline - 2026/07/03 9:05 PT - Notes by Gemini")),
  );
  check("and 09:05 sorts before 10:00", "2026/07/03 09:05".localeCompare("2026/07/03 10:00") < 0);
  check("a title with no clock in it has none", geminiDocWallClock("Notes by Gemini") === undefined);
}

// ---------------------------------------------------------------------------

scenario("The order the attachments are read in");
{
  const docs = [
    { docId: "en", name: "Oakline - 2026/07/03 10:00 PT - Notes by Gemini (English)" },
    { docId: "es2", name: "Oakline - 2026/07/03 10:26 PT - Notas de Gemini" },
    { docId: "es1", name: "Oakline - 2026/07/03 10:00 PT - Notas de Gemini" },
  ];
  check(
    "a Spanish client's Docs are read first",
    orderNotesDocs(docs, "es").map((entry) => entry.docId).join(",") === "es1,es2,en",
    orderNotesDocs(docs, "es").map((entry) => entry.docId).join(","),
  );
  check(
    "and the parts of the call in time order within that",
    orderNotesDocs(docs, "es")[0].docId === "es1",
  );
  check(
    "an English client's Doc goes first for them",
    orderNotesDocs(docs, "en")[0].docId === "en",
  );
  check(
    "with no preference the clock alone orders them",
    orderNotesDocs(docs).map((entry) => entry.docId).join(",") === "en,es1,es2" ||
      orderNotesDocs(docs).map((entry) => entry.docId).join(",") === "es1,en,es2",
    orderNotesDocs(docs).map((entry) => entry.docId).join(","),
  );
  check("ordering never drops an attachment", orderNotesDocs(docs, "es").length === 3);
  check("and never adds one", orderNotesDocs([], "es").length === 0);
}

// ---------------------------------------------------------------------------

scenario("A Doc earns its place by carrying dialogue");
{
  const chosen = selectTranscriptDocs([
    doc({ docId: "a", name: "Oakline - Notes by Gemini", transcript: dialogue(60), fullNotes: "Summary" }),
  ]);
  check("one Doc with dialogue is the call", chosen.usedDocIds.join(",") === "a");
  check("its summary comes with it", chosen.fullNotes === "Summary");
  check("and it is reported as used", chosen.files[0].decision === "used");

  const summaryOnly = selectTranscriptDocs([
    doc({ docId: "en", name: "Notes by Gemini (English)", fullNotes: "A short summary of the call." }),
    doc({ docId: "es", name: "Notas de Gemini", transcript: dialogue(60) }),
  ]);
  check("the summary-only Doc is not the call", summaryOnly.usedDocIds.join(",") === "es");
  check(
    "and it is ignored with the reason said plainly",
    summaryOnly.files.some((file) => file.docId === "en" && file.decision === "ignored" && /summary/i.test(file.reason)),
  );

  const empty = selectTranscriptDocs([
    doc({ docId: "stub", name: "Notes by Gemini" }),
    doc({ docId: "real", name: "Notes by Gemini", transcript: dialogue(60) }),
  ]);
  check("an empty redial stub is ignored", empty.usedDocIds.join(",") === "real");
  check(
    "and named as the redial it is",
    empty.files.some((file) => file.docId === "stub" && /redial/i.test(file.reason)),
  );

  check(
    "a Doc just under the floor is not dialogue",
    selectTranscriptDocs([doc({ docId: "a", name: "x", transcript: "a".repeat(MIN_DIALOGUE_CHARS - 1) })])
      .usedDocIds.length === 0,
  );
  check(
    "and one just over it is",
    selectTranscriptDocs([doc({ docId: "a", name: "x", transcript: "a".repeat(MIN_DIALOGUE_CHARS) })])
      .usedDocIds.length === 1,
  );

  const nothing = selectTranscriptDocs([]);
  check("no Docs at all is nothing used, not a crash", nothing.usedDocIds.length === 0 && nothing.transcript === "");
}

scenario("A call that was stopped and restarted is one call in two parts");
{
  const parts = selectTranscriptDocs([
    doc({
      docId: "second",
      name: "Oakline - 2026/07/03 10:26 PT - Notes by Gemini",
      transcript: `the second half of the call
${dialogue(10)}`,
    }),
    doc({
      docId: "first",
      name: "Oakline - 2026/07/03 10:00 PT - Notes by Gemini",
      transcript: `the first half of the call
${dialogue(10)}`,
      fullNotes: "Summary of the first part",
    }),
  ]);
  check("both parts are used", parts.usedDocIds.length === 2);
  check("in time order, not the order Google listed them", parts.usedDocIds.join(",") === "first,second", parts.usedDocIds.join(","));
  check(
    "and the dialogue is joined in that order",
    parts.transcript.indexOf("first half") < parts.transcript.indexOf("second half"),
  );
  check("each part is labelled in the joined text", parts.transcript.includes("2026/07/03 10:00 PT"));
  check(
    "only the first part's summary is kept",
    parts.fullNotes === "Summary of the first part",
    "stacking both reads as the same meeting happening twice",
  );
  check(
    "and both say they were joined",
    parts.files.filter((file) => file.decision === "used").every((file) => /time order/i.test(file.reason)),
  );

  const noClock = selectTranscriptDocs([
    doc({ docId: "b", name: "Notes by Gemini", transcript: dialogue(10), createdTime: "2026-07-03T17:26:00.000Z" }),
    doc({ docId: "a", name: "Notes by Gemini", transcript: dialogue(10), createdTime: "2026-07-03T17:00:00.000Z" }),
  ]);
  check(
    "titles with no clock fall back to Drive's creation time",
    noClock.usedDocIds.join(",") === "a,b",
    noClock.usedDocIds.join(","),
  );
}

scenario("The same call in two languages is used once and kept once");
{
  const both = selectTranscriptDocs(
    [
      doc({ docId: "en", name: "Oakline - Notes by Gemini (English)", transcript: dialogue(40) }),
      doc({ docId: "es", name: "Oakline - Notas de Gemini", transcript: dialogue(60) }),
    ],
    { clientLanguage: "es" },
  );
  check("the client's language is the one used", both.usedDocIds.join(",") === "es");
  check("the other is kept, not ignored", both.files.some((file) => file.docId === "en" && file.decision === "kept"));
  check(
    "and says why it was not joined",
    both.files.some((file) => file.docId === "en" && /counted twice/i.test(file.reason)),
  );
  check("the language used is reported", both.language === "es");
  check(
    "the dialogue is not doubled",
    both.transcript === dialogue(60),
    "joining both languages would count every sentence twice",
  );

  const noPreference = selectTranscriptDocs([
    doc({ docId: "en", name: "Oakline - Notes by Gemini (English)", transcript: dialogue(10) }),
    doc({ docId: "es", name: "Oakline - Notas de Gemini", transcript: dialogue(90) }),
  ]);
  check(
    "with no language on file the fuller Doc is the call",
    noPreference.usedDocIds.join(",") === "es",
    noPreference.usedDocIds.join(","),
  );

  const wrongPreference = selectTranscriptDocs(
    [doc({ docId: "en", name: "Oakline - Notes by Gemini (English)", transcript: dialogue(60) })],
    { clientLanguage: "es" },
  );
  check(
    "a client language that carried no dialogue does not lose the call",
    wrongPreference.usedDocIds.join(",") === "en",
    "the language is a tiebreaker, never a filter",
  );
}

// ---------------------------------------------------------------------------

const ENDED = "2026-07-03T17:41:00.000Z";

scenario("The wait, and when the follow-through may be opened");
{
  const notEnded = transcriptWaitView({});
  check("before the call ends there is nothing to wait for", notEnded.phase === "not_ended");
  check("and no follow-through yet", notEnded.canBeginFollowThrough === false);
  check("and nothing is polled", notEnded.keepPolling === false);

  const early = transcriptWaitView({ callEndedAt: ENDED, status: "waiting", nowIso: "2026-07-03T17:45:00.000Z" });
  check("four minutes in it is still waiting", early.phase === "waiting");
  check("and says how long", early.label === "Waiting for the transcript — 4 min", early.label);
  check("the follow-through is not open yet", early.canBeginFollowThrough === false);
  check("and it is polling", early.keepPolling === true);
  check("the detail says where it is looking", /calendar event/i.test(early.detail));

  const waitedOut = transcriptWaitView({ callEndedAt: ENDED, status: "waiting", nowIso: "2026-07-03T17:57:00.000Z" });
  check("after fifteen minutes the follow-through opens anyway", waitedOut.canBeginFollowThrough === true);
  check("the wait is marked out", waitedOut.waitedOut === true);
  check(
    "and it keeps looking",
    waitedOut.keepPolling === true,
    "a transcript that turns up at minute twenty is still the transcript",
  );

  const found = transcriptWaitView({ callEndedAt: ENDED, status: "found", usedCount: 1, nowIso: "2026-07-03T17:45:00.000Z" });
  check("found opens the follow-through at once", found.canBeginFollowThrough === true);
  check("and stops polling", found.keepPolling === false);
  check("and says where it came from", /calendar event/i.test(found.detail));

  const joined = transcriptWaitView({ callEndedAt: ENDED, status: "found", usedCount: 3 });
  check("several parts are reported as several", /3 notes Docs/.test(joined.detail), joined.detail);

  const attached = transcriptWaitView({ callEndedAt: ENDED, status: "attached" });
  check("an attached transcript is the AM's decision", attached.phase === "attached" && attached.keepPolling === false);

  const none = transcriptWaitView({ callEndedAt: ENDED, status: "none" });
  check("no dialogue still opens the follow-through", none.canBeginFollowThrough === true);
  check("and keeps looking in case that changes", none.keepPolling === true);

  check("the poll is every minute", TX_POLL_MS === 60_000);
  check("and the fallback is fifteen", TX_WAIT_MS === 15 * 60_000);
  check(
    "an unparseable end time is not a call that has ended",
    transcriptWaitView({ callEndedAt: "after lunch" }).phase === "not_ended",
  );
}

scenario("What the AM is told is the reason that was actually found");
{
  const blocked = transcriptWaitPanel({
    callEndedAt: ENDED,
    status: "none",
    note: "Google Meet isn't connected, so MTOS can't reach the notes Doc.",
    nowIso: "2026-07-03T17:45:00.000Z",
  });
  check(
    "a disconnected integration does not read as a call nobody transcribed",
    blocked.detail.includes("isn't connected"),
    blocked.detail,
  );
  check("and the phase is unchanged by the wording", blocked.phase === "none");

  const waitingNote = transcriptWaitPanel({
    callEndedAt: ENDED,
    status: "waiting",
    note: "The calendar event has no notes Doc attached yet.",
    nowIso: "2026-07-03T17:57:00.000Z",
  });
  check("once the wait is out the note still says what to do", /begin the follow-through/i.test(waitingNote.detail));

  const foundNote = transcriptWaitPanel({
    callEndedAt: ENDED,
    status: "found",
    usedCount: 2,
    note: "a stale note from an earlier poll",
  });
  check(
    "a note left over from a failed poll never survives the find",
    !foundNote.detail.includes("stale"),
    foundNote.detail,
  );

  check(
    "no note falls back to the sentence for the phase",
    transcriptWaitPanel({ callEndedAt: ENDED, status: "waiting", nowIso: "2026-07-03T17:45:00.000Z" }).detail ===
      transcriptWaitView({ callEndedAt: ENDED, status: "waiting", nowIso: "2026-07-03T17:45:00.000Z" }).detail,
  );
}

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures} of ${checks} checks passed.`);
console.log(
  [
    "",
    "Not covered here (needs Google or Firestore, so it is checked by hand on a real touch):",
    "  - reading the calendar event and its attachments, and that nothing falls back to a Drive",
    "    search, which could return another meeting's notes",
    "  - the Docs API tab read and the plain-text export fallback",
    "  - storing the joined payload in the touch's artifacts subcollection, and that a transcript",
    "    the AM attached is never overwritten by a later poll",
    "  - that the client's language comes from the deck, because the client profile has no",
    "    language field yet",
  ].join("\n"),
);

if (failures > 0) {
  process.exitCode = 1;
}
