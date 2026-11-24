import type { PresentationMedia, PresentationSlide } from "@/src/lib/mtos-data";

/**
 * Putting the account manager's uploads onto the deck.
 *
 * Two rules, and they pull in opposite directions on purpose.
 *
 * An exhibit slide may only show a file that was actually uploaded to this touch. The model
 * answers with an id; the image is looked up here. An id it invented, or one for a file that has
 * since been deleted, would otherwise render as an empty frame on a client's screen.
 *
 * And nothing the account manager uploaded is quietly dropped. They attached it because they
 * meant to show it, so anything the model did not place is added to the end of the deck as its
 * own slide. Deleting a slide is one click in the editor; noticing mid-call that the screenshot
 * you uploaded is not in the deck is not recoverable at all.
 */

/** Per touch. Enough for a month's worth of exhibits; past that the deck is a slideshow. */
export const MAX_PRESENTATION_MEDIA = 12;

/** What the model returns before the image is resolved. */
export type DraftSlide = PresentationSlide & { mediaId?: string };

const EXHIBIT_SECTION = "SUPPORTING MATERIAL";

/** The caption shown under an appended exhibit: the page it came from, else the file name. */
export function mediaSource(item: PresentationMedia): string {
  if (item.sourceName) return item.page ? `${item.sourceName} — page ${item.page}` : item.sourceName;
  return item.name;
}

/**
 * A title for an upload the model did not write a slide for.
 *
 * The account manager's note, cut at its first sentence, because that is the only description of
 * the image anything here has. With no note there is nothing to say about it but its name --
 * which is exactly why the uploader asks for one.
 */
export function mediaTitle(item: PresentationMedia): string {
  const note = (item.note || "").trim();
  if (!note) return item.name;
  const sentence = note.split(/(?<=[.!?])\s/)[0].trim();
  return (sentence.length > 90 ? `${sentence.slice(0, 87).trimEnd()}…` : sentence) || item.name;
}

export function attachUploadedMedia(slides: DraftSlide[], media: PresentationMedia[]): PresentationSlide[] {
  const byId = new Map(media.map((item) => [item.id, item]));
  const used = new Set<string>();

  const placed = slides.flatMap((slide): PresentationSlide[] => {
    const { mediaId, ...rest } = slide;
    if (slide.layout !== "exhibit") return [rest];
    const item = mediaId ? byId.get(mediaId) : undefined;
    if (!item) {
      // No image behind it. Whatever the model wrote is kept if it stands on its own; an exhibit
      // slide with nothing but a frame is not a slide.
      return rest.bullets?.length ? [{ ...rest, layout: "bullets" }] : [];
    }
    used.add(item.id);
    return [{ ...rest, media: item }];
  });

  const unused = media.filter((item) => !used.has(item.id));
  if (!unused.length) return placed;

  const extras: PresentationSlide[] = unused.map((item) => ({
    layout: "exhibit",
    section: EXHIBIT_SECTION,
    title: mediaTitle(item),
    subtitle: mediaSource(item),
    media: item,
  }));

  // Before the closing slide, so the deck still ends where it was written to end.
  const closing = placed.findIndex((slide) => slide.layout === "closing");
  if (closing < 0) return [...placed, ...extras];
  return [...placed.slice(0, closing), ...extras, ...placed.slice(closing)];
}

/**
 * What the deck writer is told about the uploads.
 *
 * Deliberately only this: the model cannot see the images, so it is given the id to place, where
 * the image came from, and the account manager's own description. A caption written from
 * anything else would be a guess about a picture on a client's screen.
 */
export function uploadedMediaBriefing(media: PresentationMedia[]): string[] {
  if (!media.length) return [];
  return [
    "ACCOUNT MANAGER UPLOADS. The account manager attached the following images for this deck. You cannot see them. The note is the only description of each one that exists.",
    'Place the ones that support what a slide is saying: give that slide layout "exhibit" and set mediaId to the id below. One image per exhibit slide, and write its title and subtitle from the note and from the reviewed evidence.',
    "Never describe what an image shows beyond its note, never read a figure, rank, date or name off it, and never claim it proves something. An upload you do not place is added to the end of the deck on its own, so leaving one out loses nothing.",
    JSON.stringify(
      media.map((item) => ({
        mediaId: item.id,
        fileName: item.name,
        ...(item.sourceName ? { fromDocument: item.sourceName, page: item.page } : {}),
        accountManagerNote: item.note || "No description was given.",
      })),
      null,
      2,
    ),
  ];
}
