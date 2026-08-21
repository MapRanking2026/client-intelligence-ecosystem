/**
 * Branded report generator. Renders a professional client report as a .docx,
 * styled entirely from a per-tenant ReportBrand (colors, font, logo, company
 * name, footer). The layout is fixed and proven; the brand is swappable, so a
 * different tenant's reports come out in their own look.
 *
 * This is the in-app port of the MapRanking report design system, parameterized.
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
  Header, Footer, PageNumber, ImageRun, ExternalHyperlink, PageBreak,
} from "docx";

import type { ReportBrand } from "@/src/lib/server/services/report-brand-service";
import { DEFAULT_LOGO_BASE64 } from "@/src/lib/server/reports/default-logo";

export interface ReportKeywordRow {
  term: string;
  share: string;
  rank: string;
  trend: string;
  tone: "gain" | "hold" | "watch";
}
export interface ReportLink {
  name: string;
  url: string;
  note: string;
}
export interface ReportData {
  reportTypeLabel: string;
  clientName: string;
  websiteLabel: string;
  location: string;
  dateLabel: string;
  intro: string;
  stats: [string, string][];
  transformationTitle: string;
  transformationBody: string;
  keywordIntro: string;
  keywordRows: ReportKeywordRow[];
  keywordCaption: string;
  searchesThatMatter: string;
  pagesIntro: string;
  pagesBuilt: ReportLink[];
  alsoDid: string[];
  inProgress: string[];
  qualityIntro: string;
  qualityItems: string[];
  recommendation: string;
  nextSteps: string[];
  forwardIntro: string;
  forwardLook: { area: string; meaning: string }[];
  closing: string;
  signerName: string;
  signerTitle: string;
}

const GREEN = "2e7d32", AMBER = "e65100", GRAY_DARK = "1a1a2e", GRAY_MID = "444444", WHITE = "ffffff", BORDER = "c8d8f0";

const noBorder = {
  top: { style: BorderStyle.NONE, size: 0, color: "auto" }, bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
  left: { style: BorderStyle.NONE, size: 0, color: "auto" }, right: { style: BorderStyle.NONE, size: 0, color: "auto" },
};
const bdr = (c = BORDER, sz = 1) => ({
  top: { style: BorderStyle.SINGLE, size: sz, color: c }, bottom: { style: BorderStyle.SINGLE, size: sz, color: c },
  left: { style: BorderStyle.SINGLE, size: sz, color: c }, right: { style: BorderStyle.SINGLE, size: sz, color: c },
});
const pt = (n: number) => n * 20;
const sp = (b = 0, a = 0, ln = 276) => ({ before: pt(b), after: pt(a), line: ln, lineRule: "auto" as const });
const pad = (t = 100, b = 100, l = 160, r = 160) => ({ top: t, bottom: b, left: l, right: r });

export function buildReportDocx(brand: ReportBrand, data: ReportData): Promise<Buffer> {
  const C = brand.colors;
  const FONT = brand.font || "Arial";
  const logo = Buffer.from((brand.logoDataUrl?.split(",").pop()) || DEFAULT_LOGO_BASE64, "base64");

  const run = (text: string, o: { size?: number; bold?: boolean; color?: string; italic?: boolean } = {}) =>
    new TextRun({ text, font: FONT, size: o.size || 22, bold: o.bold || false, color: o.color || GRAY_DARK, italics: o.italic || false });
  const para = (children: (TextRun | ExternalHyperlink)[], o: { spacing?: ReturnType<typeof sp>; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; indent?: { left?: number; hanging?: number } } = {}) =>
    new Paragraph({ children, spacing: o.spacing || sp(0, 6), alignment: o.align, indent: o.indent });
  const gap = (n = 8) => new Paragraph({ spacing: sp(n, 0), children: [] });
  const link = (text: string, url: string, o: { bold?: boolean } = {}) =>
    new ExternalHyperlink({ link: url, children: [new TextRun({ text, font: FONT, size: 20, bold: o.bold, color: C.blue, underline: {} })] });

  const secHead = (label: string, title: string) => [
    new Paragraph({ children: [run(label.toUpperCase(), { size: 17, bold: true, color: C.blueBright })], spacing: sp(18, 2) }),
    new Paragraph({ children: [run(title, { size: 30, bold: true, color: C.blueDeep })], spacing: sp(0, 10), border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.blueMid, space: 4 } } }),
  ];

  const bullet = (text: string) => para([run("•  ", { bold: true, size: 20, color: C.blueMid }), run(text, { size: 20, color: GRAY_MID })], { spacing: sp(0, 5), indent: { left: 300, hanging: 200 } });
  const step = (n: number, text: string) => para([run(n + ".  ", { bold: true, size: 20, color: C.blueMid }), run(text, { size: 20, color: GRAY_MID })], { spacing: sp(0, 7), indent: { left: 320, hanging: 240 } });

  // Header (logo + company + report type, client on the right)
  const makeHeader = new Header({
    children: [new Table({
      width: { size: 9720, type: WidthType.DXA }, columnWidths: [900, 5580, 3240],
      rows: [new TableRow({ children: [
        new TableCell({ children: [new Paragraph({ children: [new ImageRun({ type: "png", data: logo, transformation: { width: 36, height: 36 }, altText: { title: brand.companyName, description: `${brand.companyName} logo`, name: brand.companyName } })], spacing: sp(0, 0) })], borders: { ...noBorder, bottom: { style: BorderStyle.SINGLE, size: 2, color: C.blue } }, margins: pad(40, 60, 0, 80), width: { size: 900, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER }),
        new TableCell({ children: [para([run(brand.companyName, { bold: true, size: 22, color: C.blue }), run("  |  " + data.reportTypeLabel, { size: 19, color: GRAY_MID })], { spacing: sp(0, 0) })], borders: { ...noBorder, bottom: { style: BorderStyle.SINGLE, size: 2, color: C.blue } }, margins: pad(40, 60, 0, 0), width: { size: 5580, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER }),
        new TableCell({ children: [para([run(data.clientName, { size: 18, color: GRAY_MID })], { spacing: sp(0, 0), align: AlignmentType.RIGHT })], borders: { ...noBorder, bottom: { style: BorderStyle.SINGLE, size: 2, color: C.blue } }, margins: pad(40, 60, 0, 0), width: { size: 3240, type: WidthType.DXA } }),
      ] })],
    })],
  });
  const makeFooter = new Footer({
    children: [new Paragraph({
      children: [
        new TextRun({ text: brand.footerText + "  |  Page ", font: FONT, size: 17, color: GRAY_MID }),
        new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 17, color: GRAY_MID }),
        new TextRun({ text: " of ", font: FONT, size: 17, color: GRAY_MID }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 17, color: GRAY_MID }),
      ],
      alignment: AlignmentType.RIGHT, border: { top: { style: BorderStyle.SINGLE, size: 1, color: BORDER, space: 4 } }, spacing: sp(4, 0),
    })],
  });

  // Cover
  const metaPairs: [string, string][] = [["CLIENT", data.clientName], ["LOCATION", data.location], ["DATE", data.dateLabel]];
  const metaWidth = Math.floor(8500 / metaPairs.length);
  const cover = new Table({
    width: { size: 9720, type: WidthType.DXA }, columnWidths: [9720],
    rows: [new TableRow({ children: [new TableCell({
      children: [
        new Paragraph({ children: [new ImageRun({ type: "png", data: logo, transformation: { width: 72, height: 72 }, altText: { title: brand.companyName, description: `${brand.companyName} logo`, name: brand.companyName } })], alignment: AlignmentType.CENTER, spacing: sp(0, 8) }),
        new Paragraph({ children: [run(data.reportTypeLabel.toUpperCase(), { bold: true, size: 20, color: "a0c4ff" })], spacing: sp(0, 8), alignment: AlignmentType.CENTER }),
        new Paragraph({ children: [run(data.clientName, { bold: true, size: 52, color: WHITE })], spacing: sp(0, 6), alignment: AlignmentType.CENTER }),
        new Paragraph({ children: [run(data.websiteLabel, { size: 20, color: "7eb8ff" })], spacing: sp(0, 24), alignment: AlignmentType.CENTER }),
        new Table({ width: { size: 8500, type: WidthType.DXA }, columnWidths: metaPairs.map(() => metaWidth), rows: [new TableRow({ children: metaPairs.map((m, i) => new TableCell({
          children: [para([run(m[0], { size: 16, bold: true, color: "7eb8ff" })], { spacing: sp(0, 2), align: AlignmentType.CENTER }), para([run(m[1], { size: 19, bold: true, color: WHITE })], { spacing: sp(0, 0), align: AlignmentType.CENTER })],
          borders: i === 0 || i === metaPairs.length - 1 ? noBorder : { ...noBorder, left: { style: BorderStyle.SINGLE, size: 2, color: C.blueBright }, right: { style: BorderStyle.SINGLE, size: 2, color: C.blueBright } },
          margins: pad(40, 40, 40, 40), width: { size: metaWidth, type: WidthType.DXA },
        })) })] }),
        gap(4),
      ],
      shading: { fill: C.navy, type: ShadingType.CLEAR }, borders: noBorder, margins: pad(280, 280, 200, 200), width: { size: 9720, type: WidthType.DXA },
    })] })],
  });

  const statsTable = (stats: [string, string][]) => {
    const w = Math.floor(9720 / stats.length);
    const lastW = 9720 - w * (stats.length - 1);
    return new Table({ width: { size: 9720, type: WidthType.DXA }, columnWidths: stats.map((_, i) => (i === stats.length - 1 ? lastW : w)),
      rows: [new TableRow({ children: stats.map(([num, lbl], i) => new TableCell({
        children: [para([run(String(num), { bold: true, size: 46, color: C.blueBright })], { spacing: sp(4, 0), align: AlignmentType.CENTER }), para([run(lbl.toUpperCase(), { size: 15, color: GRAY_MID })], { spacing: sp(0, 4), align: AlignmentType.CENTER })],
        shading: { fill: C.blueBg, type: ShadingType.CLEAR }, borders: noBorder, margins: pad(120, 120, 40, 40), width: { size: i === stats.length - 1 ? lastW : w, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
      })) })] });
  };
  const infoBox = (labelText: string, bodyText: string) => new Table({
    width: { size: 9720, type: WidthType.DXA }, columnWidths: [9720],
    rows: [new TableRow({ children: [new TableCell({
      children: [para([run(labelText, { bold: true, size: 19, color: WHITE })], { spacing: sp(0, 4) }), para([run(bodyText, { size: 20, color: C.bluePale })], { spacing: sp(0, 0) })],
      shading: { fill: C.blueDeep, type: ShadingType.CLEAR }, borders: { ...noBorder, left: { style: BorderStyle.THICK, size: 10, color: C.blueBright } }, margins: pad(120, 120, 200, 200), width: { size: 9720, type: WidthType.DXA },
    })] })],
  });

  // Keyword table
  const KW = [3760, 1720, 1560, 2680];
  const toneColor = (t: ReportKeywordRow["tone"]) => (t === "gain" ? GREEN : t === "watch" ? AMBER : C.blueDeep);
  const kwHeadCell = (t: string, w: number, align?: (typeof AlignmentType)[keyof typeof AlignmentType]) => new TableCell({ children: [para([run(t, { bold: true, size: 19, color: WHITE })], { spacing: sp(2, 2), align })], shading: { fill: C.blueMid, type: ShadingType.CLEAR }, borders: noBorder, margins: pad(80, 80, 120, 120), width: { size: w, type: WidthType.DXA } });
  const kwCell = (t: string, w: number, o: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; color?: string; bold?: boolean; bg?: string } = {}) => new TableCell({ children: [para([run(t, { size: 20, color: o.color || GRAY_DARK, bold: o.bold })], { spacing: sp(2, 2), align: o.align })], shading: { fill: o.bg, type: ShadingType.CLEAR }, borders: bdr(BORDER), margins: pad(80, 80, 120, 120), width: { size: w, type: WidthType.DXA } });
  const keywordTable = new Table({ width: { size: 9720, type: WidthType.DXA }, columnWidths: KW, rows: [
    new TableRow({ children: [kwHeadCell("Search term", KW[0]), kwHeadCell("Market share", KW[1], AlignmentType.CENTER), kwHeadCell("Avg. map rank", KW[2], AlignmentType.CENTER), kwHeadCell("Last 30 days", KW[3])] }),
    ...data.keywordRows.map((r, i) => { const bg = i % 2 === 0 ? WHITE : C.blueBg; return new TableRow({ children: [
      kwCell(r.term, KW[0], { color: C.blueDeep, bold: true, bg }),
      kwCell(r.share, KW[1], { align: AlignmentType.CENTER, bold: true, bg }),
      kwCell(r.rank, KW[2], { align: AlignmentType.CENTER, bg }),
      kwCell(r.trend, KW[3], { color: toneColor(r.tone), bold: true, bg }),
    ] }); }),
  ] });

  // Pages-built table (clickable)
  const PG = [3860, 5860];
  const pagesTable = new Table({ width: { size: 9720, type: WidthType.DXA }, columnWidths: PG, rows: [
    new TableRow({ children: [
      new TableCell({ children: [para([run("Page (click to view live)", { bold: true, size: 19, color: WHITE })], { spacing: sp(2, 2) })], shading: { fill: C.blueMid, type: ShadingType.CLEAR }, borders: noBorder, margins: pad(80, 80, 120, 120), width: { size: PG[0], type: WidthType.DXA } }),
      new TableCell({ children: [para([run("What we did", { bold: true, size: 19, color: WHITE })], { spacing: sp(2, 2) })], shading: { fill: C.blueMid, type: ShadingType.CLEAR }, borders: noBorder, margins: pad(80, 80, 120, 120), width: { size: PG[1], type: WidthType.DXA } }),
    ] }),
    ...data.pagesBuilt.map((r, i) => { const bg = i % 2 === 0 ? WHITE : C.blueBg; return new TableRow({ children: [
      new TableCell({ children: [new Paragraph({ spacing: sp(2, 2), children: [link(r.name, r.url, { bold: true })] })], shading: { fill: bg, type: ShadingType.CLEAR }, borders: bdr(BORDER), margins: pad(80, 80, 120, 120), width: { size: PG[0], type: WidthType.DXA } }),
      new TableCell({ children: [para([run(r.note, { size: 20, color: GRAY_DARK })], { spacing: sp(2, 2) })], shading: { fill: bg, type: ShadingType.CLEAR }, borders: bdr(BORDER), margins: pad(80, 80, 120, 120), width: { size: PG[1], type: WidthType.DXA } }),
    ] }); }),
  ] });

  const impactTable = new Table({ width: { size: 9720, type: WidthType.DXA }, columnWidths: [2400, 7320], rows: [
    new TableRow({ children: [
      new TableCell({ children: [para([run("AREA", { bold: true, size: 19, color: WHITE })], { spacing: sp(2, 2) })], shading: { fill: C.navy, type: ShadingType.CLEAR }, borders: noBorder, margins: pad(80, 80, 120, 120), width: { size: 2400, type: WidthType.DXA } }),
      new TableCell({ children: [para([run("WHAT IT MEANS FOR YOUR BUSINESS", { bold: true, size: 19, color: WHITE })], { spacing: sp(2, 2) })], shading: { fill: C.navy, type: ShadingType.CLEAR }, borders: noBorder, margins: pad(80, 80, 120, 120), width: { size: 7320, type: WidthType.DXA } }),
    ] }),
    ...data.forwardLook.map((r, i) => { const bg = i % 2 === 0 ? WHITE : C.blueBg; return new TableRow({ children: [
      new TableCell({ children: [para([run(r.area, { bold: true, size: 20, color: C.blueDeep })], { spacing: sp(2, 2) })], shading: { fill: bg, type: ShadingType.CLEAR }, borders: bdr(BORDER), margins: pad(80, 80, 120, 120), width: { size: 2400, type: WidthType.DXA } }),
      new TableCell({ children: [para([run(r.meaning, { size: 20, color: GRAY_DARK })], { spacing: sp(2, 2) })], shading: { fill: bg, type: ShadingType.CLEAR }, borders: bdr(BORDER), margins: pad(80, 80, 120, 120), width: { size: 7320, type: WidthType.DXA } }),
    ] }); }),
  ] });

  const children = [
    cover,
    new Paragraph({ children: [new PageBreak()] }),
    ...secHead("Section 01", "Executive Summary"),
    para([run(data.intro, { size: 22, color: GRAY_MID })], { spacing: sp(0, 8) }),
    gap(4), statsTable(data.stats), gap(6),
    infoBox(data.transformationTitle, data.transformationBody),
    ...secHead("Section 02", "Your Local Search Results"),
    para([run(data.keywordIntro, { size: 20, color: GRAY_MID })], { spacing: sp(0, 8) }),
    keywordTable,
    para([run(data.keywordCaption, { size: 17, color: GRAY_MID, italic: true })], { spacing: sp(4, 8) }),
    infoBox("THE SEARCHES THAT MATTER MOST", data.searchesThatMatter),
    ...secHead("Section 03", "Work Completed On Your Website"),
    para([run(data.pagesIntro, { size: 20, color: GRAY_MID })], { spacing: sp(0, 8) }),
    ...(data.pagesBuilt.length ? [pagesTable, gap(6)] : []),
    para([run("Beyond the pages above, our team also:", { size: 20, color: GRAY_MID, bold: true })], { spacing: sp(0, 4) }),
    ...data.alsoDid.map(bullet),
    ...secHead("Section 04", "Currently In Progress"),
    ...data.inProgress.map(bullet),
    ...secHead("Section 05", "Quality & Transparency"),
    para([run(data.qualityIntro, { size: 20, color: GRAY_MID })], { spacing: sp(0, 4) }),
    ...data.qualityItems.map(bullet),
    gap(4), infoBox("OUR TOP RECOMMENDATION", data.recommendation),
    ...secHead("Section 06", "Recommended Next Steps"),
    ...data.nextSteps.map((s, i) => step(i + 1, s)),
    ...secHead("Section 07", "What This Means Going Forward"),
    para([run(data.forwardIntro, { size: 20, color: GRAY_MID })], { spacing: sp(0, 8) }),
    impactTable,
    new Paragraph({ spacing: sp(10, 10), border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: C.bluePale, space: 1 } }, children: [] }),
    para([run(data.closing, { size: 21, color: GRAY_DARK })], { spacing: sp(0, 10) }),
    para([run(data.signerName, { bold: true, size: 22, color: C.blueDeep })], { spacing: sp(6, 0) }),
    para([run(data.signerTitle, { size: 19, color: GRAY_MID })], { spacing: sp(0, 0) }),
  ];

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1300, right: 1260, bottom: 1300, left: 1260 } } },
      headers: { default: makeHeader },
      footers: { default: makeFooter },
      children,
    }],
  });

  return Packer.toBuffer(doc) as Promise<Buffer>;
}
