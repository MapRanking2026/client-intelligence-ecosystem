import type { AuthzContextV1 } from "@cie/contracts";

import type { SeoProjectV1 } from "@/src/lib/domain/project";
import { listTicketsForViewer } from "@/src/lib/server/tickets-service";
import { getPreparedTaskRepo } from "@/src/lib/server/repositories/prepared-task-repo";
import { getPerformanceSnapshotRepo } from "@/src/lib/server/repositories/performance-snapshot-repo";
import { getKeywordRepo } from "@/src/lib/server/repositories/keyword-repo";
import { listMonthlyAudits } from "@/src/lib/server/monthly-audits-service";
import { getRuleNumber } from "@/src/lib/server/rules-service";

/**
 * An honest, read-only health read for one client: what's in place vs. what's
 * blocking progress, assembled from data already in the app (tickets, tasks,
 * audits, baseline data, sync freshness). No outbound; it only reads and links.
 */
export type HealthStatus = "on_track" | "needs_attention" | "at_risk";
export type Severity = "high" | "medium" | "low";

export interface HealthSignal {
  label: string;
  severity: Severity;
  href?: string;
}

export interface ClientHealth {
  status: HealthStatus;
  needs: HealthSignal[];
  inPlace: string[];
  lastSyncedDaysAgo?: number;
}

const STALE_DAYS_DEFAULT = 14;
const AUDIT_OPEN_RESULTS = new Set(["pending", "warning", "fail"]);

function daysSince(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export async function getClientHealth(
  authz: AuthzContextV1,
  project: SeoProjectV1,
): Promise<ClientHealth> {
  const tenantId = authz.tenantId;
  const [allTickets, tasks, audits, snapshot, keywords, staleDays] = await Promise.all([
    listTicketsForViewer(authz),
    getPreparedTaskRepo().listByProject(tenantId, project.id),
    listMonthlyAudits(tenantId, project.id),
    getPerformanceSnapshotRepo().get(tenantId, project.id),
    getKeywordRepo().listByProject(tenantId, project.id),
    getRuleNumber(tenantId, "health.stale_days", STALE_DAYS_DEFAULT),
  ]);
  const tickets = allTickets.filter((t) => t.projectId === project.id);

  const needs: HealthSignal[] = [];
  const push = (label: string, severity: Severity, href?: string) => needs.push({ label, severity, href });

  // Actionable tickets / tasks.
  const ticketsApprove = tickets.filter((t) => t.status === "awaiting_approval").length;
  const ticketsInfo = tickets.filter((t) => t.status === "needs_info").length;
  const tasksApprove = tasks.filter((t) => t.status === "awaiting_approval").length;
  const tasksInfo = tasks.filter((t) => t.status === "needs_info").length;
  if (ticketsApprove) push(`${ticketsApprove} ticket${ticketsApprove > 1 ? "s" : ""} awaiting your approval`, "high", "/tickets");
  if (tasksApprove) push(`${tasksApprove} task${tasksApprove > 1 ? "s" : ""} awaiting approval`, "high", `/tasks?projectId=${project.id}`);
  if (ticketsInfo) push(`${ticketsInfo} ticket${ticketsInfo > 1 ? "s" : ""} blocked on missing info`, "medium", "/tickets");
  if (tasksInfo) push(`${tasksInfo} task${tasksInfo > 1 ? "s" : ""} blocked on missing info`, "medium", `/tasks?projectId=${project.id}`);

  // Monthly audit: unresolved items on the latest audit.
  const latestAudit = [...audits].sort((a, b) => (b.period > a.period ? 1 : -1))[0];
  const openAudit = latestAudit
    ? latestAudit.items.filter((i) => AUDIT_OPEN_RESULTS.has(i.result)).length
    : 0;
  if (openAudit) push(`${openAudit} monthly-audit item${openAudit > 1 ? "s" : ""} unresolved`, "medium", `/monthly-audits?projectId=${project.id}`);

  // Baseline data + setup.
  const hasData = Boolean(snapshot && (snapshot.grids.length || snapshot.keywords.length));
  if (!hasData) push("No rank/grid data pulled yet — run a full scan", "high", `/rankings?projectId=${project.id}`);
  if (keywords.length === 0) push("No tracked keywords yet", "medium", `/keywords?projectId=${project.id}`);
  if (project.setupReadiness < 50) push(`Setup only ${project.setupReadiness}% complete`, "medium");

  // Data completeness (low severity).
  if (!project.website) push("No website on file", "low");
  if (!project.niche) push("No niche / vertical set", "low");
  if (!project.externalIds?.pod) push("No pod assigned", "low");

  // Sync freshness.
  const lastSyncedDaysAgo = daysSince(project.updatedAt);
  if (lastSyncedDaysAgo !== undefined && lastSyncedDaysAgo > staleDays) {
    push(`Client data last refreshed ${lastSyncedDaysAgo} days ago`, "medium");
  }

  // What's already in place (short positives).
  const inPlace: string[] = [];
  if (hasData) inPlace.push("Rank/grid data pulled");
  if (keywords.length) inPlace.push(`${keywords.length} keyword${keywords.length > 1 ? "s" : ""} tracked`);
  if (project.services?.length) inPlace.push(`${project.services.length} service${project.services.length > 1 ? "s" : ""}`);
  if (project.externalIds?.pod) inPlace.push(`Pod: ${project.externalIds.pod}`);
  if (Object.keys(project.dashboardMetrics ?? {}).length) inPlace.push("Dashboard metrics synced");

  // Derived status — honest, from real signals.
  const atRisk = project.health === "at_risk" || project.health === "blocked";
  const hasSeriousNeed = needs.some((n) => n.severity === "high" || n.severity === "medium");
  const status: HealthStatus = atRisk ? "at_risk" : hasSeriousNeed ? "needs_attention" : "on_track";

  return { status, needs, inPlace, lastSyncedDaysAgo };
}
