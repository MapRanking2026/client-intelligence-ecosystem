/**
 * Answer structure: lists, list items (with a "lead" — the item title), and
 * prose sentences/clauses. Used to decide (a) whether an answer presents an
 * explicitly ordered recommendation list and (b) which passage supports each
 * mention.
 */

export interface ListItem {
  /** Number shown in the answer for ordered lists; null for bullets. */
  number: number | null;
  start: number;
  end: number;
  /** Item title span (bold text, text before " - " / ":" / "–", or first line). */
  leadStart: number;
  leadEnd: number;
  lead: string;
}

export interface ParsedList {
  ordered: boolean;
  items: ListItem[];
}

export interface Passage {
  start: number;
  end: number;
  kind: "list_item" | "sentence";
  listIndex?: number;
  itemIndex?: number;
}

const ORDERED_RE = /^(\s{0,3})(?:#{1,6}\s*)?(?:\*\*|__)?\s*(\d{1,2})[.)]\s+(.*)$/;
const BULLET_RE = /^(\s{0,3})[-*•]\s+(.*)$/;
const HEADING_RE = /^\s{0,3}#{1,6}\s+/;

interface Line {
  text: string;
  start: number;
  end: number;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let pos = 0;
  for (const raw of text.split("\n")) {
    lines.push({ text: raw, start: pos, end: pos + raw.length });
    pos += raw.length + 1;
  }
  return lines;
}

/** Extract an item's lead (title) from its first line, relative to the line start. */
function leadOf(lineText: string, contentOffset: number): { s: number; e: number } {
  const content = lineText.slice(contentOffset);
  const bold = content.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)/);
  if (bold && bold.index !== undefined) {
    const s = contentOffset + content.indexOf(bold[1]);
    // "**Molly Maid:**" → lead "Molly Maid" (drop trailing separators inside the bold).
    const trimmed = bold[1].replace(/[\s:;,.–—-]+$/, "");
    return { s, e: s + trimmed.length };
  }
  const link = content.match(/^\s*\[([^\]]+)\]\(/);
  if (link) {
    const s = contentOffset + content.indexOf(link[1]);
    return { s, e: s + link[1].length };
  }
  const ws = content.length - content.trimStart().length;
  const body = content.slice(ws);
  const sep = body.search(/\s[-–—]\s|:\s|\s\(/);
  const leadRaw = (sep > 0 ? body.slice(0, sep) : body).replace(/[\s:;,.–—-]+$/, "");
  const s = contentOffset + ws;
  return { s, e: s + leadRaw.length };
}

export function parseLists(text: string): ParsedList[] {
  const lines = splitLines(text);
  const lists: ParsedList[] = [];
  let current: ParsedList | null = null;
  let lastItemEndLine = -1;

  const closeLastItem = (endLine: number) => {
    if (!current || !current.items.length) return;
    const item = current.items[current.items.length - 1];
    item.end = lines[Math.max(endLine, 0)].end;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const om = line.text.match(ORDERED_RE);
    const bm = om ? null : line.text.match(BULLET_RE);
    const isTopOrdered = om && om[1].length <= 1;
    const isTopBullet = bm && bm[1].length <= 1;

    if (isTopOrdered || isTopBullet) {
      const ordered = Boolean(isTopOrdered);
      if (!current || current.ordered !== ordered) {
        if (current) closeLastItem(lastItemEndLine);
        current = { ordered, items: [] };
        lists.push(current);
      } else {
        closeLastItem(i - 1);
      }
      const contentOffset = line.text.length - (ordered ? om![3] : bm![2]).length;
      const lead = leadOf(line.text, contentOffset);
      current.items.push({
        number: ordered ? Number(om![2]) : null,
        start: line.start,
        end: line.end,
        leadStart: line.start + lead.s,
        leadEnd: line.start + lead.e,
        lead: text.slice(line.start + lead.s, line.start + lead.e).replace(/[*_]+/g, "").trim(),
      });
      lastItemEndLine = i;
      continue;
    }

    if (!current) continue;
    const blank = line.text.trim() === "";
    if (blank) continue;
    const indented = /^\s{2,}/.test(line.text) || BULLET_RE.test(line.text);
    const prevBlank = i > 0 && lines[i - 1].text.trim() === "";
    // A non-indented paragraph after a blank line ends the list unless more
    // items of the same list follow later (ordered "### 1." style sections).
    if (HEADING_RE.test(line.text) && !ORDERED_RE.test(line.text)) {
      closeLastItem(lastItemEndLine);
      current = null;
      continue;
    }
    if (prevBlank && !indented) {
      const moreItemsFollow = lines
        .slice(i + 1)
        .some((l) => (current!.ordered ? ORDERED_RE.test(l.text) : BULLET_RE.test(l.text)));
      if (!moreItemsFollow || !current.ordered) {
        closeLastItem(lastItemEndLine);
        current = null;
        continue;
      }
    }
    lastItemEndLine = i;
  }
  if (current) closeLastItem(lastItemEndLine);

  return lists.filter((l) => l.items.length > 0);
}

/** An ordered list counts as "explicitly ordered" when it has ≥ 2 items numbered 1..n. */
export function isProperlyOrdered(list: ParsedList): boolean {
  if (!list.ordered || list.items.length < 2) return false;
  return list.items.every((it, idx) => it.number === idx + 1 || (idx > 0 && it.number === list.items[idx - 1].number! + 1));
}

const SENTENCE_RE = /[^.!?\n]+(?:[.!?]+|\n|$)/g;

/** Passages: list items, plus prose sentences outside lists. */
export function passages(text: string, lists: ParsedList[]): Passage[] {
  const out: Passage[] = [];
  const covered: Array<[number, number]> = [];
  lists.forEach((l, li) =>
    l.items.forEach((it, ii) => {
      out.push({ start: it.start, end: it.end, kind: "list_item", listIndex: li, itemIndex: ii });
      covered.push([it.start, it.end]);
    }),
  );
  for (const m of text.matchAll(SENTENCE_RE)) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (!m[0].trim()) continue;
    if (covered.some(([a, b]) => s >= a && e <= b + 1)) continue;
    out.push({ start: s, end: e, kind: "sentence" });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Clause boundaries inside a passage so cues bind to the nearest business. */
export function clauses(text: string, p: { start: number; end: number }): Array<{ start: number; end: number }> {
  const seg = text.slice(p.start, p.end);
  const out: Array<{ start: number; end: number }> = [];
  const re = /;|\.\s|\bbut\b|\bhowever\b|\bwhereas\b|\bwhile\b|—/gi;
  let last = 0;
  for (const m of seg.matchAll(re)) {
    const idx = m.index ?? 0;
    out.push({ start: p.start + last, end: p.start + idx });
    last = idx + m[0].length;
  }
  out.push({ start: p.start + last, end: p.end });
  return out.filter((c) => c.end > c.start);
}
