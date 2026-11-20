/**
 * The agenda the client was actually promised.
 *
 * The confirmation email and the deck used to be written by two separate model runs from the same
 * brief, which meant the client read one agenda two days before the call and saw a different one
 * on the screen during it. Nothing was wrong with either; they simply had no reason to agree.
 *
 * They agree now because there is only one agenda: the one that left in the email. The order of
 * the workflow settles which way the dependency points -- the email is approved in Review and the
 * deck is built at the approval after it, so the deck is the one that can be made to match. A
 * client who has been told what the call will cover should see exactly that on the screen.
 *
 * The sent body is read before the brief's proposal, because the AM edits that body by hand and
 * what they sent is what the client has.
 */

import { agendaTopic } from "@/src/lib/contracts/agenda-email";
import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";

/** Every agenda row in a rendered confirmation email, in the order the client reads them. */
export function agendaTopicsFromHtml(html: string): string[] {
  const rows = String(html || "").match(/<div[^>]*data-mtos-field="agenda-topic"[^>]*>([\s\S]*?)<\/div>/gi) || [];
  return rows
    .map((row) =>
      row
        .replace(/^<div[^>]*>/i, "")
        .replace(/<\/div>$/i, "")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .trim(),
    )
    // Through the same parser the email used to build the row, which takes off the emoji the
    // email adds for itself. The deck numbers its agenda instead, and a bullet reading
    // "📈  Google Business Profile" on a slide is the email's decoration leaking onto it.
    .map((row) => agendaTopic(row).title || row)
    .filter(Boolean);
}

/**
 * The agenda this touch has committed to, or nothing when no email went out.
 *
 * Two sources, in descending order of what the client has actually seen: the body of the email as
 * it stands, and the items the brief wrote for it. Empty is a real answer -- a same-day touch can
 * be run without a confirmation email at all, and in that case the deck is free to set its own
 * agenda because nobody has been told otherwise.
 */
export function agreedAgendaItems(touch: MonthlyTouchRecord): string[] {
  const fromBody = agendaTopicsFromHtml(touch.agendaEmail?.html || "");
  if (fromBody.length) return fromBody;

  // The brief's own items, reduced to their titles the same way the email renders them, so a deck
  // built before the body exists still matches the body that will be built from the same items.
  return (touch.prepBrief?.clientAgendaEmail?.items || [])
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => agendaTopic(item).title || item);
}

/**
 * Put the agreed agenda on the deck's agenda slide.
 *
 * Asked of the model and then done anyway, because "the same agenda" is not a thing to get mostly
 * right: a reworded line is exactly the mismatch a client notices. The model's own agenda slide
 * decides where the slide sits and what it is titled; only the lines are replaced.
 *
 * A deck with no agenda slide is left alone. The slide is optional -- a Loom update has no
 * "what we'll cover today" -- and inserting one here would put it in the wrong place.
 */
export function withAgreedAgenda<T extends { slides: { layout: string; bullets?: string[]; items?: unknown[] }[] }>(
  presentation: T,
  items: string[],
): T {
  if (!items.length) return presentation;
  if (!presentation.slides.some((slide) => slide.layout === "agenda")) return presentation;
  return {
    ...presentation,
    slides: presentation.slides.map((slide) =>
      slide.layout === "agenda"
        // `items` is dropped with it: an agenda slide carrying both would render the model's list
        // beside the client's.
        ? { ...slide, bullets: [...items], items: undefined }
        : slide,
    ),
  };
}

/** The instruction the deck is generated under, so the model is asked for this before it is enforced. */
export function agreedAgendaRule(items: string[]): string {
  return [
    "The client has already received a confirmation email naming what this call will cover. The agenda slide must",
    "list exactly these lines, in this order, and the deck must cover them in that order. Do not reword them, do not",
    "add a topic the client was not told about, and do not drop one. These are the lines, as the client read them:",
    JSON.stringify(items),
  ].join(" ");
}
