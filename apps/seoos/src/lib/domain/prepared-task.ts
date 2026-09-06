import { z } from "zod";
import { zIsoTimestamp, zTenantId, zUserId } from "@cie/contracts";

/** Where a task sits in the SEO workflow. */
export const TaskPhase = z.enum(["phase1", "phase2", "recurring"]);
export type TaskPhase = z.infer<typeof TaskPhase>;

export const TaskCadence = z.enum(["once", "daily", "weekly", "monthly"]);
export type TaskCadence = z.infer<typeof TaskCadence>;

/**
 * Lifecycle of a prepared task. The AI drafts it to "awaiting_approval" INSIDE
 * SEOOS only; nothing goes live until a specialist approves. "published" means it
 * was pushed to production after approval (or staged where we lack write access).
 */
export const TaskStatus = z.enum([
  "pending", // created, not yet drafted
  "drafting", // AI is drafting
  "awaiting_approval", // drafted, waiting on the specialist
  "approved", // specialist approved (ready to publish)
  "published", // pushed to production / delivered
  "rejected", // specialist rejected
  "skipped", // not applicable
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const PreparedTaskV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: zTenantId,
  /** The client this task is for (project id) + canonical client id. */
  projectId: z.string().min(1),
  clientId: z.string().min(1),
  /** Stable template key; for recurring tasks suffixed with the period. */
  taskKey: z.string().min(1),
  templateKey: z.string().min(1),
  phase: TaskPhase,
  cadence: TaskCadence,
  /** Period this instance covers (e.g. 2026-09 for monthly); empty for once. */
  period: z.string().default(""),
  title: z.string().min(1),
  order: z.number().int().default(0),
  /** Assigned specialist (roster id) — follows the client's current specialist. */
  specialistId: z.string().optional(),
  /** Prompt key that drafts this task, when it's AI-draftable. */
  promptKey: z.string().optional(),
  status: TaskStatus.default("pending"),
  /** The drafted deliverable, staged in SEOOS (never published until approved). */
  draft: z.string().optional(),
  /** "What I did" detail for the drill-down. */
  detail: z.string().optional(),
  decidedByUserId: zUserId.optional(),
  decidedAt: zIsoTimestamp.optional(),
  decisionNote: z.string().optional(),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type PreparedTaskV1 = z.infer<typeof PreparedTaskV1>;

export const TERMINAL_STATUSES: TaskStatus[] = ["approved", "published", "rejected", "skipped"];
export const OPEN_STATUSES: TaskStatus[] = ["pending", "drafting", "awaiting_approval"];
