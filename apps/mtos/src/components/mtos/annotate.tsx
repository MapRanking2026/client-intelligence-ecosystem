import Link from "next/link";
import type { ReactNode } from "react";
import { ShieldAlert, Clock, CheckCircle2, Lightbulb, BookMarked, type LucideIcon } from "lucide-react";

export type AnnoTone = "critical" | "important" | "positive" | "info" | "reference";

/** Level 1 — inline highlight. Bold always; semantic tint only when Annotations are ON. */
export function Hl({ tone = "important", children }: { tone?: AnnoTone; children: ReactNode }) {
  return <span className={`hl ${tone}`}>{children}</span>;
}

const CALLOUT_ICON: Record<AnnoTone, LucideIcon> = {
  critical: ShieldAlert,
  important: Clock,
  positive: CheckCircle2,
  info: Lightbulb,
  reference: BookMarked,
};

/** Level 3 — annotated callout. Structural; picks up semantic color when Annotations are ON. */
export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: AnnoTone;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const Icon = CALLOUT_ICON[tone];
  return (
    <div className={`callout ${tone}`}>
      <div className="callout-ic">
        <Icon />
      </div>
      <div style={{ minWidth: 0 }}>
        {title ? <div className="callout-title">{title}</div> : null}
        {children ? <div className="callout-body">{children}</div> : null}
      </div>
    </div>
  );
}

/** Cornell-style quick-reference strip — structural, always visible. */
export function QuickRef({ label = "Quick reference", children }: { label?: string; children: ReactNode }) {
  return (
    <div className="quick-ref">
      <div className="quick-ref-label">{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface RichOptions {
  clients?: { id: string; name: string }[];
  clientId?: string;
}

type Rule =
  | { kind: "link"; pattern: string; href: string }
  | { kind: "hl"; pattern: string; tone: AnnoTone };

// Semantic auto-highlight rules — numbers/dates are "important" facts; status words carry sentiment.
const HL_RULES: { pattern: string; tone: AnnoTone }[] = [
  { pattern: "\\$\\d[\\d,]*(?:\\.\\d+)?\\s?(?:[KkMm]|thousand|million|billion)?", tone: "important" }, // money
  { pattern: "\\b\\d+(?:\\.\\d+)?%", tone: "important" }, // percentages
  { pattern: "#\\d+\\b", tone: "important" }, // #position
  { pattern: "\\b(?:position|rank(?:ing)?|spot)\\s+#?\\d+", tone: "important" },
  {
    pattern: "\\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?\\s+\\d{1,2}(?:,?\\s*\\d{4})?\\b",
    tone: "important",
  }, // Aug 30, 2026
  { pattern: "\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b", tone: "important" },
  { pattern: "\\b\\d+\\s+days?\\b", tone: "important" },
  {
    pattern:
      "\\b(declin(?:e|ed|ing)|decreas(?:e|ed|ing)|drop(?:ped|ping)?|fell|falling|lost|losing|missed|missing|overdue|unresolved|delayed?|stalled|paused|fail(?:ed|ing)?|blocked|at[\\s-]risk|churn(?:ing|ed)?)\\b",
    tone: "critical",
  },
  {
    pattern:
      "\\b(improv(?:e|ed|ing)|increas(?:e|ed|ing)|grew|grow(?:ing|th)|gain(?:ed|ing|s)?|complet(?:e|ed)|resolv(?:e|ed)|approv(?:e|ed)|publish(?:ed)?|launch(?:ed)?|won|healthy|on[\\s-]track|ahead)\\b",
    tone: "positive",
  },
  { pattern: "\\b(deadline|due|awaiting|pending|upcoming|remember|scheduled)\\b", tone: "important" },
  {
    pattern: "\\b(recommend(?:ation|ed|s)?|opportunit(?:y|ies)|next step|strateg(?:y|ic)|suggest(?:ed|ion)?|consider)\\b",
    tone: "info",
  },
];

function buildRules(options: RichOptions): Rule[] {
  const { clients = [], clientId } = options;
  const rules: Rule[] = [];

  [...clients]
    .filter((c) => c.name && c.name.length > 2)
    .forEach((c) => rules.push({ kind: "link", pattern: escapeRegExp(c.name), href: `/clients/${c.id}` }));

  const keyword: [string[], string][] = [];
  if (clientId) {
    keyword.push([["Google Business Profile", "GBP"], `/clients/${clientId}?tab=performance`]);
    keyword.push([["Google Ads", "Local Services Ads", "LSA"], `/clients/${clientId}?tab=performance`]);
    keyword.push([
      ["share of local voice", "share of voice", "map pack", "map-pack", "rankings", "ranking", "visibility", "SEO", "top-3", "scorecard", "website"],
      `/clients/${clientId}?tab=performance`,
    ]);
    keyword.push([["missed calls", "lead quality", "leads", "call quality"], `/clients/${clientId}?tab=leads`]);
    keyword.push([["commitments", "commitment", "promises"], `/clients/${clientId}?tab=promises`]);
    keyword.push([["opportunities", "opportunity", "upsell", "expansion"], `/clients/${clientId}?tab=intelligence`]);
  } else {
    keyword.push([["opportunities", "opportunity"], `/opportunities`]);
    keyword.push([["commitments", "promises"], `/commitments`]);
    keyword.push([["Call Intelligence"], `/calls`]);
  }
  keyword.forEach(([terms, href]) => terms.forEach((t) => rules.push({ kind: "link", pattern: escapeRegExp(t), href })));

  HL_RULES.forEach((r) => rules.push({ kind: "hl", pattern: r.pattern, tone: r.tone }));
  return rules;
}

interface FoundMatch {
  start: number;
  end: number;
  text: string;
  rule: Rule;
}

/**
 * Render a string with contextual internal links AND semantic highlights.
 * Links win over highlights on overlap; each linked term is linked once.
 */
export function renderRich(text: string, options: RichOptions = {}): ReactNode {
  if (!text) return text;
  const rules = buildRules(options);
  const found: FoundMatch[] = [];

  rules.forEach((rule) => {
    const flags = rule.kind === "link" ? "gi" : rule.pattern.includes("[a-z]") ? "g" : "gi";
    const wrapped = rule.kind === "link" ? `\\b(?:${rule.pattern})\\b` : rule.pattern;
    let re: RegExp;
    try {
      re = new RegExp(wrapped, flags);
    } catch {
      return;
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      found.push({ start: m.index, end: m.index + m[0].length, text: m[0], rule });
    }
  });

  if (!found.length) return text;

  // Links first, then longer spans, so the strongest match wins at a given spot.
  found.sort(
    (a, b) =>
      a.start - b.start ||
      (a.rule.kind === b.rule.kind ? 0 : a.rule.kind === "link" ? -1 : 1) ||
      b.end - b.start - (a.end - a.start),
  );

  const chosen: FoundMatch[] = [];
  const linkedTerms = new Set<string>();
  let lastEnd = 0;
  for (const mt of found) {
    if (mt.start < lastEnd) continue; // overlaps a chosen match
    if (mt.rule.kind === "link") {
      const key = mt.text.toLowerCase();
      if (linkedTerms.has(key)) continue; // link each term only once
      linkedTerms.add(key);
    }
    chosen.push(mt);
    lastEnd = mt.end;
  }

  const out: ReactNode[] = [];
  let idx = 0;
  let key = 0;
  for (const mt of chosen) {
    if (mt.start > idx) out.push(text.slice(idx, mt.start));
    if (mt.rule.kind === "link") {
      out.push(
        <Link key={key++} href={mt.rule.href} className="ilink">
          {mt.text}
        </Link>,
      );
    } else {
      out.push(
        <span key={key++} className={`hl ${mt.rule.tone}`}>
          {mt.text}
        </span>,
      );
    }
    idx = mt.end;
  }
  if (idx < text.length) out.push(text.slice(idx));
  return <>{out}</>;
}

/** Inline: a short string rendered with links + highlights (no paragraph splitting). */
export function Linkified({
  text,
  clients,
  clientId,
}: {
  text: string;
  clients?: { id: string; name: string }[];
  clientId?: string;
}) {
  return <>{renderRich(text, { clients, clientId })}</>;
}

/** Split a blob of prose into readable paragraphs even when it has no blank lines. */
function splitParagraphs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (/\n\s*\n/.test(trimmed)) return trimmed.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (/\n/.test(trimmed)) return trimmed.split(/\n+/).map((s) => s.trim()).filter(Boolean);

  const sentences = trimmed.match(/[^.!?]+[.!?]+(?:["')\]]+)?\s*|[^.!?]+$/g);
  if (!sentences || sentences.length <= 2) return [trimmed];

  const paras: string[] = [];
  let buf: string[] = [];
  for (const s of sentences) {
    buf.push(s.trim());
    const joined = buf.join(" ");
    if ((buf.length >= 2 && joined.length > 200) || buf.length >= 3) {
      paras.push(joined);
      buf = [];
    }
  }
  if (buf.length) paras.push(buf.join(" "));
  return paras;
}

/**
 * Block-level smart formatter for longer content: breaks a wall of text into
 * paragraphs, then applies links + highlights to each. Use for briefs, notes,
 * summaries, and any multi-sentence field.
 */
export function SmartText({
  text,
  clients,
  clientId,
}: {
  text: string;
  clients?: { id: string; name: string }[];
  clientId?: string;
}) {
  const paras = splitParagraphs(text);
  if (!paras.length) return null;
  return (
    <div className="smart-text">
      {paras.map((p, i) => (
        <p key={i}>{renderRich(p, { clients, clientId })}</p>
      ))}
    </div>
  );
}

/** Inline `**bold**` / `__bold__`, applied around the link + highlight pass. */
function renderInlineMarkdown(text: string, options: RichOptions): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g).filter((part) => part !== "");
  if (parts.length === 1) return renderRich(text, options);
  return (
    <>
      {parts.map((part, index) => {
        const bold = /^(\*\*[^*]+\*\*|__[^_]+__)$/.test(part);
        const inner = bold ? part.slice(2, -2) : part;
        return bold ? (
          <strong key={index} style={{ color: "var(--text)", fontWeight: 650 }}>
            {renderRich(inner, options)}
          </strong>
        ) : (
          <span key={index}>{renderRich(inner, options)}</span>
        );
      })}
    </>
  );
}

type MdBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

/**
 * Group markdown lines into blocks. Deliberately a small subset -- headings,
 * bullets, numbered lists, paragraphs -- because that is all the AI briefs emit,
 * and a full markdown dependency would pull its own sanitising and styling
 * concerns into a surface that already has its own annotation layer.
 */
function parseMarkdownBlocks(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = () => {
    if (list) blocks.push({ kind: "list", ...list });
    list = null;
  };

  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1].trim());
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1].trim());
      continue;
    }

    // A plain line that continues the previous paragraph rather than starting one,
    // so a brief wrapped at 100 columns doesn't render as a stack of fragments.
    const previous = blocks[blocks.length - 1];
    if (!list && previous?.kind === "para") {
      previous.text = `${previous.text} ${line}`;
      continue;
    }
    flushList();
    blocks.push({ kind: "para", text: line });
  }

  flushList();
  return blocks;
}

/**
 * Block formatter for AI-written long-form content that may contain markdown.
 * Renders headings, bullets, numbered lists and bold, and keeps the client-linking
 * and highlight pass that `SmartText` applies, so a brief reads as a document
 * instead of showing `##` and `**` literally. Content with no markdown in it falls
 * through to `SmartText`, preserving the old paragraph-splitting behaviour for
 * briefs written as plain prose.
 */
export function SmartMarkdown({
  text,
  clients,
  clientId,
}: {
  text: string;
  clients?: { id: string; name: string }[];
  clientId?: string;
}) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  const options: RichOptions = { clients, clientId };
  const hasMarkdown = /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s)|\*\*[^*]+\*\*|__[^_]+__/.test(trimmed);
  if (!hasMarkdown) {
    return <SmartText text={trimmed} clients={clients} clientId={clientId} />;
  }

  const blocks = parseMarkdownBlocks(trimmed);

  return (
    <div className="smart-text smart-md">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          // h1/h2 in a brief are section labels, not page titles -- cap the visual
          // weight so they sit inside the card rather than competing with it.
          const level = Math.min(Math.max(block.level, 1), 6);
          return (
            <div
              key={index}
              className="smart-md-h"
              style={{
                fontSize: level <= 2 ? "0.92rem" : "0.86rem",
                fontWeight: 700,
                color: "var(--text)",
                marginTop: index === 0 ? 0 : 14,
                marginBottom: 4,
                letterSpacing: level <= 2 ? "0.01em" : undefined,
              }}
            >
              {renderInlineMarkdown(block.text, options)}
            </div>
          );
        }

        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={index}
              style={{
                margin: "6px 0 0",
                paddingLeft: 18,
                listStyleType: block.ordered ? "decimal" : "disc",
              }}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} style={{ fontSize: "0.89rem", lineHeight: 1.62, color: "var(--text-2)" }}>
                  {renderInlineMarkdown(item, options)}
                </li>
              ))}
            </ListTag>
          );
        }

        return <p key={index}>{renderInlineMarkdown(block.text, options)}</p>;
      })}
    </div>
  );
}
