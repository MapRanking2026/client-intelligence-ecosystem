/**
 * Pins the Gemini notes Doc parsing in `meeting-transcript-service`.
 *
 * The fixtures below are the real Lee Connor notes Doc
 * (Drive 1JATzFUNf3glZlkNes4mIYLzRwbRYOpaYCBElEOSsgEY, read live 2026-10-26), verbatim and
 * abridged in the middle only. Two shapes are covered because the service reads the Doc two ways:
 * the Docs API returns each tab's text on its own, while the Drive plain-text export flattens
 * every tab into one string with markdown-ish headings.
 *
 * The flat export is the half that actually bites. Its tab headings arrive as
 * `# **<emoji> Transcript***  *`, and the emoji is routinely mojibaked to `ð` -- a Latin letter,
 * so it survives any "strip non-letters" cleanup and leaves a label of "ð transcript". An
 * equality test against "transcript" silently returns nothing; only a substring match against a
 * top-level heading works. This file exists so that does not regress.
 *
 * Run with: npm run check:transcript-parsing
 */
import {
  FULL_NOTES_MARKER,
  TRANSCRIPT_MARKER,
  sliceTabFromFlatText,
  splitTranscriptPayload,
  trimGeminiFullNotes,
  trimGeminiTranscript,
} from "@/src/lib/server/services/meeting-transcript-service";

const FLAT_EXPORT = `# **✍️ Quick notes**

## **Apointment with  Lee Connor**

Lead generation concerns debated via Google ads review and management fee scrutiny.

**Want to see more?** [View the full notes
](about:blank)Tip: You can always access your full notes from the left sidebar.

# **ð Full notes***
*

 Oct 23, 2026

## **Apointment with  Lee Connor**

Invited [Francisco Quintero](mailto:francisco@mapranking.com) [Lee Connor](mailto:lee@hadyson.com)

Attachments [Apointment with Lee Connor](https://calendar.google.com/calendar/event?eid=aHE1N2Q4c2tkN2kydHF2Zjg5aHNtbGJka2MgZnJhbmNpc2NvQG1hcHJhbmtpbmcuY29t)

Meeting records [Transcript](https://docs.google.com/document/d/1JATz/edit?tab=t.onqk8h7qkdtg)

### **Summary**

Lead generation concerns debated via Google ads review and management fee scrutiny.

### **Decisions**

## **Aligned**

  - **Delivery of revised marketing strategy update** The provider committed to formulate a revised marketing strategy.

### **Next steps**

  - \\[Francisco Quintero\\] Develop Strategy: Create a new plan to improve lead generation.

### **Details**

**Lead Generation and Management Fee Concerns**: Elizabeth opens the discussion by noting that lead generation has been very slow.

*You should review Gemini's notes to make sure they're accurate.* [*Get tips and learn how Gemini takes notes*](https://support.google.com/meet/answer/14754931)

*How is the quality of* ***these specific notes?*** [*Take a short survey*](https://google.qualtrics.com/jfe/form/SV_5bXz) *to let us know your feedback.*

# **ð Transcript***
*

 Oct 23, 2026

## **Apointment with  Lee Connor - Transcript**

### **00:00:10**



**Francisco Quintero:** Hello, Lee. How you doing?

**Elizabeth:** Hey, I'm good. How are you?




### **00:19:07**



**Elizabeth:** Perfect. Thank you so much.

**Elizabeth:** Bye. Bye. Our country. It's the most generation for generation. And the boomers, they own 70% of the so-called wealth in this country at this point in time.




### **Transcription ended after 00:20:30**



*This editable transcript was computer generated and might contain errors.*
`;

// What the Docs API yields per tab: the same lines, no markdown markup, and link URLs gone
// (they live in textStyle.link, not in the text runs).
const DOCS_FULL_NOTES_TAB = ` Oct 23, 2026
Apointment with  Lee Connor
Invited Francisco Quintero Lee Connor
Attachments Apointment with Lee Connor
Meeting records Transcript
Summary
Lead generation concerns debated via Google ads review and management fee scrutiny.
Decisions
Aligned
Delivery of revised marketing strategy update The provider committed to formulate a revised marketing strategy.
Next steps
[Francisco Quintero] Develop Strategy: Create a new plan to improve lead generation.
Details
Lead Generation and Management Fee Concerns: Elizabeth opens the discussion by noting that lead generation has been very slow (00:00:10).
You should review Gemini's notes to make sure they're accurate. Get tips and learn how Gemini takes notes
How is the quality of these specific notes? Take a short survey to let us know your feedback.
`;

let failures = 0;

function check(label: string, passed: boolean, detail = "") {
  if (!passed) {
    failures += 1;
  }
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` -- ${detail}` : ""}`);
}

console.log("flat export: tab selection");
const flatNotes = sliceTabFromFlatText(FLAT_EXPORT, /full\s*notes/);
const flatTranscript = sliceTabFromFlatText(FLAT_EXPORT, /transcript/);
check("found the Full notes tab", Boolean(flatNotes));
check("found the Transcript tab", Boolean(flatTranscript));
check("Full notes tab did not swallow the Transcript tab", !(flatNotes || "").includes("Hello, Lee"));
check(
  "Transcript tab did not include the Summary section",
  !(flatTranscript || "").includes("Lead generation concerns debated"),
);
check(
  "Quick notes tab excluded from Full notes",
  !(flatNotes || "").includes("Tip: You can always access"),
);

console.log("\nFull notes trimming");
for (const [shape, raw] of [
  ["flat export", flatNotes || ""],
  ["Docs API tab", DOCS_FULL_NOTES_TAB],
] as const) {
  const notes = trimGeminiFullNotes(raw);
  check(`${shape}: kept Summary`, notes.includes("Summary"));
  check(`${shape}: kept Decisions`, notes.includes("Decisions"));
  check(`${shape}: kept Next steps`, notes.includes("Next steps"));
  check(`${shape}: kept Details`, notes.includes("Details"));
  check(`${shape}: dropped the Invited line`, !/^Invited /m.test(notes));
  check(`${shape}: dropped the Attachments line`, !/^Attachments /m.test(notes));
  check(`${shape}: dropped the Meeting records line`, !/^Meeting records /m.test(notes));
  check(`${shape}: dropped the review-notes disclaimer`, !/review Gemini's notes/i.test(notes));
  check(`${shape}: dropped the survey prompt`, !/short survey/i.test(notes));
  check(`${shape}: no runs of 3+ blank lines`, !/\n{3,}/.test(notes));
}

console.log("\ncombined payload round-trip");
const fullNotes = trimGeminiFullNotes(flatNotes || "");
const transcript = trimGeminiTranscript(flatTranscript || "");
const payload = [FULL_NOTES_MARKER, fullNotes, "", TRANSCRIPT_MARKER, transcript].join("\n");
const split = splitTranscriptPayload(payload);
check("round-trips the full notes unchanged", split.fullNotes === fullNotes);
check("round-trips the transcript unchanged", split.transcript === transcript);
check(
  "transcript half has no summary bleed",
  !split.transcript.includes("Lead generation concerns debated"),
);
check("full notes half has no dialogue bleed", !(split.fullNotes || "").includes("Hello, Lee"));

console.log("\nbackward compatibility (manual / Zoom paste, no markers)");
const manual = "Francisco: Hi there.\nClient: Hello, we need to talk about the budget.";
const manualSplit = splitTranscriptPayload(manual);
check("a marker-less paste is all transcript", manualSplit.transcript === manual);
check("a marker-less paste reports no full notes", manualSplit.fullNotes === undefined);

console.log("\ntranscript-only Doc (transcription on, Gemini notes off)");
const transcriptOnly = [TRANSCRIPT_MARKER, transcript].join("\n");
const onlySplit = splitTranscriptPayload(transcriptOnly);
check("the transcript survives on its own", onlySplit.transcript === transcript);
check("no full notes are reported", onlySplit.fullNotes === undefined);

console.log("\ntranscript trimming");
check("dropped the end marker", !/Transcription ended after/i.test(transcript));
check("dropped the generated-transcript disclaimer", !/computer generated/i.test(transcript));
check("kept the opening dialogue", transcript.includes("Hello, Lee. How you doing?"));
check(
  "known limitation: mid-utterance stray audio survives",
  transcript.includes("they own 70% of the so-called wealth"),
  "left in deliberately -- inseparable from the real 'Bye. Bye.' in the same speaker turn",
);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll transcript-parsing checks passed.");
