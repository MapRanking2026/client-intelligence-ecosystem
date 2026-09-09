import type { AuthzContextV1 } from "@cie/contracts";
import { canAccessClient } from "@cie/core";

import { PreparedTaskV1 } from "@/src/lib/domain/prepared-task";
import type { SeoProjectV1 } from "@/src/lib/domain/project";
import { nowIso } from "@/src/lib/ids";
import { getPreparedTaskRepo } from "@/src/lib/server/repositories/prepared-task-repo";
import { getProject } from "@/src/lib/server/projects-service";
import { listSpecialists } from "@/src/lib/server/specialists-service";
import { addCorrectionRule } from "@/src/lib/server/specialist-style-service";
import { composeAiSystem } from "@/src/lib/server/prompts-service";
import { AiNotConfiguredError, extractJson, generateText } from "@/src/lib/server/ai/llm";
import { hasAiConfig } from "@/src/lib/server/env";

/** Account context for the AI, same shape the ticket drafting uses. */
function buildAccountContext(project: SeoProjectV1 | null): string {
  if (!project) return "Account: (client not linked — rely only on the task description).";
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

/** A prepared task the viewer may act on (null if outside their client scope). */
export async function getTaskForViewer(authz: AuthzContextV1, taskId: string): Promise<PreparedTaskV1 | null> {
  const task = await getPreparedTaskRepo().get(authz.tenantId, taskId);
  if (!task) return null;
  if (!canAccessClient(authz.clientVisibility, task.clientId)) return null;
  return task;
}

export interface DraftTaskResult {
  ok: boolean;
  error?: string;
}

/**
 * Draft one prepared task's deliverable — staged in SEOOS only, never published.
 * Uses the shared AI path (global guardrails + the task's prompt + specialist
 * style). Only AI-draftable tasks (those with a promptKey) can be drafted;
 * run/verify tasks are approved manually. Missing facts come back as needsInfo.
 */
export async function draftPreparedTask(tenantId: string, taskId: string): Promise<DraftTaskResult> {
  const task = await getPreparedTaskRepo().get(tenantId, taskId);
  if (!task) return { ok: false, error: "Task not found" };
  if (!task.promptKey) {
    return { ok: false, error: "This task is done by hand (no AI draft) — approve or skip it directly." };
  }
  if (!hasAiConfig()) {
    return { ok: false, error: "AI is not configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY on SEOOS)." };
  }

  await getPreparedTaskRepo().save(PreparedTaskV1.parse({ ...task, status: "drafting", updatedAt: nowIso() }));

  const specialists = await listSpecialists(tenantId);
  const specialistName = specialists.find((s) => s.id === task.specialistId)?.name;
  const project = await getProject(tenantId, task.projectId);

  const system = await composeAiSystem(tenantId, task.promptKey, task.specialistId, specialistName);
  const user = [
    buildAccountContext(project),
    "",
    "TASK (the deliverable to produce):",
    `Title: ${task.title}`,
    `Phase: ${task.phase} · cadence: ${task.cadence}${task.period ? ` · period: ${task.period}` : ""}`,
    "",
    'Produce the deliverable this task calls for, following your instructions exactly. Return ONLY the JSON envelope {"summary","draft","needsInfo"}.',
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
    await getPreparedTaskRepo().save(
      PreparedTaskV1.parse({
        ...task,
        status,
        draft: draft || undefined,
        detail: summary || undefined,
        needsInfo,
        updatedAt: nowIso(),
      }),
    );
    return { ok: true };
  } catch (e) {
    // Roll back to "pending" so it can be retried; surface the reason.
    await getPreparedTaskRepo().save(PreparedTaskV1.parse({ ...task, status: "pending", updatedAt: nowIso() }));
    if (e instanceof AiNotConfiguredError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "draft_failed" };
  }
}

export type TaskDecision = "approve" | "reject" | "needs_info" | "save" | "skip";

/**
 * Record a specialist's decision on a task. Approve NEVER pushes anything live —
 * it only records the decision here; acting on it stays a human step. A rejection
 * note feeds the specialist's style learning.
 */
export async function decidePreparedTask(
  tenantId: string,
  taskId: string,
  input: { action: TaskDecision; note?: string; draft?: string },
  actorUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const task = await getPreparedTaskRepo().get(tenantId, taskId);
  if (!task) return { ok: false, error: "Task not found" };
  const now = nowIso();
  const nextDraft = typeof input.draft === "string" ? input.draft : task.draft;

  if (input.action === "save") {
    await getPreparedTaskRepo().save(PreparedTaskV1.parse({ ...task, draft: nextDraft, updatedAt: now }));
    return { ok: true };
  }

  const status =
    input.action === "approve"
      ? "approved"
      : input.action === "reject"
        ? "rejected"
        : input.action === "skip"
          ? "skipped"
          : "needs_info";

  await getPreparedTaskRepo().save(
    PreparedTaskV1.parse({
      ...task,
      draft: nextDraft,
      status,
      decidedByUserId: actorUserId,
      decidedAt: now,
      decisionNote: input.note?.trim() || undefined,
      updatedAt: now,
    }),
  );

  // Learn from corrections: a rejection reason refines this specialist's style.
  if (input.action === "reject" && input.note?.trim() && task.specialistId) {
    await addCorrectionRule(tenantId, task.specialistId, input.note.trim());
  }

  return { ok: true };
}
