import { z } from "zod";
import { zClientId, zIsoTimestamp, zTenantId, zUserId } from "@cie/contracts";

export const WorkOrderType = z.enum([
  "keyword_setup",
  "grid_scan",
  "gbp_optimization",
  "content_on_page",
  "technical_fix",
  "schema",
  "citations_local",
  "review_operation",
  "reporting",
  "investigation",
  "custom",
]);
export type WorkOrderType = z.infer<typeof WorkOrderType>;

export const WorkOrderStatus = z.enum([
  "backlog",
  "planned",
  "ready",
  "in_progress",
  "blocked",
  "awaiting_approval",
  "ready_for_qa",
  "revision_requested",
  "completed",
  "cancelled",
]);
export type WorkOrderStatus = z.infer<typeof WorkOrderStatus>;

export const WORK_ORDER_TRANSITIONS: Record<
  WorkOrderStatus,
  ReadonlyArray<WorkOrderStatus>
> = {
  backlog: ["planned", "cancelled"],
  planned: ["ready", "backlog", "cancelled"],
  ready: ["in_progress", "planned", "cancelled"],
  in_progress: ["blocked", "awaiting_approval", "ready_for_qa", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  awaiting_approval: ["in_progress", "ready_for_qa", "cancelled"],
  ready_for_qa: ["revision_requested", "completed"],
  revision_requested: ["in_progress", "ready_for_qa", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionWorkOrder(
  from: WorkOrderStatus,
  to: WorkOrderStatus,
): boolean {
  return WORK_ORDER_TRANSITIONS[from].includes(to);
}

export const ChecklistItem = z.object({
  label: z.string().min(1),
  done: z.boolean().default(false),
});

export const QaResult = z.enum(["pass", "revision"]);

export const WorkOrderQa = z.object({
  result: QaResult,
  reviewerUserId: zUserId,
  notes: z.string().max(2000).optional(),
  at: zIsoTimestamp,
});
export type WorkOrderQa = z.infer<typeof WorkOrderQa>;

export const WorkOrderActivityEntry = z.object({
  at: zIsoTimestamp,
  actorUserId: zUserId,
  kind: z.enum(["status", "qa", "note", "created"]),
  detail: z.string().max(1000),
});
export type WorkOrderActivityEntry = z.infer<typeof WorkOrderActivityEntry>;

export const WorkOrderV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: zTenantId,
  projectId: z.string().min(1),
  clientId: zClientId,
  type: WorkOrderType,
  title: z.string().min(1),
  scope: z.string().optional(),
  sourceRecommendationId: z.string().optional(),
  owner: zUserId.optional(),
  collaborators: z.array(zUserId).default([]),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  status: WorkOrderStatus.default("backlog"),
  dueDate: zIsoTimestamp.optional(),
  dependencies: z.array(z.string()).default([]),
  checklist: z.array(ChecklistItem).default([]),
  notes: z.string().optional(),
  requiresApproval: z.boolean().default(false),
  completionSummary: z.string().optional(),
  qa: WorkOrderQa.optional(),
  activity: z.array(WorkOrderActivityEntry).default([]),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type WorkOrderV1 = z.infer<typeof WorkOrderV1>;

export const CreateWorkOrderInput = z.object({
  projectId: z.string().min(1),
  clientId: zClientId,
  type: WorkOrderType,
  title: z.string().min(1),
  scope: z.string().optional(),
  sourceRecommendationId: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  requiresApproval: z.boolean().default(false),
});
export type CreateWorkOrderInput = z.infer<typeof CreateWorkOrderInput>;
