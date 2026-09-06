import {
  OPEN_STATUSES,
  PreparedTaskV1,
  type TaskCadence,
  type TaskPhase,
} from "@/src/lib/domain/prepared-task";
import { TASK_TEMPLATES, type TaskTemplate } from "@/src/lib/domain/task-templates";
import type { SeoProjectV1 } from "@/src/lib/domain/project";
import type { SpecialistV1 } from "@/src/lib/domain/specialist";
import { newId, nowIso } from "@/src/lib/ids";
import { getProjectRepo } from "@/src/lib/server/repositories/project-repo";
import { getPreparedTaskRepo } from "@/src/lib/server/repositories/prepared-task-repo";
import { getPerformanceSnapshotRepo } from "@/src/lib/server/repositories/performance-snapshot-repo";
import { listSpecialists } from "@/src/lib/server/specialists-service";
import { effectiveSpecialistId } from "@/src/lib/server/projects-service";

/** Which package scope a client has, from its ClickUp services. */
function clientScope(project: SeoProjectV1): { website: boolean; ai: boolean } {
  const s = (project.services ?? []).join(" | ").toLowerCase();
  const ai = /(map\s*sense|seo\s*\+?\s*ai|local growth engine)/.test(s);
  const website = ai || /(map pack dominator|dominator|custom seo|web design)/.test(s);
  return { website, ai };
}

/**
 * Where the client currently is — so we generate FORWARD, never restart.
 * Prefers the ClickUp status; falls back to the project stage.
 */
function frontierPhase(project: SeoProjectV1, hasSnapshot: boolean): TaskPhase | "none" {
  const status = (project.externalIds?.status ?? "").toLowerCase();
  if (/(inactive|offboard|cancel|paused|churn|former|lost)/.test(status)) return "none";
  if (/active/.test(status)) return "recurring";
  if (/(onboard|new)/.test(status)) return "phase1";
  const stage = project.stage;
  if (["active", "paused", "completed"].includes(stage)) return "recurring";
  if (["strategy", "implementation", "qa"].includes(stage)) return "phase2";
  // A baseline scan already run implies setup is under way but not steady-state.
  if (hasSnapshot && stage === "baseline_scan") return "phase2";
  return "phase1";
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad(week)}`;
}
function periodFor(cadence: TaskCadence): string {
  const d = new Date();
  if (cadence === "monthly") return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  if (cadence === "weekly") return isoWeek(d);
  if (cadence === "daily") return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return "";
}

/** Templates that apply at the client's current frontier + its package scope. */
function applicableTemplates(project: SeoProjectV1, frontier: TaskPhase): TaskTemplate[] {
  const scope = clientScope(project);
  const phases: TaskPhase[] =
    frontier === "phase1" ? ["phase1"] : frontier === "phase2" ? ["phase2", "recurring"] : ["recurring"];
  return TASK_TEMPLATES.filter((t) => {
    if (!phases.includes(t.phase)) return false;
    if (t.scope === "all") return true;
    if (t.scope === "website") return scope.website;
    if (t.scope === "ai") return scope.ai;
    return false;
  });
}

export interface TaskSyncResult {
  ok: boolean;
  frontier: TaskPhase | "none";
  created: number;
  reassigned: number;
  error?: string;
}

/**
 * Idempotently bring a client's task plan up to date:
 *  - NEW client → creates the plan from its current frontier forward.
 *  - EXISTING client → adds only what's missing from here forward (never restarts,
 *    never duplicates a task or a recurring period already present).
 *  - REASSIGNED → moves every open task to the client's current specialist.
 * Safe to run on every sync, on reassignment, or as a backfill.
 */
export async function syncTaskPlan(
  tenantId: string,
  projectId: string,
  specialists?: SpecialistV1[],
): Promise<TaskSyncResult> {
  const project = await getProjectRepo().get(tenantId, projectId);
  if (!project) return { ok: false, frontier: "none", created: 0, reassigned: 0, error: "Project not found" };

  const roster = specialists ?? (await listSpecialists(tenantId));
  const currentSpecialistId = effectiveSpecialistId(project, roster);
  const snapshot = await getPerformanceSnapshotRepo().get(tenantId, projectId);
  const frontier = frontierPhase(project, Boolean(snapshot));

  const repo = getPreparedTaskRepo();
  const existing = await repo.listByProject(tenantId, projectId);
  const existingKeys = new Set(existing.map((t) => t.taskKey));

  const now = nowIso();
  const toCreate: PreparedTaskV1[] = [];
  const toUpdate: PreparedTaskV1[] = [];

  if (frontier !== "none") {
    for (const tpl of applicableTemplates(project, frontier)) {
      const period = periodFor(tpl.cadence);
      const taskKey = period ? `${tpl.key}:${period}` : tpl.key;
      if (existingKeys.has(taskKey)) continue;
      toCreate.push(
        PreparedTaskV1.parse({
          schemaVersion: 1,
          id: newId("task"),
          tenantId,
          projectId,
          clientId: project.clientId,
          taskKey,
          templateKey: tpl.key,
          phase: tpl.phase,
          cadence: tpl.cadence,
          period,
          title: tpl.title,
          order: tpl.order,
          specialistId: currentSpecialistId,
          promptKey: tpl.promptKey,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
  }

  // Reassignment: hand every OPEN task to the client's current specialist.
  let reassigned = 0;
  for (const t of existing) {
    if (OPEN_STATUSES.includes(t.status) && t.specialistId !== currentSpecialistId) {
      toUpdate.push({ ...t, specialistId: currentSpecialistId, updatedAt: now });
      reassigned += 1;
    }
  }

  if (toCreate.length) await repo.saveMany(toCreate);
  if (toUpdate.length) await repo.saveMany(toUpdate);

  return { ok: true, frontier, created: toCreate.length, reassigned };
}

/** Backfill: run the plan sync across every client — nothing gets missed. */
export async function syncAllTaskPlans(
  tenantId: string,
): Promise<{ clients: number; created: number; reassigned: number }> {
  const projects = await getProjectRepo().list(tenantId);
  const specialists = await listSpecialists(tenantId);
  let created = 0;
  let reassigned = 0;
  for (const p of projects) {
    const r = await syncTaskPlan(tenantId, p.id, specialists);
    created += r.created;
    reassigned += r.reassigned;
  }
  return { clients: projects.length, created, reassigned };
}
