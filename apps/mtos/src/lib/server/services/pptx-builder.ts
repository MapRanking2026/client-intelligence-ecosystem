import JSZip from "jszip";

import type { Presentation, PresentationSlide, PresentationTone } from "@/src/lib/mtos-data";

/**
 * Builds a real .pptx from a stored Presentation.
 *
 * Native shapes and text, not pictures of slides. Rendering the HTML viewer to
 * images would need a headless browser (which Vercel's runtime does not give us)
 * and would hand the client a deck nobody can edit or copy a number out of. The
 * trade is that the file is faithful to the brand and the content rather than
 * pixel-identical to the in-app viewer.
 *
 * A .pptx is a zip of OOXML. The minimum viable package is one presentation part,
 * one master, one layout, one theme, a notes master, and the slides -- each with
 * its relationship file, all declared in [Content_Types].xml. Omitting any one of
 * them makes PowerPoint declare the file corrupt, so keep the three lists at the
 * bottom (content types, presentation rels, slide ids) in step with each other.
 *
 * Geometry matches the viewer: a 1280x720 design grid on a 13.333x7.5in slide, so
 * one design pixel is exactly 9525 EMU and coordinates can be copied straight
 * across from presentation-slide.tsx.
 */

const EMU_PER_PX = 9525;
const SLIDE_W = 1280;
const SLIDE_H = 720;

const C = {
  navy: "0D1B2A",
  deepBlue: "0D47A1",
  blue: "1A73E8",
  brightBlue: "2979FF",
  paleBlue: "E8F0FD",
  border: "C8D8F0",
  gray: "444444",
  good: "2E7D32",
  watch: "F29C00",
  risk: "B71C1C",
  white: "FFFFFF",
} as const;

const px = (value: number) => Math.round(value * EMU_PER_PX);

/** XML text escape. Also strips control characters, which make the file unreadable. */
function esc(value: string): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toneHex(tone?: PresentationTone): string {
  if (tone === "good") return C.good;
  if (tone === "watch") return C.watch;
  if (tone === "risk") return C.risk;
  return C.blue;
}

let shapeId = 1;
const nextId = () => ++shapeId;

interface TextOpts {
  size: number;
  bold?: boolean;
  color?: string;
  align?: "l" | "ctr" | "r";
  spacing?: number;
  caps?: boolean;
  anchor?: "t" | "ctr" | "b";
  lineSpacePct?: number;
}

/** One text box. `lines` become paragraphs. */
function textBox(x: number, y: number, w: number, h: number, lines: string[], opts: TextOpts): string {
  const id = nextId();
  const paragraphs = lines
    .map(
      (line) =>
        `<a:p><a:pPr algn="${opts.align || "l"}"${
          opts.lineSpacePct ? `><a:lnSpc><a:spcPct val="${opts.lineSpacePct}"/></a:lnSpc></a:pPr` : "/"
        }><a:r><a:rPr lang="en-US" sz="${Math.round(opts.size * 100)}" b="${opts.bold ? 1 : 0}"${
          opts.spacing ? ` spc="${Math.round(opts.spacing * 100)}"` : ""
        }${opts.caps ? ' cap="all"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${
          opts.color || C.navy
        }"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${esc(line)}</a:t></a:r></a:p>`,
    )
    .join("");

  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="t${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${px(
    x,
  )}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="${
    opts.anchor || "t"
  }"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs || "<a:p/>"}</p:txBody></p:sp>`;
}

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill?: string,
  opts: { line?: string; lineW?: number; round?: boolean } = {},
): string {
  const id = nextId();
  const geom = opts.round ? "roundRect" : "rect";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="r${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${px(
    x,
  )}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm><a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>${
    fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : "<a:noFill/>"
  }${
    opts.line
      ? `<a:ln w="${px(opts.lineW || 2)}"><a:solidFill><a:srgbClr val="${opts.line}"/></a:solidFill></a:ln>`
      : "<a:ln><a:noFill/></a:ln>"
  }</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

function bulletLines(items: string[]): string[] {
  return items.map((item) => `•  ${item}`);
}

function pptxTable(x: number, y: number, w: number, headers: string[], rows: string[][]): string {
  const id = nextId();
  const colW = Math.floor(w / headers.length);
  const rowH = 38;
  const cell = (text: string, bold: boolean, fill: string, color: string, align: "l" | "r") =>
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="en-US" sz="1300" b="${
      bold ? 1 : 0
    }"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${esc(
      text,
    )}</a:t></a:r></a:p></a:txBody><a:tcPr marL="91440" marR="91440" anchor="ctr"><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`;

  const headerRow = `<a:tr h="${px(rowH)}">${headers
    .map((header, index) => cell(header, true, C.navy, C.white, index === 0 ? "l" : "r"))
    .join("")}</a:tr>`;

  const bodyRows = rows
    .map(
      (row, rowIndex) =>
        `<a:tr h="${px(rowH)}">${headers
          .map((_, cellIndex) =>
            cell(
              row[cellIndex] ?? "",
              cellIndex === 0,
              rowIndex % 2 ? C.paleBlue : C.white,
              C.navy,
              cellIndex === 0 ? "l" : "r",
            ),
          )
          .join("")}</a:tr>`,
    )
    .join("");

  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="tbl${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${px(
    x,
  )}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(
    rowH * (rows.length + 1),
  )}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${headers
    .map(() => `<a:gridCol w="${px(colW)}"/>`)
    .join("")}</a:tblGrid>${headerRow}${bodyRows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

/** Picture shape for the logo, which rId4 points at on every slide that uses it. */
function logoPic(x: number, y: number, w: number, h: number): string {
  const id = nextId();
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId4"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${px(
    x,
  )}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function buildSlideShapes(
  slide: PresentationSlide,
  deck: Presentation,
  number: number,
  total: number,
): { xml: string; usesLogo: boolean } {
  const parts: string[] = [];
  let usesLogo = false;

  if (slide.layout === "cover" || slide.layout === "closing") {
    const isCover = slide.layout === "cover";
    parts.push(rect(0, 0, SLIDE_W, 10, C.blue));
    parts.push(logoPic(72, 58, 54, 62));
    usesLogo = true;
    parts.push(textBox(142, 70, 400, 44, ["MapRanking"], { size: 20, bold: true, color: C.navy }));

    if (slide.section) {
      parts.push(
        textBox(72, 210, 760, 28, [slide.section], {
          size: 11,
          bold: true,
          color: C.blue,
          spacing: 2,
          caps: true,
        }),
      );
    }
    parts.push(
      textBox(72, 244, 800, 160, [slide.title], {
        size: isCover ? 40 : 34,
        bold: true,
        color: C.navy,
        lineSpacePct: 112000,
      }),
    );
    if (slide.subtitle) {
      parts.push(textBox(72, 410, 800, 90, [slide.subtitle], { size: 17, color: C.gray }));
    }

    if (isCover) {
      const fields: [string, string | undefined][] = [
        ["CLIENT", deck.clientName],
        ["PERIOD", deck.periodLabel],
        ["PREPARED FOR", deck.preparedFor],
        ["PREPARED BY", deck.preparedBy],
      ];
      let fx = 72;
      for (const [label, value] of fields) {
        if (!value) continue;
        parts.push(textBox(fx, 600, 240, 20, [label], { size: 9, bold: true, color: C.blue, spacing: 1.6 }));
        parts.push(textBox(fx, 622, 240, 30, [value], { size: 14, bold: true, color: C.navy }));
        fx += 270;
      }
    } else if (deck.title) {
      parts.push(
        textBox(72, 610, 700, 30, [deck.periodLabel ? `${deck.title} · ${deck.periodLabel}` : deck.title], {
          size: 12,
          color: C.gray,
        }),
      );
    }
    return { xml: parts.join(""), usesLogo };
  }

  // Shared chrome for every content slide.
  parts.push(rect(0, 0, SLIDE_W, 6, C.blue));
  let top = 46;
  if (slide.section) {
    parts.push(
      textBox(64, top, 1152, 24, [slide.section], { size: 10, bold: true, color: C.blue, spacing: 1.6, caps: true }),
    );
    top += 26;
  }
  parts.push(
    textBox(64, top, 1152, 96, [slide.title], { size: 26, bold: true, color: C.navy, lineSpacePct: 115000 }),
  );
  top += 90;
  if (slide.subtitle) {
    parts.push(textBox(64, top, 1152, 44, [slide.subtitle], { size: 14, color: C.gray }));
    top += 46;
  }

  const bodyTop = Math.max(top + 12, 180);
  const bodyW = 1152;

  if (slide.layout === "stat_callouts" && slide.stats?.length) {
    const n = Math.min(slide.stats.length, 4);
    const gap = 24;
    const cardW = (bodyW - gap * (n - 1)) / n;
    slide.stats.slice(0, n).forEach((stat, index) => {
      const x = 64 + index * (cardW + gap);
      parts.push(rect(x, bodyTop, cardW, 210, C.paleBlue, { line: C.border, lineW: 2, round: true }));
      parts.push(
        textBox(x + 20, bodyTop + 22, cardW - 40, 70, [stat.value], {
          size: 34,
          bold: true,
          color: toneHex(stat.tone),
        }),
      );
      parts.push(
        textBox(x + 20, bodyTop + 100, cardW - 40, 96, [stat.caption], { size: 13, color: C.navy, lineSpacePct: 125000 }),
      );
    });
  } else if (slide.layout === "agenda" && slide.bullets?.length) {
    slide.bullets.forEach((item, index) => {
      const y = bodyTop + index * 58;
      parts.push(rect(64, y, 38, 38, C.blue, { round: true }));
      parts.push(
        textBox(64, y + 7, 38, 28, [String(index + 1)], { size: 14, bold: true, color: C.white, align: "ctr" }),
      );
      parts.push(textBox(116, y + 4, bodyW - 60, 44, [item], { size: 16, color: C.navy }));
    });
  } else if (slide.layout === "questions" && slide.bullets?.length) {
    slide.bullets.forEach((item, index) => {
      const y = bodyTop + index * 62;
      parts.push(rect(64, y, bodyW, 52, C.paleBlue));
      parts.push(rect(64, y, 5, 52, C.brightBlue));
      parts.push(textBox(84, y + 12, bodyW - 40, 36, [item], { size: 15, color: C.navy }));
    });
  } else if (slide.layout === "two_column" && slide.columns?.length) {
    const colW = (bodyW - 40) / 2;
    slide.columns.slice(0, 2).forEach((column, index) => {
      const x = 64 + index * (colW + 40);
      parts.push(
        textBox(x, bodyTop, colW, 26, [column.heading], { size: 11, bold: true, color: C.blue, spacing: 1.2, caps: true }),
      );
      parts.push(rect(x, bodyTop + 30, colW, 2, C.border));
      parts.push(
        textBox(x, bodyTop + 44, colW, 340, bulletLines(column.items), {
          size: 14,
          color: C.navy,
          lineSpacePct: 150000,
        }),
      );
    });
  } else if (slide.layout === "table" && slide.table) {
    parts.push(pptxTable(64, bodyTop, bodyW, slide.table.headers, slide.table.rows));
  } else if (slide.layout === "status_list" && slide.items?.length) {
    slide.items.forEach((item, index) => {
      const y = bodyTop + index * 74;
      parts.push(rect(64, y, bodyW, 64, C.white, { line: C.border, lineW: 2, round: true }));
      let textX = 84;
      if (item.status) {
        const chipW = Math.max(90, item.status.length * 9 + 24);
        parts.push(rect(82, y + 18, chipW, 28, toneHex(item.tone), { round: true }));
        parts.push(
          textBox(82, y + 24, chipW, 20, [item.status], { size: 9, bold: true, color: C.white, align: "ctr", spacing: 1 }),
        );
        textX = 82 + chipW + 18;
      }
      parts.push(textBox(textX, y + 10, bodyW - (textX - 64) - 20, 26, [item.label], { size: 14, bold: true }));
      if (item.detail) {
        parts.push(
          textBox(textX, y + 34, bodyW - (textX - 64) - 20, 24, [item.detail], { size: 11, color: C.gray }),
        );
      }
    });
  } else if (slide.layout === "timeline" && slide.items?.length) {
    slide.items.forEach((item, index) => {
      const y = bodyTop + index * 70;
      parts.push(textBox(64, y + 4, 140, 28, [item.label], { size: 13, bold: true, color: C.blue, align: "r" }));
      parts.push(rect(226, y + 10, 12, 12, C.blue, { round: true }));
      if (index < (slide.items?.length ?? 0) - 1) {
        parts.push(rect(231, y + 22, 2, 48, C.border));
      }
      parts.push(textBox(262, y + 2, bodyW - 210, 56, [item.detail || item.label], { size: 14, color: C.navy }));
    });
  } else if (slide.bullets?.length) {
    parts.push(
      textBox(64, bodyTop, bodyW, 400, bulletLines(slide.bullets), {
        size: 16,
        color: C.navy,
        lineSpacePct: 155000,
      }),
    );
  }

  if (slide.footnote) {
    parts.push(textBox(64, 650, 820, 28, [slide.footnote], { size: 10, color: C.gray }));
  }
  parts.push(
    textBox(900, 650, 316, 28, [`MapRanking  |  ${number} / ${total}`], { size: 10, color: C.gray, align: "r" }),
  );

  return { xml: parts.join(""), usesLogo };
}

function slideXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function notesXml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${text
    .split("\n")
    .map((line) => `<a:p><a:r><a:rPr lang="en-US" sz="1200"/><a:t>${esc(line)}</a:t></a:r></a:p>`)
    .join("")}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="MapRanking"><a:themeElements><a:clrScheme name="MapRanking"><a:dk1><a:srgbClr val="${C.navy}"/></a:dk1><a:lt1><a:srgbClr val="${C.white}"/></a:lt1><a:dk2><a:srgbClr val="${C.deepBlue}"/></a:dk2><a:lt2><a:srgbClr val="${C.paleBlue}"/></a:lt2><a:accent1><a:srgbClr val="${C.blue}"/></a:accent1><a:accent2><a:srgbClr val="${C.good}"/></a:accent2><a:accent3><a:srgbClr val="${C.watch}"/></a:accent3><a:accent4><a:srgbClr val="${C.risk}"/></a:accent4><a:accent5><a:srgbClr val="${C.gray}"/></a:accent5><a:accent6><a:srgbClr val="${C.border}"/></a:accent6><a:hlink><a:srgbClr val="${C.blue}"/></a:hlink><a:folHlink><a:srgbClr val="${C.gray}"/></a:folHlink></a:clrScheme><a:fontScheme name="Arial"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${C.white}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const NOTES_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="1143000"/><a:ext cx="5029200" cy="4114800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:notesMaster>`;

export async function buildPptx(deck: Presentation, logo: Buffer | null): Promise<Buffer> {
  shapeId = 1;
  const zip = new JSZip();
  const slides = deck.slides || [];

  const built = slides.map((slide, index) => buildSlideShapes(slide, deck, index + 1, slides.length));
  const anyLogo = built.some((entry) => entry.usesLogo) && Boolean(logo);

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides
      .map(
        (_, index) =>
          `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide${
            index + 1
          }.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`,
      )
      .join("")}</Types>`,
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );

  const sldIds = slides
    .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 3}"/>`)
    .join("");

  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="${
      SLIDE_W * EMU_PER_PX
    }" cy="${SLIDE_H * EMU_PER_PX}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );

  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>${slides
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${
            index + 1
          }.xml"/>`,
      )
      .join("")}<Relationship Id="rId${
      slides.length + 3
    }" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`,
  );

  zip.file("ppt/theme/theme1.xml", THEME);
  zip.file("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER);
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT);
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file("ppt/notesMasters/notesMaster1.xml", NOTES_MASTER);
  zip.file(
    "ppt/notesMasters/_rels/notesMaster1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );

  if (anyLogo && logo) {
    zip.file("ppt/media/logo.png", logo);
  }

  slides.forEach((slide, index) => {
    const n = index + 1;
    zip.file(`ppt/slides/slide${n}.xml`, slideXml(built[index].xml));

    const rels = [
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
      `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`,
    ];
    if (built[index].usesLogo && logo) {
      rels.push(
        `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/>`,
      );
    }
    zip.file(
      `ppt/slides/_rels/slide${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`,
    );

    zip.file(`ppt/notesSlides/notesSlide${n}.xml`, notesXml(slide.presenterNotes || ""));
    zip.file(
      `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${n}.xml"/></Relationships>`,
    );
  });

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
