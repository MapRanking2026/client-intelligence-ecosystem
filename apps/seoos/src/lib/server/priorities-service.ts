import type { AuthzContextV1 } from "@cie/contracts";

import { listProjectsForViewer } from "@/src/lib/server/projects-service";
import { listTicketsForViewer } from "@/src/lib/server/tickets-service";
import { listTasksForViewer } from "@/src/lib/server/task-drafting-service";

/**
 * "Needs your attention" — a read-only rollup of the actionable work across the
 * viewer's own clients (tickets + prepared tasks), so a specialist/AM sees what
 * to do on login instead of hunting across pages. Pulls and analyzes only; it
 * links into the existing draft→approve surfaces and sends nothing out.
 */
export type PriorityKind = "approve" | "info" | "draft";

export interface PriorityItem {
  type: "ticket" | "task";
  kind: PriorityKind;
  id: string;
  clientName: string;
  title: string;
  href: string;
  /** Sort weight: approvals first, then needs-info, then draftable. */
  rank: number;
}

export interface PrioritiesSummary {
  clients: number;
  toApprove: number;
  needInfo: number;
  toDraft: number;
  totalNeedsAction: number;
  items: PriorityItem[];
}

const RANK: Record<PriorityKind, number> = { approve: 0, info: 1, draft: 2 };
const KIND_LABEL: Record<PriorityKind, string> = {
  approve: "Awaiting your approval",
  info: "Needs info",
  draft: "Ready to draft",
};

export function priorityKindLabel(kind: PriorityKind): string {
  return KIND_LABEL[kind];
}

export async function getPrioritiesForViewer(authz: AuthzContextV1): Promise<PrioritiesSummary> {
  const [projects, tickets, tasks] = await Promise.all([
    listProjectsForViewer(authz),
    listTicketsForViewer(authz),
    listTasksForViewer(authz),
  ]);

  const projectByClientId = new Map(projects.map((p) => [p.clientId, p]));
  const items: PriorityItem[] = [];

  for (const t of tickets) {
    let kind: PriorityKind | null = null;
    if (t.status === "awaiting_approval") kind = "approve";
    else if (t.status === "needs_info") kind = "info";
    else if (t.status === "new") kind = "draft";
    if (!kind) continue;
    items.push({
      type: "ticket",
      kind,
      id: t.id,
      clientName: t.clientName || "(unlinked)",
      title: t.title,
      href: "/tickets",
      rank: RANK[kind],
    });
  }

  for (const t of tasks) {
    let kind: PriorityKind | null = null;
    if (t.status === "awaiting_approval") kind = "approve";
    else if (t.status === "needs_info") kind = "info";
    else if (t.status === "pending" && t.promptKey) kind = "draft"; // AI-draftable, not yet drafted
    if (!kind) continue;
    const project = projectByClientId.get(t.clientId);
    items.push({
      type: "task",
      kind,
      id: t.id,
      clientName: project?.businessName || "(unlinked)",
      title: t.title,
      href: project ? `/tasks?projectId=${project.id}` : "/tasks",
      rank: RANK[kind],
    });
  }

  items.sort((a, b) => a.rank - b.rank || a.clientName.localeCompare(b.clientName));

  const toApprove = items.filter((i) => i.kind === "approve").length;
  const needInfo = items.filter((i) => i.kind === "info").length;
  const toDraft = items.filter((i) => i.kind === "draft").length;

  return {
    clients: projects.length,
    toApprove,
    needInfo,
    toDraft,
    totalNeedsAction: items.length,
    items: items.slice(0, 20),
  };
}
