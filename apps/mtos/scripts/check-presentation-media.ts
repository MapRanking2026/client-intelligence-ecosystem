/**
 * The account manager's own material reaches the deck, and nothing is invented about it.
 *
 * Until this existed the deck could only show what MTOS already held. An account manager with a
 * screenshot of the thing the client complained about, or the page of an audit that makes the
 * point better than a bullet, had no way to put it on a slide.
 *
 * Two rules hold the feature together and they are both checked here.
 *
 * An exhibit slide may only show a file that was really uploaded to this touch -- the model
 * answers with an id and the image is looked up server-side, so an invented id becomes nothing
 * rather than an empty frame on a client's screen.
 *
 * And nothing in MTOS can see inside these images. The model is given the file name and the
 * account manager's note, and that is all a caption may be written from. An upload with no note
 * gets its file name, not a guess about what it shows.
 *
 * Run with: npm run check:presentation-media
 */
import JSZip from "jszip";

import { attachUploadedMedia, mediaSource, mediaTitle, uploadedMediaBriefing, type DraftSlide } from "@/src/lib/contracts/presentation-media";
import { buildPptx } from "@/src/lib/server/services/pptx-builder";
import type { Presentation, PresentationMedia } from "@/src/lib/mtos-data";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`FAILED: ${label}`);
  }
}

const shot = (over: Partial<PresentationMedia> = {}): PresentationMedia => ({
  id: "a".repeat(64),
  touchId: "touch-1",
  name: "booking-page.png",
  note: "The booking form on a phone, cut off below the date field.",
  width: 1200,
  height: 800,
  mimeType: "image/png",
  bytes: 90_000,
  uploadedAt: "2026-11-24T18:00:00.000Z",
  ...over,
});

const page = shot({ id: "b".repeat(64), name: "audit.pdf — page 4", sourceName: "audit.pdf", page: 4, note: "The broken citations table." });

const closing: DraftSlide = { layout: "closing", title: "Thank you" };

// ---------------------------------------------------------------------------
// Placing what the model asked for
// ---------------------------------------------------------------------------

const placed = attachUploadedMedia(
  [{ layout: "exhibit", title: "What the client is seeing", mediaId: shot().id } as DraftSlide, closing],
  [shot()],
);
check("the slide gets the image the model asked for", placed[0].media?.id === shot().id);
check("the id the model answered with is not left on the slide", !("mediaId" in placed[0]));
check("nothing is appended when every upload was placed", placed.length === 2);

// An id for a file this touch does not hold is the case that matters: it is what an invented id
// and a deleted upload both look like.
const invented = attachUploadedMedia(
  [{ layout: "exhibit", title: "Made up", mediaId: "c".repeat(64) } as DraftSlide, closing],
  [],
);
check("an exhibit with no real upload behind it is not shown", !invented.some((slide) => slide.layout === "exhibit"));
check("and it does not leave an empty frame", invented.length === 1);

const salvaged = attachUploadedMedia(
  [{ layout: "exhibit", title: "Made up", bullets: ["A point worth keeping"], mediaId: "c".repeat(64) } as DraftSlide],
  [],
);
check("words written on it are kept as an ordinary slide", salvaged[0]?.layout === "bullets" && salvaged[0].bullets?.length === 1);

const strayId = attachUploadedMedia([{ layout: "bullets", title: "Results", bullets: ["x"], mediaId: shot().id } as DraftSlide], [shot()]);
check("a media id on a slide that is not an exhibit is dropped", !("mediaId" in strayId[0]) && !strayId[0].media);

// ---------------------------------------------------------------------------
// Nothing uploaded is quietly lost
// ---------------------------------------------------------------------------

const forgotten = attachUploadedMedia([{ layout: "bullets", title: "Results", bullets: ["x"] }, closing], [shot(), page]);
check("an upload the model ignored still reaches the deck", forgotten.filter((slide) => slide.layout === "exhibit").length === 2);
check("and the deck still ends where it was written to end", forgotten[forgotten.length - 1].layout === "closing");
check("the appended slide carries the image itself", forgotten[1].media?.id === shot().id);
check(
  "a deck with no closing slide simply gains them at the end",
  attachUploadedMedia([{ layout: "bullets", title: "Results" }], [shot()])[1]?.layout === "exhibit",
);
// Placed once, appended never: the same upload must not appear twice.
const half = attachUploadedMedia([{ layout: "exhibit", title: "Seen", mediaId: page.id } as DraftSlide, closing], [shot(), page]);
check("only the uploads that were not placed are appended", half.filter((slide) => slide.media?.id === page.id).length === 1);
check("the one that was not placed is still added", half.some((slide) => slide.media?.id === shot().id));

// ---------------------------------------------------------------------------
// What an appended slide is allowed to say
// ---------------------------------------------------------------------------

check("the title is the account manager's own description", mediaTitle(shot()) === "The booking form on a phone, cut off below the date field.");
check("a long note is cut at its first sentence", mediaTitle(shot({ note: "Short one. Then a second sentence that is not the title." })) === "Short one.");
check("a very long first sentence is trimmed rather than run across the slide", mediaTitle(shot({ note: "x".repeat(200) })).length <= 90);
// No note means nothing is known about the picture, so the file name is all it may say.
check("with no note the slide says only the file name", mediaTitle(shot({ note: "" })) === "booking-page.png");
check("a PDF page says which page it is", mediaSource(page) === "audit.pdf — page 4");
check("an uploaded image says its file name", mediaSource(shot()) === "booking-page.png");

// ---------------------------------------------------------------------------
// What the deck writer is told
// ---------------------------------------------------------------------------

check("no uploads means nothing is added to the prompt", uploadedMediaBriefing([]).length === 0);
const briefing = uploadedMediaBriefing([shot(), page]).join("\n");
check("the ids it may place are listed", briefing.includes(shot().id) && briefing.includes(page.id));
check("the note travels with them", briefing.includes("The broken citations table."));
check("it is told it cannot see the images", /cannot see them/i.test(briefing));
check("and told not to read anything off them", /never read a figure, rank, date or name off it/i.test(briefing));
// An upload with no note must not be described as though it had one.
check("a missing note is stated, not filled in", uploadedMediaBriefing([shot({ note: "" })]).join("\n").includes("No description was given."));

// ---------------------------------------------------------------------------
// The exported .pptx
// ---------------------------------------------------------------------------

const deck = (media?: PresentationMedia): Presentation => ({
  status: "generated",
  title: "Monthly Touch",
  slides: [
    { layout: "cover", title: "Monthly Touch" },
    { layout: "exhibit", title: "What the client is seeing", subtitle: "booking-page.png", ...(media ? { media } : {}) },
  ],
});

async function pptx() {
  const withImage = await JSZip.loadAsync(await buildPptx(deck(shot()), null, new Map([[shot().id, Buffer.from("fake-png-bytes")]])));
  check("the uploaded image is written into the deck", Boolean(withImage.file("ppt/media/slide2.png")));
  const rels = await withImage.file("ppt/slides/_rels/slide2.xml.rels")!.async("string");
  check("the slide points at it", rels.includes('Id="rId5"') && rels.includes("../media/slide2.png"));
  check("the picture shape is on the slide", (await withImage.file("ppt/slides/slide2.xml")!.async("string")).includes("<p:pic>"));

  // A JPEG upload has to be written as one: PowerPoint reads the part's type from its extension.
  const jpeg = shot({ id: "d".repeat(64), mimeType: "image/jpeg", name: "storefront.jpg" });
  const withJpeg = await JSZip.loadAsync(await buildPptx(deck(jpeg), null, new Map([[jpeg.id, Buffer.from("fake-jpeg-bytes")]])));
  check("a JPEG upload keeps its own type", Boolean(withJpeg.file("ppt/media/slide2.jpeg")));
  check("and the package declares that type", (await withJpeg.file("[Content_Types].xml")!.async("string")).includes('Extension="jpeg"'));

  // The bytes may be gone -- the upload was deleted after the deck was built. The deck still
  // downloads, and the slide says what happened rather than showing an empty box.
  const missing = await JSZip.loadAsync(await buildPptx(deck(shot()), null, new Map()));
  check("a deck whose upload was deleted still downloads", Boolean(missing.file("ppt/slides/slide2.xml")));
  check("and that slide says the image is missing", (await missing.file("ppt/slides/slide2.xml")!.async("string")).includes("uploaded image for this slide is not available"));
}

pptx()
  .catch((error) => {
    failed += 1;
    console.error(`FAILED: the deck could not be built — ${error instanceof Error ? error.message : String(error)}`);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log("Not covered by these checks:");
    console.log("  - the browser-side PDF rendering, which needs a browser");
    console.log("  - Firestore storage and the chunked read-back, which need a live database");
    console.log("  - whether the account manager's note is an accurate description of the image");
    if (failed) process.exitCode = 1;
  });
