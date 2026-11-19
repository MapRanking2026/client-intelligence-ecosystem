import type { ClickupClientContext } from "@/src/lib/mtos-data";

/** Only the recap delivery itself is redundant; email-related implementation work is not. */
export function isWorkflowRecapTask(title: string): boolean {
  const text = title.trim().toLowerCase();
  return /^(?:please\s+)?(?:send|email|draft|prepare|write|review|approve|compose|deliver)\b/.test(text)
    && /\b(?:recap|post[- ]?(?:call|meeting|monthly touch)|meeting summary)\b/.test(text)
    && /\b(?:email|e-mail|recap)\b/.test(text)
    && !/\b(?:integrat|automat|template|bug|fix|develop|implement|investigat)/.test(text);
}

/** Suggested effort for small, recognizable actions; unknown scope requires an AM estimate. */
export function suggestedEffortMinutes(title: string): number | undefined {
  if (/\b(send|forward|email)\b.*\b(email|recap|report|link|invite)\b/i.test(title)) return 10;
  if (/\b(reschedule|update|change)\b.*\b(invite|calendar|meeting time)\b/i.test(title)) return 10;
  if (/\b(request|ask for|follow up on|chase)\b.*\b(access|credentials|approval|photos|information)\b/i.test(title)) return 15;
  return undefined;
}

/** A suggestion, not proof of ownership: repeated first-person work in the matched client chat. */
export function suggestChatOwner(context: ClickupClientContext | null | undefined, department: string | undefined, amName: string, now = new Date()): { name: string; source: string } | undefined {
  if (!context?.matched) return;
  const topic = /\bseo\b|search engine|local visibility/i.test(department || "") ? /\b(seo|ranking|keyword|backlink|citation|gbp|google business|optimization)\b/i
    : /\bads\b|advertis|paid search/i.test(department || "") ? /\b(google ads|campaign|ad group|negative keywords|bidding|ppc)\b/i : undefined;
  if (!topic) return;
  const authors = new Map<string, { name: string; dates: Set<string> }>();
  for (const message of context.recentChat) {
    const time = Date.parse(message.date);
    if (!message.authorIsInternal || !message.author.trim() || message.author.toLowerCase() === amName.trim().toLowerCase() || !Number.isFinite(time) || time > now.getTime() || time < now.getTime() - 90 * 86400000) continue;
    if (!topic.test(message.text) || !/\bi\s+(?:have\s+|am\s+|will\s+|just\s+|have just\s+)?(?:updated|optimized|reviewed|completed|checked|working on|handling|managing|manage|handle|review|check|optimize|update)\b/i.test(message.text)) continue;
    const key = message.author.trim().toLowerCase();
    const author = authors.get(key) || { name: message.author.trim(), dates: new Set<string>() };
    author.dates.add(message.date); authors.set(key, author);
  }
  const candidates = [...authors.values()].filter(author => author.dates.size >= 2);
  if (candidates.length !== 1) return;
  return { name: candidates[0].name, source: "Suggested from repeated specialist work reported in this client's ClickUp chat; confirm before posting." };
}
