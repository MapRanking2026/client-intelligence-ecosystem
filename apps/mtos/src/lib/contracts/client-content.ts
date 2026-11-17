import { htmlToMarkdown, markdownToPlainText } from "@/src/lib/contracts/rich-text";
import type { CallGuide, MonthlyTouchRecord, Presentation, PresentationSlide } from "@/src/lib/mtos-data";

export const CLIENT_CONTENT_RULE = "CLIENT VISIBILITY RULE: Open, pending, proposed, overdue, in-progress, blocked, unverified and future tasks/tickets/commitments are INTERNAL ONLY, including client-side tasks. Do not mention them in slides, guides, scripts, agendas, email, tables, headings or presenter notes. Work-delivery summaries may contain only tasks explicitly verified completed. Approval is not completion. Keep factual performance results, including declines, accurate. Never relabel unfinished work as completed.";

export function completedStatus(status: unknown): boolean {
  return typeof status === "string" && /^(completed?|done|finished|delivered|shipped)$/i.test(status.trim());
}

/** Validate rendered content by paragraph/list/table row, never CSS, links or HTML comments. */
export function clientContentViolations(text: string, blockedTitles: string[] = [], clientName?: string): { text: string; reason: string }[] {
  const visible = /<\/?[a-z][^>]*>/i.test(text)
    ? htmlToMarkdown(text.replace(/<!--[\s\S]*?-->/g, "").replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/&#x([0-9a-f]+);/gi, (_, code) => {
        const point = parseInt(code, 16); return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
      })) : text;
  const blocks = visible.split(/\n+/).map((line) => markdownToPlainText(line).replace(/\s+/g, " ").trim()).filter(Boolean);
  const specificTitles = blockedTitles.map((title) => title.trim()).filter((title) => {
    const words = title.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const meaningful = words.filter((word) => !/^(the|a|an|and|or|for|of|to|with|client|monthly|touch|meeting|call|agenda|report|update|review|google|ads|seo|photos|offer|preparation)$/i.test(word));
    return title.length >= 8 && words.length >= 2 && meaningful.length > 0;
  });
  return blocks.flatMap((plain) => {
    const task = /\b(?:tasks?|tickets?|commitments?|backlog|deliverables?|action items?)\b/i.test(plain);
    const unfinished = /\b(?:pending|overdue|in[ -]progress|not[ -]started|awaiting|start me|to[ -]do|todo|unfinished|incomplete)\b|still open|not (?:yet )?(?:done|completed|delivered|shipped)/i.test(plain);
    const internal = /internal[ -]only|internal preparation|team only|do not (?:show|share|present)/i.test(plain);
    const delivery = /\b(?:we|I) (?:owe|need to)|\b(?:we|I)(?: will|'ll|’ll)\b.{0,50}\b(?:deliver|complete|fix|refresh|investigate|build|finish|implement|publish|upload)\b/i.test(plain);
    const progress = /\b(?:working on|underway|under review|needs to be (?:done|fixed|completed))\b/i.test(plain) && /\b(?:task|ticket|report|scan|website|page|schema|citation|project|deliverable|fix)\b/i.test(plain);
    const proposal = /\bproposed\b/i.test(plain) && /\b(?:task|ticket|scan|refresh|fix|deliverable|project)\b/i.test(plain);
    const openTask = /\b(?:open|outstanding)\b.{0,45}\b(?:tasks?|tickets?|items?|promises?|commitments?)\b|\b(?:tasks?|tickets?|items?|promises?|commitments?)\b.{0,45}\b(?:open|outstanding)\b/i.test(plain);
    // Account names can also be ClickUp task titles; identity alone is not unfinished work.
    const identity = clientName?.trim().toLowerCase();
    const accountHeading = identity && plain.toLowerCase() === `your check-in agenda, ${identity}`;
    const named = !accountHeading && specificTitles.some((title) => title.toLowerCase() !== identity && plain.toLowerCase().includes(title.toLowerCase()));
    if (internal || unfinished || delivery || progress || proposal || openTask || named || (task && !/\b(?:completed?|delivered|done|finished|shipped)\b/i.test(plain))) {
      return [{ text: plain.slice(0, 180), reason: named ? "Named unfinished work" : "Unfinished task details" }];
    }
    return [];
  });
}

export function internalTaskText(text: string, blockedTitles: string[] = []): boolean {
  return clientContentViolations(text, blockedTitles).length > 0;
}

export function blockedTaskTitles(touch: MonthlyTouchRecord): string[] {
  return [...(touch.prepPack?.openCommitments || []).filter((item) => !completedStatus(item.status)).map((item) => item.title),
    ...(touch.prepBrief?.promises || []).filter((item) => item.status !== "delivered").map((item) => item.what),
    ...(touch.followThrough?.items || []).map((item) => item.formType === "billing" ? item.details : item.taskName),
    ...(touch.followThrough?.notes?.clientActions || []).map((item) => item.what)];
}

export function clientText(text: string | undefined, blocked: string[] = []): string {
  return (text || "").split(/\n|(?<=[.!?])\s+(?=[A-Z])/).filter((line) => !internalTaskText(line, blocked)).join("\n").trim();
}

function publicEvidence(value: unknown, blocked: string[]): unknown {
  if (typeof value === "string") return internalTaskText(value, blocked) ? undefined : value;
  if (Array.isArray(value)) return value.map((entry) => publicEvidence(entry, blocked)).filter((entry) => entry !== undefined);
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  if ((row.taskName || (row.title && (row.dueDate || row.category))) && !completedStatus(row.status)) return undefined;
  return Object.fromEntries(Object.entries(row).filter(([key]) => !/^(notes|recentChat|clientsBook|clickupContext|nextSteps|nextStep|openCommitments|issuesAndSolutions|clientParticipation|strategicAction|focusAreas|keyFacts|pins)$/i.test(key)).map(([key, entry]) => [key, publicEvidence(entry, blocked)]).filter(([, entry]) => entry !== undefined));
}

export function clientSlides(slides: PresentationSlide[] | undefined, blocked: string[] = []): PresentationSlide[] {
  return (slides || []).flatMap((slide, originalIndex) => {
    if (slide.sectionId === "7") return [];
    const safe = (text: string) => !internalTaskText(text, blocked);
    const items = slide.items?.filter((item) => (!item.status || completedStatus(item.status)) && safe(item.label) && (slide.layout !== "status_list" || completedStatus(item.status))).map((item) => ({ ...item, detail: clientText(item.detail, blocked) }));
    const taskTable = slide.table && slide.table.headers.some((header) => /tasks?|tickets?|commitments?|status/i.test(header));
    const statusIndex = slide.table?.headers.findIndex((header) => /status/i.test(header)) ?? -1;
    const table = slide.table ? { ...slide.table, rows: slide.table.rows.filter((row) => row.every(safe) && (!taskTable || (statusIndex >= 0 && completedStatus(row[statusIndex])))) } : undefined;
    const bullets = slide.bullets?.filter(safe);
    const columns = slide.columns?.filter((column) => safe(column.heading)).map((column) => ({ ...column, items: column.items.filter(safe) })).filter((column) => column.items.length);
    if (slide.layout === "status_list" && !items?.length) return [];
    if (slide.layout === "table" && !table?.rows.length) return [];
    if ((slide.bullets?.length || slide.columns?.length) && !bullets?.length && !columns?.length && !items?.length && !table?.rows.length && !slide.stats?.length) return [];
    if (!safe(slide.title) && !items?.length) return [];
    return [{ ...slide, generatedIndex: slide.generatedIndex ?? originalIndex, title: safe(slide.title) ? slide.title : "Completed work", subtitle: clientText(slide.subtitle, blocked),
      ...(items ? { items } : {}), ...(table ? { table } : {}), ...(bullets ? { bullets } : {}), ...(columns ? { columns } : {}),
      stats: slide.stats?.filter((stat) => safe(`${stat.value} ${stat.caption}`)), footnote: clientText(slide.footnote, blocked), presenterNotes: clientText(slide.presenterNotes, blocked) }];
  });
}

export function clientPresentation(presentation: Presentation | undefined, touch?: MonthlyTouchRecord): Presentation | undefined {
  if (!presentation) return undefined;
  const blocked = touch ? blockedTaskTitles(touch) : [];
  return { ...presentation, title: clientText(presentation.title, blocked), slides: clientSlides(presentation.slides, blocked) };
}

export function clientCallGuide(guide: CallGuide | undefined, touch?: MonthlyTouchRecord): CallGuide | undefined {
  if (!guide) return undefined;
  const blocked = touch ? blockedTaskTitles(touch) : [];
  const safe = (text: string) => !internalTaskText(text, blocked);
  return { ...guide, sections: guide.sections.map((section, originalIndex) => ({ ...section, generatedIndex: section.generatedIndex ?? originalIndex })).filter((section) => section.sectionId !== "7" && safe(section.title)).map((section) => ({ ...section,
    talkingPoints: section.talkingPoints.filter(safe), clientPrompts: section.clientPrompts.filter(safe), goal: clientText(section.goal, blocked),
    say: clientText(section.say, blocked), next: clientText(section.next, blocked), points: section.points?.filter((point) => safe(point.text)),
    ifSays: section.ifSays?.filter((row) => safe(`${row.says} ${row.response}`)),
  })).filter((section) => section.talkingPoints.length || section.points?.length || section.say),
    anticipatedObjections: guide.anticipatedObjections?.filter((row) => safe(JSON.stringify(row))), valueTranslations: guide.valueTranslations?.filter((row) => safe(JSON.stringify(row))) };
}

/** Allowlisted evidence: never give client-output generators raw internal prep, chat or backlog. */
export function clientEvidence(touch: MonthlyTouchRecord) {
  const prep = touch.prepPack;
  const blocked = blockedTaskTitles(touch);
  const clean = (items: string[] = []) => items.filter((item) => !internalTaskText(item, blocked));
  return publicEvidence({ declinedSections: touch.review?.declinedSections || [],
    completedWork: (prep?.completedCommitments || []).filter((item) => completedStatus(item.status)),
    deliveredPromises: (touch.prepBrief?.promises || []).filter((item) => item.status === "delivered"),
    agenda: clean(touch.agenda), wins: clean(touch.wins), clientSummary: clientText(prep?.clientSummary, blocked),
    businessScorecard: prep?.businessScorecard, seoPerformance: prep?.seoPerformance,
    adsPerformance: prep?.adsPerformance, leadVerification: touch.leadVerification,
    performanceSections: touch.prepBrief?.sections.filter((section) => ["3", "8", "10", "11"].includes(section.id) && !touch.review?.declinedSections?.includes(section.id)).map((section) => ({ id: section.id, title: section.title, markdown: clientText(touch.review?.sectionEdits?.[section.id] || section.markdown, blocked) })),
  }, blocked);
}
