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

interface LinkifyOptions {
  clients?: { id: string; name: string }[];
  clientId?: string;
}

interface Rule {
  pattern: string;
  href: string;
}

/**
 * Turn known entities inside a plain string into contextual internal links:
 * client names → their profile; domain keywords → the most specific relevant tab
 * / section. Only the first occurrence of each term is linked to avoid clutter.
 */
export function linkify(text: string, options: LinkifyOptions = {}): ReactNode {
  const { clients = [], clientId } = options;
  const rules: Rule[] = [];

  [...clients]
    .filter((c) => c.name && c.name.length > 2)
    .forEach((c) => rules.push({ pattern: escapeRegExp(c.name), href: `/clients/${c.id}` }));

  const keyword: [string[], string][] = [];
  if (clientId) {
    keyword.push([["Google Business Profile", "GBP"], `/clients/${clientId}?tab=performance`]);
    keyword.push([["Google Ads"], `/clients/${clientId}?tab=performance`]);
    keyword.push([
      ["share of local voice", "share of voice", "map pack", "map-pack", "rankings", "ranking", "visibility", "SEO", "top-3", "scorecard", "performance"],
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
  keyword.forEach(([terms, href]) => terms.forEach((t) => rules.push({ pattern: escapeRegExp(t), href })));

  if (!rules.length) return text;

  const sorted = rules.sort((a, b) => b.pattern.length - a.pattern.length);
  const regex = new RegExp(`\\b(${sorted.map((r) => r.pattern).join("|")})\\b`, "gi");

  const out: ReactNode[] = [];
  const seen = new Set<string>();
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const matched = match[0];
    const lower = matched.toLowerCase();
    if (match.index > lastIndex) out.push(text.slice(lastIndex, match.index));
    if (seen.has(lower)) {
      out.push(matched);
    } else {
      seen.add(lower);
      const rule = sorted.find((r) => new RegExp(`^${r.pattern}$`, "i").test(matched));
      out.push(
        <Link key={key++} href={rule ? rule.href : "#"} className="ilink">
          {matched}
        </Link>,
      );
    }
    lastIndex = match.index + matched.length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return <>{out}</>;
}

/** Convenience wrapper: renders a string with internal links applied. */
export function Linkified({
  text,
  clients,
  clientId,
}: {
  text: string;
  clients?: { id: string; name: string }[];
  clientId?: string;
}) {
  return <>{linkify(text, { clients, clientId })}</>;
}
