import { clientSlides } from "@/src/lib/contracts/client-content";
import type {
  PresentationItem,
  PresentationLayout,
  PresentationSlide,
  PresentationStat,
  PresentationTone,
} from "@/src/lib/mtos-data";

/**
 * What an account manager may change about a generated deck, and what stays out of their hands.
 *
 * The deck is written by a model minutes before a client call, and the AM is the one who knows the
 * account. Until now their only options were to present it as written or spend four minutes
 * regenerating the whole thing to fix one sentence. This is the third option: edit the slide in
 * place and present it.
 *
 * Three boundaries hold, and they are the reason this file exists rather than the screen simply
 * writing to `presentation.slides`:
 *
 *   - **Evidence is not editable.** A `rank_comparison` slide's captured image and its scan dates
 *     are the provider's measurement; the AM may retitle the slide and rewrite its notes, but the
 *     comparison itself never travels through an edit. The server reattaches it from storage, so
 *     nothing a browser sends can forge one.
 *   - **The client-visibility rules still apply.** An edit is not an exemption: `clientSlides`
 *     filters AM-typed text exactly as it filters generated text, both on screen and in the .pptx.
 *     Rather than let that happen silently, `clientVisibilityWarnings` tells the AM BEFORE they
 *     present that a line they typed will not reach the client, and why.
 *   - **The generated version is kept.** The first edit to a slide stores what the model wrote, so
 *     "revert this slide" is always available -- an AM mid-call who has made it worse needs one
 *     click back, not a four-minute regeneration.
 *
 * Everything here is pure, so the rules can be exercised directly (`npm run check:presentation-edit`)
 * and so the editing screen and the save endpoint cannot drift apart: both call these functions.
 */

/** Hard caps, so one pasted document cannot push the touch document past Firestore's 1MB limit. */
export const EDIT_LIMITS = {
  slides: 60,
  title: 200,
  subtitle: 400,
  section: 120,
  footnote: 400,
  presenterNotes: 4000,
  bullets: 24,
  bulletText: 400,
  stats: 6,
  statValue: 40,
  statCaption: 160,
  columns: 3,
  columnItems: 12,
  tableColumns: 8,
  tableRows: 20,
  cell: 160,
  items: 12,
  itemText: 400,
} as const;

export const TONES: PresentationTone[] = ["neutral", "good", "watch", "risk"];

/** The layouts an AM may pick for a slide, with what each one is for. */
export const LAYOUT_CHOICES: { layout: PresentationLayout; label: string; hint: string }[] = [
  { layout: "bullets", label: "Bullets", hint: "A heading and a short list — the general-purpose slide." },
  { layout: "stat_callouts", label: "Big numbers", hint: "Two to four figures with captions." },
  { layout: "two_column", label: "Two columns", hint: "Two headed lists side by side." },
  { layout: "table", label: "Table", hint: "Rows and columns of short values." },
  { layout: "status_list", label: "Status list", hint: "Items with a chip: completed work only." },
  { layout: "timeline", label: "Timeline", hint: "Items in order, with a detail line each." },
  { layout: "agenda", label: "Agenda", hint: "Numbered running order." },
  { layout: "questions", label: "Questions", hint: "Questions to put to the client." },
  { layout: "cover", label: "Cover", hint: "Opening slide." },
  { layout: "closing", label: "Closing", hint: "Final slide." },
];

/** Which body editor a layout needs. `rank` carries evidence and has no body editor. */
export type BodyField = "bullets" | "stats" | "columns" | "table" | "items" | "rank" | "none";

export function bodyFieldFor(layout: PresentationLayout): BodyField {
  switch (layout) {
    case "stat_callouts":
      return "stats";
    case "two_column":
      return "columns";
    case "table":
      return "table";
    case "status_list":
    case "timeline":
      return "items";
    case "rank_comparison":
      return "rank";
    case "bullets":
    case "agenda":
    case "questions":
    case "cover":
    case "closing":
      return "bullets";
    default:
      return "none";
  }
}

/**
 * The parts of a slide an AM owns.
 *
 * Used three ways, which is why it is one function: it is what the screen sends, what a snapshot
 * stores, and what two versions are compared on to decide whether a slide counts as edited.
 * `rankComparison` and `generatedSnapshot` are deliberately absent -- those are the server's.
 */
export function editableSlide(slide: PresentationSlide): PresentationSlide {
  const next: PresentationSlide = { ...slide };
  delete next.rankComparison;
  delete next.generatedSnapshot;
  delete next.edited;
  return next;
}

export function slidesDiffer(a: PresentationSlide, b: PresentationSlide): boolean {
  return JSON.stringify(editableSlide(a)) !== JSON.stringify(editableSlide(b));
}

const text = (value: string | undefined, limit: number): string => (value || "").replace(/\s+$/g, "").slice(0, limit);

function normalizeStats(stats: PresentationStat[] | undefined): PresentationStat[] | undefined {
  const cleaned = (stats || [])
    .map((stat) => ({
      value: text(stat.value, EDIT_LIMITS.statValue).trim(),
      caption: text(stat.caption, EDIT_LIMITS.statCaption).trim(),
      ...(stat.tone && stat.tone !== "neutral" ? { tone: stat.tone } : {}),
    }))
    .filter((stat) => stat.value || stat.caption)
    .slice(0, EDIT_LIMITS.stats);
  return cleaned.length ? cleaned : undefined;
}

function normalizeItems(items: PresentationItem[] | undefined): PresentationItem[] | undefined {
  const cleaned = (items || [])
    .map((item) => ({
      label: text(item.label, EDIT_LIMITS.itemText).trim(),
      ...(item.detail?.trim() ? { detail: text(item.detail, EDIT_LIMITS.itemText).trim() } : {}),
      ...(item.status?.trim() ? { status: text(item.status, 40).trim() } : {}),
      ...(item.tone && item.tone !== "neutral" ? { tone: item.tone } : {}),
    }))
    .filter((item) => item.label)
    .slice(0, EDIT_LIMITS.items);
  return cleaned.length ? cleaned : undefined;
}

/**
 * One slide, trimmed to the limits and to its own layout.
 *
 * The table is forced rectangular here for the same reason the Client's Book markdown is: a row
 * with the wrong number of cells is a rendering bug in the viewer, a misaligned column in the
 * .pptx, and -- when the same text reaches ClickUp -- a 400 that rejects a whole page.
 *
 * Fields that belong to other layouts are dropped rather than carried invisibly, so a slide
 * switched from Table to Bullets and back does not quietly resurrect the old table.
 */
export function normalizeSlide(slide: PresentationSlide): PresentationSlide {
  const body = bodyFieldFor(slide.layout);
  const base: PresentationSlide = {
    ...(slide.generatedIndex !== undefined ? { generatedIndex: slide.generatedIndex } : {}),
    layout: slide.layout,
    ...(slide.sectionId ? { sectionId: slide.sectionId } : {}),
    ...(slide.section?.trim() ? { section: text(slide.section, EDIT_LIMITS.section).trim() } : {}),
    title: text(slide.title, EDIT_LIMITS.title).trim(),
    ...(slide.subtitle?.trim() ? { subtitle: text(slide.subtitle, EDIT_LIMITS.subtitle) } : {}),
    ...(slide.footnote?.trim() ? { footnote: text(slide.footnote, EDIT_LIMITS.footnote) } : {}),
    ...(slide.presenterNotes?.trim() ? { presenterNotes: text(slide.presenterNotes, EDIT_LIMITS.presenterNotes) } : {}),
  };

  if (body === "bullets") {
    const bullets = (slide.bullets || [])
      .map((bullet) => text(bullet, EDIT_LIMITS.bulletText).trim())
      .filter(Boolean)
      .slice(0, EDIT_LIMITS.bullets);
    if (bullets.length) base.bullets = bullets;
  }
  if (body === "stats") {
    const stats = normalizeStats(slide.stats);
    if (stats) base.stats = stats;
  }
  if (body === "columns") {
    const columns = (slide.columns || [])
      .map((column) => ({
        heading: text(column.heading, EDIT_LIMITS.section).trim(),
        items: (column.items || [])
          .map((item) => text(item, EDIT_LIMITS.bulletText).trim())
          .filter(Boolean)
          .slice(0, EDIT_LIMITS.columnItems),
      }))
      .filter((column) => column.heading || column.items.length)
      .slice(0, EDIT_LIMITS.columns);
    if (columns.length) base.columns = columns;
  }
  if (body === "table" && slide.table) {
    const headers = (slide.table.headers || [])
      .map((header) => text(header, EDIT_LIMITS.cell).trim())
      .slice(0, EDIT_LIMITS.tableColumns);
    const width = Math.max(headers.length, 1);
    const rows = (slide.table.rows || [])
      .map((row) =>
        Array.from({ length: width }, (_, column) => text(row?.[column], EDIT_LIMITS.cell).trim()),
      )
      .filter((row) => row.some(Boolean))
      .slice(0, EDIT_LIMITS.tableRows);
    if (headers.some(Boolean) || rows.length) {
      base.table = { headers: Array.from({ length: width }, (_, index) => headers[index] || ""), rows };
    }
  }
  if (body === "items") {
    const items = normalizeItems(slide.items);
    if (items) base.items = items;
  }
  return base;
}

/** A new, empty slide of this layout, scaffolded so the editor has something to type into. */
export function blankSlide(layout: PresentationLayout): PresentationSlide {
  const slide: PresentationSlide = { layout, title: "New slide" };
  switch (bodyFieldFor(layout)) {
    case "bullets":
      slide.bullets = [""];
      break;
    case "stats":
      slide.stats = [{ value: "", caption: "" }];
      break;
    case "columns":
      slide.columns = [
        { heading: "", items: [""] },
        { heading: "", items: [""] },
      ];
      break;
    case "table":
      slide.table = { headers: ["", ""], rows: [["", ""]] };
      break;
    case "items":
      slide.items = [{ label: "" }];
      break;
    default:
      break;
  }
  return slide;
}

/**
 * The same slide in a different layout, carrying across what the new one can hold.
 *
 * Bullets become column items and column items become bullets rather than vanishing, because an
 * AM who picked the wrong layout wants their words moved, not retyped. What the target layout has
 * no place for is dropped by `normalizeSlide`, which is the point: nothing is carried invisibly.
 */
export function relayoutSlide(slide: PresentationSlide, layout: PresentationLayout): PresentationSlide {
  const from = bodyFieldFor(slide.layout);
  const to = bodyFieldFor(layout);
  const next: PresentationSlide = { ...slide, layout };
  if (from === to) return normalizeSlide(next);

  const lines =
    from === "bullets"
      ? slide.bullets || []
      : from === "columns"
        ? (slide.columns || []).flatMap((column) => [column.heading, ...column.items].filter(Boolean))
        : from === "items"
          ? (slide.items || []).map((item) => [item.label, item.detail].filter(Boolean).join(" — "))
          : from === "stats"
            ? (slide.stats || []).map((stat) => [stat.value, stat.caption].filter(Boolean).join(" — "))
            : from === "table"
              ? (slide.table?.rows || []).map((row) => row.filter(Boolean).join(" · "))
              : [];

  delete next.bullets;
  delete next.stats;
  delete next.columns;
  delete next.table;
  delete next.items;

  if (to === "bullets") next.bullets = lines.length ? lines : [""];
  if (to === "items") next.items = lines.length ? lines.map((line) => ({ label: line })) : [{ label: "" }];
  if (to === "columns") {
    const half = Math.ceil(lines.length / 2);
    next.columns = lines.length
      ? [
          { heading: "", items: lines.slice(0, half) },
          { heading: "", items: lines.slice(half) },
        ]
      : [
          { heading: "", items: [""] },
          { heading: "", items: [""] },
        ];
  }
  if (to === "stats") {
    next.stats = lines.length ? lines.slice(0, EDIT_LIMITS.stats).map((line) => ({ value: "", caption: line })) : [{ value: "", caption: "" }];
  }
  if (to === "table") {
    next.table = lines.length
      ? { headers: ["", ""], rows: lines.map((line) => [line, ""]) }
      : { headers: ["", ""], rows: [["", ""]] };
  }
  return normalizeSlide(next);
}

// ---------------------------------------------------------------------------
// Deck-level moves
// ---------------------------------------------------------------------------

export function moveSlide(slides: PresentationSlide[], from: number, to: number): PresentationSlide[] {
  if (from === to || from < 0 || from >= slides.length || to < 0 || to >= slides.length) return slides;
  const next = [...slides];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function removeSlide(slides: PresentationSlide[], index: number): PresentationSlide[] {
  return slides.filter((_, position) => position !== index);
}

/**
 * A copy of one slide, placed directly after it.
 *
 * The copy keeps `generatedIndex`, which is deliberate: it is how the server knows to reattach the
 * same approved rank capture to both halves of a duplicated comparison slide. It is a pointer at
 * the generated original, not an identity.
 */
export function duplicateSlide(slides: PresentationSlide[], index: number): PresentationSlide[] {
  const slide = slides[index];
  if (!slide) return slides;
  const next = [...slides];
  next.splice(index + 1, 0, { ...slide, title: slide.title ? `${slide.title} (copy)` : "Copy" });
  return next;
}

export function insertSlide(
  slides: PresentationSlide[],
  index: number,
  layout: PresentationLayout = "bullets",
): PresentationSlide[] {
  const next = [...slides];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, blankSlide(layout));
  return next;
}

// ---------------------------------------------------------------------------
// What the client will actually see
// ---------------------------------------------------------------------------

export interface VisibilityWarning {
  /** "slide" when the whole slide would be dropped, otherwise the part that would be cut. */
  scope: "slide" | "title" | "subtitle" | "bullets" | "table" | "items" | "columns" | "stats" | "footnote";
  detail: string;
}

/**
 * What `clientSlides` would strip from this slide before a client ever sees it.
 *
 * Computed by running the real filter and diffing, never by a second copy of its rules: a warning
 * that drifted from the filter would be worse than no warning, because the AM would trust it.
 *
 * This is the one piece of the editor that exists purely to stop a silent failure. Without it, an
 * AM types "we'll fix the schema next week" into a slide, sees it in the editor, presents from the
 * deck -- and that line is simply not there, with nothing having said so.
 */
export function clientVisibilityWarnings(slide: PresentationSlide, blocked: string[] = []): VisibilityWarning[] {
  const [visible] = clientSlides([slide], blocked);
  if (!visible) {
    return [
      {
        scope: "slide",
        detail:
          slide.sectionId === "7"
            ? "This slide's section is internal, so the client never sees it."
            : "Every line on this slide reads as unfinished work, so the client sees none of it.",
      },
    ];
  }
  const warnings: VisibilityWarning[] = [];
  const lost = (before: number | undefined, after: number | undefined) => (before || 0) - (after || 0);

  if (slide.title && visible.title !== slide.title) {
    warnings.push({ scope: "title", detail: "The title reads as unfinished work and is replaced with “Completed work”." });
  }
  if ((slide.subtitle || "").trim() && !(visible.subtitle || "").trim()) {
    warnings.push({ scope: "subtitle", detail: "The subtitle reads as unfinished work and will not be shown." });
  }
  if ((slide.footnote || "").trim() && !(visible.footnote || "").trim()) {
    warnings.push({ scope: "footnote", detail: "The footnote reads as unfinished work and will not be shown." });
  }
  const bulletsLost = lost(slide.bullets?.length, visible.bullets?.length);
  if (bulletsLost > 0) {
    warnings.push({ scope: "bullets", detail: `${bulletsLost} bullet${bulletsLost > 1 ? "s" : ""} read as unfinished work and will not be shown.` });
  }
  const rowsLost = lost(slide.table?.rows.length, visible.table?.rows.length);
  if (rowsLost > 0) {
    warnings.push({ scope: "table", detail: `${rowsLost} table row${rowsLost > 1 ? "s" : ""} will not be shown. A table of tasks shows only rows marked completed.` });
  }
  const itemsLost = lost(slide.items?.length, visible.items?.length);
  if (itemsLost > 0) {
    warnings.push({
      scope: "items",
      detail:
        slide.layout === "status_list"
          ? `${itemsLost} item${itemsLost > 1 ? "s" : ""} will not be shown: a status list shows only items whose status is completed.`
          : `${itemsLost} item${itemsLost > 1 ? "s" : ""} read as unfinished work and will not be shown.`,
    });
  }
  const columnsLost = lost(slide.columns?.length, visible.columns?.length);
  if (columnsLost > 0) {
    warnings.push({ scope: "columns", detail: `${columnsLost} column${columnsLost > 1 ? "s" : ""} will not be shown.` });
  }
  const statsLost = lost(slide.stats?.length, visible.stats?.length);
  if (statsLost > 0) {
    warnings.push({ scope: "stats", detail: `${statsLost} figure${statsLost > 1 ? "s" : ""} read as unfinished work and will not be shown.` });
  }
  return warnings;
}

/** True when the client would see nothing of this slide at all. */
export function slideIsHiddenFromClient(slide: PresentationSlide, blocked: string[] = []): boolean {
  return clientSlides([slide], blocked).length === 0;
}
