/* eslint-disable @next/next/no-img-element -- The account manager's upload is shown unchanged on the fixed slide canvas; it is served privately from Firestore, not optimised. */
import type { PresentationMedia } from "@/src/lib/mtos-data";

/**
 * One uploaded image on a slide, at its own aspect ratio inside the deck's frame.
 *
 * `objectFit: contain` rather than cover: a screenshot of a dashboard or a page of an audit is
 * read, not decorated, and cropping it to fill the frame cuts off the part that made the account
 * manager upload it.
 *
 * The alt text is the account manager's note. It is the only description of the image anything
 * here has -- nothing in MTOS has looked inside it.
 */
export function ExhibitVisual({ media }: { media?: PresentationMedia }) {
  if (!media) {
    return <p style={{ color: "#607086", fontSize: 22 }}>This slide&apos;s uploaded image is no longer stored on this Monthly Touch. Upload it again or remove the slide.</p>;
  }
  return (
    <div style={{ position: "relative", width: 1152, height: 430, background: "#F7F9FC", borderRadius: 10, overflow: "hidden", border: "1px solid #D8E1EC" }}>
      <img
        src={`/api/monthly-touches/${encodeURIComponent(media.touchId)}/presentation-media?image=${encodeURIComponent(media.id)}`}
        alt={media.note || media.name}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </div>
  );
}
