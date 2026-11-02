/**
 * Turning the review editor's HTML back into markdown.
 *
 * The brief arrives from the preparation as markdown, the account manager edits it in a rich-text
 * surface that produces HTML, and the Client's Book takes markdown. Something has to convert, and
 * it has to be this direction: markdown is what is stored in ClickUp and what next month's
 * preparation reads back, so the edited section has to end up in the same shape as an unedited one.
 *
 * Deliberately small. It handles exactly what the editor's seven buttons produce -- bold, italic,
 * underline, the two list kinds, links, and the block elements a browser inserts around them --
 * and throws the rest of the markup away rather than inventing a markdown spelling for it. A
 * pasted table becomes its own text on separate lines, which is lossy and legible; the
 * alternatives are a parser dependency, or leaving raw HTML in a ClickUp page where it renders as
 * angle brackets.
 */

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (match) => ENTITIES[match] ?? match)
    .replace(/&#(\d+);/g, (_, code) => {
      const point = Number(code);
      return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : "";
    });
}

/**
 * `htmlToMarkdown("<p>A <strong>win</strong></p>")` → `"A **win**"`.
 *
 * Lists are numbered by walking each `<ol>`, so a two-item ordered list comes out `1.` then `2.`
 * rather than `1.` twice -- which is what a naive replacement produces and what makes a filed
 * brief look like it lost half its items.
 */
export function htmlToMarkdown(html: string): string {
  let out = String(html || "");

  // Comments and anything scriptable: gone before the text is read, not after.
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "");

  // Ordered lists first, so the counter belongs to one list rather than to the document.
  out = out.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol\s*>/gi, (_, body: string) => {
    let index = 0;
    const items = body.replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, (__, item: string) => {
      index += 1;
      return `\n${index}. ${item.trim()}`;
    });
    return `\n${items.replace(/<\/?[uo]l\b[^>]*>/gi, "")}\n`;
  });
  out = out.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul\s*>/gi, (_, body: string) => {
    const items = body.replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, (__, item: string) => `\n- ${item.trim()}`);
    return `\n${items.replace(/<\/?[uo]l\b[^>]*>/gi, "")}\n`;
  });
  // A stray `<li>` outside a list still reads as an item.
  out = out.replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, (_, item: string) => `\n- ${item.trim()}`);

  // Links: only http(s) and mailto survive as links. Anything else keeps its text and loses the
  // address, because a `javascript:` or `file:` target in a filed brief is noise at best.
  out = out.replace(
    /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi,
    (_, double: string, single: string, text: string) => {
      const href = (double || single || "").trim();
      const label = text.replace(/<[^>]*>/g, "").trim();
      return /^(https?:|mailto:)/i.test(href) ? `[${label}](${href})` : label;
    },
  );

  out = out.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_, __, text: string) => `**${text.trim()}**`);
  out = out.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_, __, text: string) => `*${text.trim()}*`);
  // Underline has no markdown spelling. Bold is the closest thing a reader takes the same way.
  out = out.replace(/<u\b[^>]*>([\s\S]*?)<\/u\s*>/gi, (_, text: string) => `**${text.trim()}**`);
  out = out.replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, (_, text: string) => `\`${text.trim()}\``);

  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/(p|div|h[1-6]|tr|blockquote)\s*>/gi, "\n\n");
  out = out.replace(/<\/(td|th)\s*>/gi, " ");
  out = out.replace(/<[^>]*>/g, "");

  return decodeEntities(out)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `markdownToPlainText` for a subject line or a one-line summary: no markup, one line. */
export function markdownToPlainText(markdown: string): string {
  return String(markdown || "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
