/**
 * Making model-written markdown safe for ClickUp's Docs API.
 *
 * ClickUp validates markdown tables strictly on `POST /docs/.../pages`, and a single row whose
 * column count does not match the header rejects the WHOLE page:
 *
 *   400 Invalid Request: Invalid table structure: Table rows have mismatched column counts.
 *
 * That is what stopped the 18 November 2026 approval for a real client: the brief is written by a
 * model, one of its tables had a stray `|` inside a cell, and the entire Client's Book page was
 * refused over a formatting detail nobody could see on the review screen. The approval itself,
 * the agenda email and the call build had all already happened, so the touch was left half-filed.
 *
 * Two functions, deliberately separate, because they answer different questions:
 *
 *   - `normalizeMarkdownTables` is what every page is sent through. It repairs the table rather
 *     than dropping it: short rows are padded, long rows have their surplus folded back into the
 *     last cell with the pipe escaped, so no cell of the model's text is ever thrown away.
 *   - `flattenMarkdownTables` is the fallback after ClickUp has refused anyway. It turns every
 *     table into bullet lines, which cannot be malformed. A brief that reads a little plainer is
 *     always better than a brief that is not in the book at all.
 *
 * Fenced code blocks are left untouched by both: a pipe inside a fence is code, not a table.
 *
 * Kept free of ClickUp and Firestore so the rules can be exercised directly
 * (`npm run check:clickup-markdown`).
 */

/** Split one table row into cells, honouring `\|` as a literal pipe rather than a separator. */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      current += "\\|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function looksLikeRow(line: string): boolean {
  return line.includes("|");
}

/** `| --- | :--: |` and friends: the line that makes the row above it a table header. */
function isSeparatorRow(line: string): boolean {
  if (!looksLikeRow(line)) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

/** The separator cell for one column, keeping whatever alignment the model asked for. */
function separatorCell(existing: string | undefined): string {
  const cell = (existing || "").trim();
  if (/^:-+:$/.test(cell)) return ":---:";
  if (/^:-+$/.test(cell)) return ":---";
  if (/^-+:$/.test(cell)) return "---:";
  return "---";
}

/**
 * One row at exactly `width` cells.
 *
 * Surplus cells are folded into the last one with the pipe escaped rather than dropped, because
 * the usual cause of a long row is an unescaped `|` inside the model's own prose -- and the text
 * on either side of it is content the AM is meant to read.
 */
function fitRow(cells: string[], width: number): string[] {
  if (cells.length === width) return cells;
  if (cells.length < width) {
    return [...cells, ...Array.from({ length: width - cells.length }, () => "")];
  }
  const kept = cells.slice(0, width - 1);
  const folded = cells.slice(width - 1).join(" \\| ");
  return [...kept, folded];
}

function renderRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

interface TableBlock {
  /** The line index just past the table. */
  end: number;
  header: string[];
  separator: string[];
  rows: string[][];
}

/**
 * The table starting at `start`, or nothing when those lines are not a table.
 *
 * A table is a row, a separator directly under it, and then every row-shaped line until a blank
 * line or a line with no pipe in it. That is GitHub's rule, and it is also ClickUp's.
 */
function readTable(lines: string[], start: number): TableBlock | null {
  const headerLine = lines[start];
  const separatorLine = lines[start + 1];
  if (!headerLine || !looksLikeRow(headerLine) || !separatorLine || !isSeparatorRow(separatorLine)) {
    return null;
  }
  const header = splitRow(headerLine);
  const separator = splitRow(separatorLine);
  const rows: string[][] = [];
  let index = start + 2;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || !looksLikeRow(line)) break;
    rows.push(splitRow(line));
  }
  return { end: index, header, separator, rows };
}

/** True while this line opens or closes a fenced code block. */
function isFence(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

/**
 * Walk the document, handing each table to `onTable` and every other line through untouched.
 *
 * Shared by both exports so there is one definition of where a table starts and ends: a repair and
 * a flattening that disagreed about that would differ on exactly the malformed input that matters.
 */
function mapTables(markdown: string, onTable: (table: TableBlock) => string[]): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isFence(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    const table = readTable(lines, index);
    if (!table) {
      out.push(line);
      continue;
    }
    out.push(...onTable(table));
    index = table.end - 1;
  }

  return out.join("\n");
}

/**
 * Every markdown table with all of its rows at the header's column count.
 *
 * The width comes from the header rather than from the widest row: the header is what the reader
 * sees as the shape of the table, and widening it to accommodate one row with a stray pipe would
 * leave an unnamed column down the whole table.
 */
export function normalizeMarkdownTables(markdown: string): string {
  return mapTables(markdown, (table) => {
    const width = Math.max(table.header.length, 1);
    const separator = Array.from({ length: width }, (_, column) => separatorCell(table.separator[column]));
    return [
      renderRow(fitRow(table.header, width)),
      renderRow(separator),
      ...table.rows.map((row) => renderRow(fitRow(row, width))),
    ];
  });
}

/**
 * Every markdown table as bullet lines, for the retry after ClickUp has refused the page anyway.
 *
 * `- **Keyword:** plumber · **Rank:** 3` rather than a grid: it keeps every value and its column
 * name, and there is no structure left for a parser to reject. Rows of a table with no usable
 * header fall back to the cells joined, which still reads as a row.
 */
export function flattenMarkdownTables(markdown: string): string {
  return mapTables(markdown, (table) => {
    const headers = table.header.map((cell) => cell.replace(/\\\|/g, "|").trim());
    const named = headers.some(Boolean);
    const lines = table.rows.map((row) => {
      const cells = row.map((cell) => cell.replace(/\\\|/g, "|").trim());
      if (!named) {
        return `- ${cells.filter(Boolean).join(" · ")}`;
      }
      const parts = cells
        .map((cell, column) => {
          const label = headers[column];
          if (!cell) return "";
          return label ? `**${label}:** ${cell}` : cell;
        })
        .filter(Boolean);
      return `- ${parts.join(" · ")}`;
    });
    const body = lines.filter((line) => line.trim() !== "-");
    if (!body.length && named) {
      // A header with no rows under it still says what the table was going to show.
      return [`- ${headers.filter(Boolean).join(" · ")}`];
    }
    return body;
  });
}

/** True when this is the 400 ClickUp returns for a table it will not parse. */
export function isTableStructureError(message: string): boolean {
  return /invalid table structure|mismatched column counts/i.test(message);
}
