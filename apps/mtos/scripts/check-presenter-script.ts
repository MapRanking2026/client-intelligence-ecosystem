/**
 * Pins the two presenter surfaces on a live call: the script and the notes.
 *
 * They answer different questions and must not be confused for each other. The script is what the
 * account manager SAYS, verbatim, with each figure tied to what it means for the client's
 * business. The notes are what the AM must REMEMBER about the slide -- including the caveats that
 * stop a number being claimed before it is reconciled.
 *
 * Four things are requirements rather than formatting:
 *
 *   1. Every sentence of the notes survives as its own bullet. A shortened summary is exactly
 *      what drops "reconcile this figure before saying more", and that line is the reason the
 *      notes exist.
 *   2. A script's paragraphs are kept apart, because they are where the speaker breathes.
 *   3. The slide editor carries the script through a save, so reordering a deck never drops the
 *      words the AM is about to read out.
 *   4. Neither ever reaches the client: both are presenter-side fields, and the client-visible
 *      filter leaves them for the presenter surfaces to handle.
 *
 * The model pass that writes the scripts is listed at the end of the run.
 *
 * Run with: npm run check:presenter-script
 */
import { editableSlide, normalizeSlide } from "@/src/lib/contracts/presentation-edit";
import {
  SCRIPT_LIMITS,
  formatSpeakingTime,
  notesBullets,
  scriptParagraphs,
  slidesMissingScript,
  speakingSeconds,
} from "@/src/lib/contracts/presenter-script";
import type { PresentationSlide } from "@/src/lib/mtos-data";

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

scenario("Notes become bullets without losing a caveat");
{
  const notes =
    "Only verified completed items listed. Do not claim this caused any ranking change. INTERNAL: the Sept internal chat said Map Check-Ins showed no activity, but the dashboard shows 118 check-ins; reconcile before saying more.";
  const bullets = notesBullets(notes);
  check("each sentence is its own bullet", bullets.length === 3, JSON.stringify(bullets));
  check("the caveat survives", bullets.some((bullet) => bullet.includes("reconcile before saying more")), JSON.stringify(bullets));
  check("the instruction survives", bullets.some((bullet) => bullet.startsWith("Do not claim")));
  check("empty notes give no bullets", notesBullets(undefined).length === 0 && notesBullets("   ").length === 0);
  check(
    "existing bullet characters are not doubled",
    notesBullets("- First point\n• Second point").every((bullet) => !/^[-•]/.test(bullet)),
  );
  check(
    "a long single sentence is truncated rather than dropped",
    notesBullets("x".repeat(SCRIPT_LIMITS.bullet + 80))[0].endsWith("…"),
  );
  check("the bullet count is capped", notesBullets(Array.from({ length: 30 }, (_, i) => `Line ${i}.`).join(" ")).length <= SCRIPT_LIMITS.bullets);
}

scenario("A script reads as speech");
{
  const script = "Here's where you stand this month.\n\nCalls are up thirty-two percent, which is about fifteen more people reaching you directly.";
  const blocks = scriptParagraphs(script);
  check("paragraphs are kept apart", blocks.length === 2, JSON.stringify(blocks));
  check("the words are untouched", blocks[1].startsWith("Calls are up thirty-two percent"));
  check("an empty script gives nothing to read", scriptParagraphs("").length === 0);
  check("speaking time is estimated", speakingSeconds("one two three four five six seven") === 3, String(speakingSeconds("one two three four five six seven")));
  check("and said in words", formatSpeakingTime(Array.from({ length: 280 }, () => "word").join(" ")).startsWith("about 2m"));
  check("no script, no estimate", formatSpeakingTime(undefined) === "");
}

scenario("The script survives an edit of the deck");
{
  const slide: PresentationSlide = {
    layout: "bullets",
    title: "Calls",
    bullets: ["Calls up 32%"],
    presenterNotes: "Internal: reconcile first.",
    presenterScript: "Calls are up thirty-two percent, which means more of the right people reaching you.",
  };
  const normalized = normalizeSlide(slide);
  check("normalizing keeps the script", normalized.presenterScript === slide.presenterScript);
  check("and keeps the notes", normalized.presenterNotes === slide.presenterNotes);
  check("the script travels back from the editor", editableSlide(slide).presenterScript === slide.presenterScript);
  check(
    "a script longer than the limit is capped",
    (normalizeSlide({ ...slide, presenterScript: "x".repeat(SCRIPT_LIMITS.perSlide + 500) }).presenterScript || "").length ===
      SCRIPT_LIMITS.perSlide,
  );
  check(
    "an empty script is not stored",
    normalizeSlide({ ...slide, presenterScript: "   " }).presenterScript === undefined,
  );
}

scenario("Knowing which slides still have no script");
{
  const slides: PresentationSlide[] = [
    { layout: "cover", title: "One", presenterScript: "Hello." },
    { layout: "bullets", title: "Two" },
    { layout: "closing", title: "Three", presenterScript: "   " },
  ];
  check("the missing ones are counted", slidesMissingScript(slides) === 2, String(slidesMissingScript(slides)));
  check("a fully written deck reports none", slidesMissingScript([{ layout: "cover", title: "One", presenterScript: "Hi." }]) === 0);
  check("an absent deck reports none", slidesMissingScript(undefined) === 0);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(
  "\nNot covered here (needs an LLM provider):\n  - the model pass that writes the verbatim scripts\n  - its rule that internal notes inform the script but are never spoken\n  - the Prompt Engine override of the built-in script prompt",
);
if (failures) {
  process.exitCode = 1;
}
