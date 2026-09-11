/**
 * Seed each SEO specialist's writing-style profile from their REAL prior work in
 * ClickUp — the comments/updates they authored on their client tasks and tickets
 * — so AI drafts match how each person actually writes from the very first run,
 * instead of only learning slowly from later corrections.
 *
 * READ-ONLY against ClickUp. Attribution is by comment AUTHOR (matched to the
 * roster), never by task assignment, so we only learn from words a specialist
 * actually wrote. Profiles are seeded only when empty, so a specialist's learned
 * corrections are never overwritten.
 */
import type { SpecialistStyleV1 } from "@/src/lib/domain/specialist-style";
import { nowIso } from "@/src/lib/ids";
import { getIntegrationCredentials } from "@/src/lib/server/integrations-service";
import { listProjects } from "@/src/lib/server/projects-service";
import { listSpecialists, matchSpecialistId } from "@/src/lib/server/specialists-service";
import { getStyle, upsertStyle } from "@/src/lib/server/specialist-style-service";
import { fetchTaskComments } from "@/src/lib/server/sync/clickup-comments";
import {
  DEFAULT_TICKETS_LIST_ID,
  resolveTicketListIds,
} from "@/src/lib/server/tickets-service";
import { fetchClickUpTickets } from "@/src/lib/server/sync/clickup-tickets";
import { AiNotConfiguredError, extractJson, generateText } from "@/src/lib/server/ai/llm";
import { hasAiConfig } from "@/src/lib/server/env";

/** Safety caps so an admin one-shot never runs away or trips ClickUp rate limits. */
const MAX_TASKS = 300;
const MAX_COMMENTS_PER_SPECIALIST = 40;
const MAX_CHARS_PER_SPECIALIST = 16000;
const MIN_COMMENTS_TO_SEED = 3;
const MIN_CHARS_TO_SEED = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SeedStylesResult {
  ok: boolean;
  error?: string;
  scannedTasks: number;
  perSpecialist: Array<{
    specialistId: string;
    name: string;
    samples: number;
    seeded: boolean;
    note?: string;
  }>;
}

type StyleAnalysis = { summary: string; rules: SpecialistStyleV1["rules"] };

/** Ask the LLM to describe HOW this specialist writes (style only — no facts). */
async function analyzeStyle(name: string, samples: string): Promise<StyleAnalysis> {
  const system = [
    "You are a writing-style analyst. You are given real work notes and comments written by ONE person",
    "(an SEO specialist) on their own tasks. Infer HOW THIS PERSON WRITES so another writer could imitate",
    "them convincingly. Describe ONLY what the samples actually show — never invent a trait you cannot see.",
    "",
    'Return ONLY JSON: {"summary": string, "rules": string[]}.',
    "- summary: 2 to 4 sentences capturing their voice, tone, structure, formatting habits, and level of formality.",
    "- rules: 6 to 14 short, concrete, imitable style rules — e.g. typical sentence length, how they open/close,",
    "  emoji use, bullets vs prose, formality, jargon, punctuation quirks, capitalization. One line each, actionable.",
    "Do NOT include any of the sample content, client names, numbers, or other facts — style only.",
    "If the samples are too thin to judge a trait, leave it out rather than guessing.",
  ].join("\n");
  const user = `Specialist: ${name}\n\nTheir own writing samples (comments they authored, separated by ---):\n\n${samples}`;

  const text = await generateText(system, user);
  const parsed = extractJson<{ summary?: string; rules?: string[] }>(text);
  const now = nowIso();
  const rules = (Array.isArray(parsed.rules) ? parsed.rules : [])
    .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    .slice(0, 20)
    .map((r) => ({ text: r.trim(), source: "observed" as const, at: now }));
  return { summary: (parsed.summary ?? "").trim(), rules };
}

/**
 * Seed style profiles for the roster from their authored ClickUp comments.
 * @param opts.onlyEmpty (default true) skip specialists who already have a profile.
 * @param opts.specialistId limit to one specialist.
 */
export async function seedSpecialistStyles(
  tenantId: string,
  opts: { onlyEmpty?: boolean; specialistId?: string } = {},
): Promise<SeedStylesResult> {
  const onlyEmpty = opts.onlyEmpty ?? true;
  const base: SeedStylesResult = { ok: false, scannedTasks: 0, perSpecialist: [] };

  if (!hasAiConfig()) {
    return { ...base, error: "AI is not configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY on SEOOS)." };
  }
  const creds = await getIntegrationCredentials(tenantId, "clickup");
  if (!creds?.apiToken) {
    return { ...base, error: "ClickUp credentials are missing. Reconnect ClickUp under Integrations." };
  }
  const token = creds.apiToken;

  const [projects, specialists] = await Promise.all([
    listProjects(tenantId),
    listSpecialists(tenantId),
  ]);

  // Candidate tasks that carry specialist prose: client (SEO Dashboard) tasks + tickets.
  const taskIds = new Set<string>();
  for (const p of projects) {
    const id = p.externalIds?.clickupTaskId;
    if (id) taskIds.add(id);
  }
  try {
    const listIds =
      resolveTicketListIds(creds.ticketsListId || process.env.CLICKUP_TICKETS_LIST_ID || "") ||
      DEFAULT_TICKETS_LIST_ID;
    const tk = await fetchClickUpTickets({ token, listIds, includeClosed: true });
    if (tk.ok) for (const t of tk.tickets) taskIds.add(t.externalId);
  } catch {
    // Tickets are a bonus source; client-task comments alone are enough to try.
  }

  const ids = Array.from(taskIds).slice(0, MAX_TASKS);

  // Gather each specialist's own comment text, grouped by comment author.
  const samples = new Map<string, string[]>();
  let scanned = 0;
  for (const id of ids) {
    const comments = await fetchTaskComments(token, id);
    scanned += 1;
    for (const c of comments) {
      let sid = matchSpecialistId(c.authorName, specialists);
      if (!sid && c.authorEmail) sid = matchSpecialistId(c.authorEmail.split("@")[0], specialists);
      if (!sid) continue;
      const arr = samples.get(sid) ?? [];
      if (arr.length >= MAX_COMMENTS_PER_SPECIALIST) continue;
      arr.push(c.text);
      samples.set(sid, arr);
    }
    // Gentle throttle to stay under ClickUp's rate limit on a big roster.
    if (scanned % 8 === 0) await sleep(350);
  }

  const perSpecialist: SeedStylesResult["perSpecialist"] = [];
  for (const s of specialists) {
    if (opts.specialistId && s.id !== opts.specialistId) continue;
    const texts = samples.get(s.id) ?? [];
    const joined = texts.join("\n---\n").slice(0, MAX_CHARS_PER_SPECIALIST);

    if (texts.length < MIN_COMMENTS_TO_SEED || joined.trim().length < MIN_CHARS_TO_SEED) {
      perSpecialist.push({ specialistId: s.id, name: s.name, samples: texts.length, seeded: false, note: "not enough authored comments found" });
      continue;
    }
    const existing = await getStyle(tenantId, s.id);
    if (onlyEmpty && existing && (existing.summary || existing.rules.length > 0)) {
      perSpecialist.push({ specialistId: s.id, name: s.name, samples: texts.length, seeded: false, note: "profile already exists (use force to reseed)" });
      continue;
    }
    try {
      const analysis = await analyzeStyle(s.name, joined);
      if (!analysis.summary && analysis.rules.length === 0) {
        perSpecialist.push({ specialistId: s.id, name: s.name, samples: texts.length, seeded: false, note: "analysis produced no usable style" });
        continue;
      }
      // Replace the OBSERVED rules but always keep any learned corrections, so a
      // reseed never erases what a specialist taught the AI by rejecting drafts.
      const preservedCorrections = (existing?.rules ?? []).filter((r) => r.source === "correction");
      await upsertStyle(tenantId, s.id, {
        summary: analysis.summary,
        rules: [...analysis.rules, ...preservedCorrections],
      });
      perSpecialist.push({ specialistId: s.id, name: s.name, samples: texts.length, seeded: true });
    } catch (e) {
      if (e instanceof AiNotConfiguredError) return { ...base, scannedTasks: scanned, perSpecialist, error: e.message };
      perSpecialist.push({ specialistId: s.id, name: s.name, samples: texts.length, seeded: false, note: e instanceof Error ? e.message : "analysis failed" });
    }
  }

  return { ok: true, scannedTasks: scanned, perSpecialist };
}
