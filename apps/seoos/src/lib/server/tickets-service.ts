import type { AuthzContextV1 } from "@cie/contracts";

import { CATEGORY_PROMPT, TicketCategory, TicketV1 } from "@/src/lib/domain/ticket";
import type { SeoProjectV1 } from "@/src/lib/domain/project";
import { newId, nowIso } from "@/src/lib/ids";
import { getTicketRepo } from "@/src/lib/server/repositories/ticket-repo";
import { getIntegrationCredentials } from "@/src/lib/server/integrations-service";
import {
  effectiveSpecialistId,
  getProject,
  listProjects,
  listProjectsForViewer,
} from "@/src/lib/server/projects-service";
import {
  listSpecialists,
  matchSpecialistId,
  resolveViewerSpecialistId,
} from "@/src/lib/server/specialists-service";
import { addCorrectionRule } from "@/src/lib/server/specialist-style-service";
import { composeAiSystem } from "@/src/lib/server/prompts-service";
import { AiNotConfiguredError, extractJson, generateText } from "@/src/lib/server/ai/llm";
import { hasAiConfig } from "@/src/lib/server/env";
import { fetchClickUpTickets, type RawTicket } from "@/src/lib/server/sync/clickup-tickets";

/** How many brand-new tickets to auto-draft per sync run (rest draft on demand). */
const AUTO_DRAFT_CAP = 12;

export interface SyncTicketsResult {
  ok: boolean;
  error?: string;
  fetched: number;
  created: number;
  updated: number;
  drafted: number;
}

/** Infer the ticket category (→ prompt) from its title/body. Facts only, no guessing of intent. */
function inferCategory(title: string, body: string): TicketCategory {
  const t = `${title} ${body}`.toLowerCase();
  if (/\breview(s)?\b/.test(t)) return "review_response";
  if (/\b(gbp|google business)\b/.test(t) && /\b(audit|optimi[sz])/.test(t)) return "gbp_audit";
  if (/\bpost(s)?\b/.test(t) && /\b(gbp|google|profile)\b/.test(t)) return "gbp_post";
  if (/\bkeyword(s)?\b/.test(t)) return "keywords";
  if (/\b(blog|article|content|home\s?page|service page|city page|about us)\b/.test(t)) return "content";
  if (/\breport\b/.test(t)) return "report";
  return "general";
}

const normName = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Link a ticket to a known client. Tickets are always created with a Business
 * Name field, so that is the primary key: exact normalized match first, then a
 * contains match. Falls back to the ClickUp parent task, then a name mention.
 */
function resolveProject(raw: RawTicket, projects: SeoProjectV1[]): SeoProjectV1 | undefined {
  // 1) The ticket's Business Name field → the client (primary, most reliable).
  if (raw.businessName) {
    const target = normName(raw.businessName);
    if (target) {
      const exact = projects.find((p) => normName(p.businessName) === target);
      if (exact) return exact;
      // Contains either way (handles "StoneBase Masonry" vs "StoneBase Masonry - Boston").
      let best: SeoProjectV1 | undefined;
      for (const p of projects) {
        const name = normName(p.businessName);
        if (name.length >= 4 && (name.includes(target) || target.includes(name))) {
          if (!best || p.businessName.length > best.businessName.length) best = p;
        }
      }
      if (best) return best;
    }
  }

  // 2) ClickUp parent task id maps to a client roster task.
  if (raw.parentId) {
    const byParent = projects.find((p) => p.externalIds?.clickupTaskId === raw.parentId);
    if (byParent) return byParent;
  }

  // 3) Last resort: the client name appears in the ticket title/body.
  const hay = normName(`${raw.title} ${raw.body}`);
  let best: SeoProjectV1 | undefined;
  for (const p of projects) {
    const name = normName(p.businessName);
    if (name.length >= 4 && hay.includes(name)) {
      if (!best || p.businessName.length > best.businessName.length) best = p;
    }
  }
  return best;
}

/**
 * Ingest tickets from ClickUp (read-only), route each to the account's specialist,
 * and (optionally) auto-draft brand-new ones. Never writes back to ClickUp.
 */
export async function syncTickets(
  tenantId: string,
  opts: { autoDraft?: boolean } = {},
): Promise<SyncTicketsResult> {
  const base: SyncTicketsResult = { ok: false, fetched: 0, created: 0, updated: 0, drafted: 0 };

  const creds = await getIntegrationCredentials(tenantId, "clickup");
  if (!creds?.apiToken) {
    return { ...base, error: "ClickUp credentials are missing. Reconnect ClickUp under Integrations." };
  }
  const listIds = creds.ticketsListId || process.env.CLICKUP_TICKETS_LIST_ID || "";
  const fetched = await fetchClickUpTickets({ token: creds.apiToken, listIds });
  if (!fetched.ok) return { ...base, error: fetched.error };

  const [projects, specialists] = await Promise.all([
    listProjects(tenantId),
    listSpecialists(tenantId),
  ]);

  let created = 0;
  let updated = 0;
  const toDraft: string[] = [];

  for (const raw of fetched.tickets) {
    const project = resolveProject(raw, projects);
    // The account's specialist owns the ticket; fall back to the ClickUp assignee.
    const specialistId =
      (project ? effectiveSpecialistId(project, specialists) : undefined) ??
      matchSpecialistId(raw.assigneeRaw, specialists) ??
      matchSpecialistId(raw.assigneeEmail?.split("@")[0], specialists);

    const existing = await getTicketRepo().getByExternalId(tenantId, raw.externalId);
    const now = nowIso();

    if (existing) {
      // Refresh mutable fields but PRESERVE any draft/decision already made.
      const next: TicketV1 = {
        ...existing,
        title: raw.title,
        body: raw.body,
        url: raw.url ?? existing.url,
        clickupStatus: raw.clickupStatus ?? existing.clickupStatus,
        dueDate: raw.dueDate ?? existing.dueDate,
        projectId: project?.id ?? existing.projectId,
        clientId: project?.clientId ?? existing.clientId,
        clientName: project?.businessName ?? raw.businessName ?? existing.clientName,
        specialistId: specialistId ?? existing.specialistId,
        assigneeRaw: raw.assigneeRaw ?? existing.assigneeRaw,
        updatedAt: now,
      };
      await getTicketRepo().save(TicketV1.parse(next));
      updated += 1;
      if (next.status === "new") toDraft.push(next.id);
      continue;
    }

    const ticket = TicketV1.parse({
      schemaVersion: 1,
      id: newId("tkt"),
      tenantId,
      source: "clickup",
      externalId: raw.externalId,
      url: raw.url,
      title: raw.title,
      body: raw.body,
      category: inferCategory(raw.title, raw.body),
      projectId: project?.id,
      clientId: project?.clientId,
      clientName: project?.businessName ?? raw.businessName,
      specialistId,
      assigneeRaw: raw.assigneeRaw,
      clickupStatus: raw.clickupStatus,
      dueDate: raw.dueDate,
      status: "new",
      needsInfo: [],
      ingestedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await getTicketRepo().save(ticket);
    created += 1;
    toDraft.push(ticket.id);
  }

  let drafted = 0;
  if (opts.autoDraft && hasAiConfig()) {
    for (const id of toDraft.slice(0, AUTO_DRAFT_CAP)) {
      const res = await draftTicket(tenantId, id);
      if (res.ok) drafted += 1;
    }
  }

  return { ok: true, error: undefined, fetched: fetched.fetched, created, updated, drafted };
}

function buildAccountContext(project: SeoProjectV1 | null): string {
  if (!project) return "Account: (not linked to a known client — rely only on the ticket text).";
  const lines = [
    `Account / business: ${project.businessName}`,
    project.website ? `Website: ${project.website}` : "",
    project.niche ? `Niche: ${project.niche}` : "",
    project.targetLocations?.length ? `Target locations: ${project.targetLocations.join(", ")}` : "",
    `Stage: ${project.stage}`,
  ];
  const metrics = project.dashboardMetrics ?? {};
  const metricLines = Object.entries(metrics).map(([k, v]) => `- ${k}: ${v}`);
  if (metricLines.length) lines.push("Known metrics:", ...metricLines);
  return lines.filter(Boolean).join("\n");
}

export interface DraftTicketResult {
  ok: boolean;
  error?: string;
}

/**
 * Draft the work a ticket asks for — staged in SEOOS only, never published.
 * Uses the shared AI path (global guardrails + the category's editable prompt +
 * the specialist's style). Missing facts come back as needsInfo, never invented.
 */
export async function draftTicket(tenantId: string, ticketId: string): Promise<DraftTicketResult> {
  const ticket = await getTicketRepo().get(tenantId, ticketId);
  if (!ticket) return { ok: false, error: "Ticket not found" };
  if (!hasAiConfig()) {
    return { ok: false, error: "AI is not configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY on SEOOS)." };
  }

  await getTicketRepo().save(TicketV1.parse({ ...ticket, status: "drafting", updatedAt: nowIso() }));

  const specialists = await listSpecialists(tenantId);
  const specialistName = specialists.find((s) => s.id === ticket.specialistId)?.name;
  const project = ticket.projectId ? await getProject(tenantId, ticket.projectId) : null;
  const promptKey = CATEGORY_PROMPT[ticket.category] ?? "ticket.fulfill";

  const system = await composeAiSystem(tenantId, promptKey, ticket.specialistId, specialistName);
  const user = [
    buildAccountContext(project),
    "",
    "TICKET (the request to fulfill):",
    `Title: ${ticket.title}`,
    ticket.body ? `Details: ${ticket.body}` : "Details: (none provided)",
    "",
    'Draft the deliverable this ticket asks for. Return ONLY the JSON envelope {"summary","draft","needsInfo"} described in your instructions.',
  ].join("\n");

  try {
    const text = await generateText(system, user);
    let summary = "";
    let draft = "";
    let needsInfo: string[] = [];
    try {
      const parsed = extractJson<{ summary?: string; draft?: string; needsInfo?: string[] }>(text);
      summary = (parsed.summary ?? "").trim();
      draft = (parsed.draft ?? "").trim();
      needsInfo = Array.isArray(parsed.needsInfo)
        ? parsed.needsInfo.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
        : [];
    } catch {
      // Model returned prose, not JSON — keep the whole thing as the draft.
      draft = text.trim();
      const flagged = draft.match(/NEEDS INFO:.*/gi);
      if (flagged) needsInfo = flagged.map((s) => s.replace(/^NEEDS INFO:\s*/i, "").trim());
    }

    const status = draft ? "awaiting_approval" : "needs_info";
    await getTicketRepo().save(
      TicketV1.parse({
        ...ticket,
        status,
        draft: draft || undefined,
        detail: summary || undefined,
        needsInfo,
        updatedAt: nowIso(),
      }),
    );
    return { ok: true };
  } catch (e) {
    // Roll back to "new" so it can be retried; surface the reason.
    await getTicketRepo().save(TicketV1.parse({ ...ticket, status: "new", updatedAt: nowIso() }));
    if (e instanceof AiNotConfiguredError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "draft_failed" };
  }
}

/** Tickets a viewer may see: admins → all; a specialist → only their own. */
export async function listTicketsForViewer(authz: AuthzContextV1): Promise<TicketV1[]> {
  const all = await getTicketRepo().listByTenant(authz.tenantId);
  const sorted = all.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
  if (authz.clientVisibility === "all") return sorted;

  const mySpecialistId = await resolveViewerSpecialistId(authz.tenantId, authz.userId);
  const myProjects = await listProjectsForViewer(authz);
  const myProjectIds = new Set(myProjects.map((p) => p.id));
  return sorted.filter(
    (t) =>
      (mySpecialistId && t.specialistId === mySpecialistId) ||
      (t.projectId ? myProjectIds.has(t.projectId) : false),
  );
}

/** Scoped single-ticket fetch (null if the viewer can't see it). */
export async function getTicketForViewer(
  authz: AuthzContextV1,
  ticketId: string,
): Promise<TicketV1 | null> {
  const ticket = await getTicketRepo().get(authz.tenantId, ticketId);
  if (!ticket) return null;
  if (authz.clientVisibility === "all") return ticket;
  const mySpecialistId = await resolveViewerSpecialistId(authz.tenantId, authz.userId);
  if (mySpecialistId && ticket.specialistId === mySpecialistId) return ticket;
  if (ticket.projectId) {
    const myProjects = await listProjectsForViewer(authz);
    if (myProjects.some((p) => p.id === ticket.projectId)) return ticket;
  }
  return null;
}

export type TicketDecision = "approve" | "reject" | "needs_info" | "save";

/**
 * Record a specialist's decision on a ticket. Approve/reject NEVER pushes to
 * ClickUp or any live system — it only records the decision here; acting on it
 * stays a human step. A rejection note feeds the specialist's style learning.
 */
export async function decideTicket(
  tenantId: string,
  ticketId: string,
  input: { action: TicketDecision; note?: string; draft?: string },
  actorUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ticket = await getTicketRepo().get(tenantId, ticketId);
  if (!ticket) return { ok: false, error: "Ticket not found" };
  const now = nowIso();
  const nextDraft = typeof input.draft === "string" ? input.draft : ticket.draft;

  if (input.action === "save") {
    await getTicketRepo().save(TicketV1.parse({ ...ticket, draft: nextDraft, updatedAt: now }));
    return { ok: true };
  }

  const status =
    input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "needs_info";

  await getTicketRepo().save(
    TicketV1.parse({
      ...ticket,
      draft: nextDraft,
      status,
      decidedByUserId: actorUserId,
      decidedAt: now,
      decisionNote: input.note?.trim() || undefined,
      updatedAt: now,
    }),
  );

  // Learn from corrections: a rejection reason refines this specialist's style.
  if (input.action === "reject" && input.note?.trim() && ticket.specialistId) {
    await addCorrectionRule(tenantId, ticket.specialistId, input.note.trim());
  }

  return { ok: true };
}
