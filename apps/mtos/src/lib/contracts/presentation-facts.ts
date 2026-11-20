/**
 * Every figure on a client slide has to be one we hold a record of.
 *
 * A deck is written by a model from the evidence bundle, which means nothing structural stops it
 * writing a number that is close to the truth rather than the truth: a market share of 43.2% when
 * the record says 43.24%, a rank of 8.6 when the scan says 8.63. The client can open the same
 * profile and read the real figure, and a number they can disprove costs more than the slide was
 * ever worth.
 *
 * So the figures on the generated slides are checked against the figures in the evidence they
 * were written from. A figure that is not in the evidence is not silently removed -- taking a
 * number out of a sentence leaves a sentence that says something else -- it is reported, and the
 * account manager clears it before the deck is shown.
 *
 * Two things this deliberately does not do:
 *
 *  - **It does not do arithmetic.** A percentage the model worked out from two evidence figures
 *    is flagged like any other unsourced number, because verifying it would mean guessing which
 *    calculation it meant. That is the right outcome anyway: a figure nobody can trace to a
 *    record is one the AM should look at before a client does.
 *  - **It does not read presenter notes.** Those are internal. The spoken script is a separate
 *    surface with its own generation step.
 */

import type { Presentation, PresentationSlide } from "@/src/lib/mtos-data";

/**
 * A number as a reader would see it: `1,240` and `1240` and `1240.0` are the same figure.
 *
 * The sign is deliberately not part of the token. A hyphen in front of a digit is far more often
 * a date or a compound than a minus -- `2026-10-22`, `Top-3 pins`, `81-point grid` -- and reading
 * those as negative numbers made every ISO date in the evidence fail to match the same date
 * written out on a slide. Both sides are tokenised the same way, so a genuinely negative figure
 * still matches its record; only its sign is outside what this can check.
 */
const FIGURE = /\d[\d,]*(?:\.\d+)?/g;

function canonical(raw: string): string {
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? String(value) : raw;
}

/**
 * A number written out as the record holds it.
 *
 * No rounding and no forced precision: a market share of 43.24% is written 43.24%, because the
 * client can open the same profile and read it. Thousands keep their separators, since that is
 * legibility rather than a change to the value.
 */
export function exactFigure(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  const [whole, decimals] = String(value).split(".");
  return `${Number(whole).toLocaleString("en-US")}.${decimals}`;
}

/** Every figure in a piece of text, canonicalised. */
export function figuresIn(text: string): string[] {
  return (String(text || "").match(FIGURE) || []).map(canonical);
}

/**
 * Every figure anywhere in the evidence the deck was written from.
 *
 * Taken off the serialised bundle rather than walked field by field, so a figure inside a date,
 * a period label or a nested record counts as held -- the question is only whether we have the
 * number, not where in the bundle it sits.
 */
export function evidenceFigures(evidence: unknown): Set<string> {
  return new Set(figuresIn(typeof evidence === "string" ? evidence : JSON.stringify(evidence ?? "")));
}

/** The client-visible words of a slide. Presenter notes are internal and not checked here. */
export function slideClientText(slide: PresentationSlide): string {
  return [
    slide.title,
    slide.subtitle,
    slide.section,
    slide.footnote,
    ...(slide.bullets || []),
    ...(slide.stats || []).flatMap((stat) => [stat.value, stat.caption]),
    ...(slide.columns || []).flatMap((column) => [column.heading, ...column.items]),
    ...(slide.table ? [...slide.table.headers, ...slide.table.rows.flat()] : []),
    ...(slide.items || []).flatMap((item) => [item.label, item.detail]),
  ]
    .filter((value): value is string => typeof value === "string" && Boolean(value))
    .join(" · ");
}

export interface UnverifiedFigure {
  /** 1-based, as the deck numbers its own slides. */
  slide: number;
  title: string;
  figures: string[];
}

/**
 * The figures on this deck that the evidence does not hold.
 *
 * Server-built slides are exempt: a rank comparison is assembled here from the scans themselves,
 * so its numbers are the records rather than a reading of them.
 */
export function unverifiedFigures(presentation: Presentation, evidence: unknown): UnverifiedFigure[] {
  const held = evidenceFigures(evidence);
  const out: UnverifiedFigure[] = [];
  presentation.slides.forEach((slide, index) => {
    if (slide.layout === "rank_comparison") return;
    const unheld = [...new Set(figuresIn(slideClientText(slide)))].filter((figure) => !held.has(figure));
    if (unheld.length) out.push({ slide: index + 1, title: slide.title || `Slide ${index + 1}`, figures: unheld });
  });
  return out;
}

/** What the account manager is told, in the order they would fix it. */
export function unverifiedFigureLines(items: UnverifiedFigure[]): string[] {
  return items.map(
    (item) =>
      `Slide ${item.slide} (${item.title}): ${item.figures.join(", ")} ${item.figures.length === 1 ? "is not" : "are not"} in this touch's evidence. Check it against the source before presenting, or take it off the slide.`,
  );
}

/** The one rule the deck is generated under, so the model is asked for this before it is checked. */
export const FACTUAL_FIGURES_RULE = [
  "FIGURES: every number on a slide must be copied exactly from the supplied evidence. Do not round, do not shorten,",
  "do not tidy a value to one decimal place: if the record says 43.24% the slide says 43.24%, not 43.2%. Do not",
  "calculate a figure the evidence does not state, do not estimate, and do not carry a number over from another",
  "account or another period. Where a figure is not in the evidence, say it is not available rather than supplying",
  "one. The client can open the same profile and read the real number, so a figure they can disprove is worse than",
  "a gap they can ask about.",
].join(" ");
