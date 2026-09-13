import type { AuthzContextV1 } from "@cie/contracts";

import { getPreparedTaskRepo } from "@/src/lib/server/repositories/prepared-task-repo";
import { getTicketRepo } from "@/src/lib/server/repositories/ticket-repo";
import { listSpecialists } from "@/src/lib/server/specialists-service";
import { getRuleNumber } from "@/src/lib/server/rules-service";

/**
 * Team KPI collection (spec M10.20-23), computed from task/ticket statuses.
 * Rule-driven: the Task Execution target comes from the Rule Library
 * (kpi.task_execution_target_pct). Read-only; no outbound.
 *
 * Honest scope: the SOP's hours-based workload cap (M10.1, 8h/day) needs a
 * per-task time estimate SEOOS doesn't store, so the workload column here is a
 * COUNT of open items per specialist, not hours - and it says so. Task
 * Execution % and Closed Tickets % are genuinely computable from statuses.
 */
const DONE_TASK = new Set(["approved", "published"]);
const DONE_TICKET = new Set(["approved", "published"]);
const OPEN_TASK = new Set(["pending", "drafting", "awaiting_approval", "needs_info"]);
const OPEN_TICKET = new Set(["new", "drafting", "awaiting_approval", "needs_info"]);

export interface TeamKpiRow {
  specialistId: string;
  name: string;
  tasksTotal: number;
  tasksCompleted: number;
  taskExecutionPct: number | null;
  tasksOpen: number;
  ticketsTotal: number;
  ticketsClosed: number;
  ticketsClosedPct: number | null;
  ticketsOpen: number;
  taskTargetMet: boolean | null;
}

export interface TeamKpis {
  rows: TeamKpiRow[];
  taskExecutionTargetPct: number;
  ticketsClosedTargetPct: number;
  totals: { tasks: number; tickets: number; specialists: number };
}

function pct(done: number, total: number): number | null {
  return total > 0 ? Math.round((done / total) * 100) : null;
}

export async function getTeamKpis(authz: AuthzContextV1): Promise<TeamKpis> {
  const tenantId = authz.tenantId;
  const [tasks, tickets, specialists, taskExecutionTargetPct, ticketsClosedTargetPct] = await Promise.all([
    getPreparedTaskRepo().listByTenant(tenantId),
    getTicketRepo().listByTenant(tenantId),
    listSpecialists(tenantId),
    getRuleNumber(tenantId, "kpi.task_execution_target_pct", 95),
    getRuleNumber(tenantId, "kpi.closed_tickets_target_pct", 90),
  ]);

  const nameById = new Map(specialists.map((s) => [s.id, s.name]));
  const UNASSIGNED = "__unassigned__";

  interface Acc {
    tasksTotal: number; tasksCompleted: number; tasksOpen: number;
    ticketsTotal: number; ticketsClosed: number; ticketsOpen: number;
  }
  const acc = new Map<string, Acc>();
  const bucket = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) { a = { tasksTotal: 0, tasksCompleted: 0, tasksOpen: 0, ticketsTotal: 0, ticketsClosed: 0, ticketsOpen: 0 }; acc.set(id, a); }
    return a;
  };

  for (const t of tasks) {
    if (t.status === "skipped") continue; // not-applicable tasks don't count against execution
    const a = bucket(t.specialistId || UNASSIGNED);
    a.tasksTotal += 1;
    if (DONE_TASK.has(t.status)) a.tasksCompleted += 1;
    if (OPEN_TASK.has(t.status)) a.tasksOpen += 1;
  }
  for (const t of tickets) {
    const a = bucket(t.specialistId || UNASSIGNED);
    a.ticketsTotal += 1;
    if (DONE_TICKET.has(t.status)) a.ticketsClosed += 1;
    if (OPEN_TICKET.has(t.status)) a.ticketsOpen += 1;
  }

  const rows: TeamKpiRow[] = [...acc.entries()]
    .map(([id, a]) => {
      const taskExecutionPct = pct(a.tasksCompleted, a.tasksTotal);
      return {
        specialistId: id,
        name: id === UNASSIGNED ? "Unassigned" : nameById.get(id) ?? id,
        tasksTotal: a.tasksTotal,
        tasksCompleted: a.tasksCompleted,
        taskExecutionPct,
        tasksOpen: a.tasksOpen,
        ticketsTotal: a.ticketsTotal,
        ticketsClosed: a.ticketsClosed,
        ticketsClosedPct: pct(a.ticketsClosed, a.ticketsTotal),
        ticketsOpen: a.ticketsOpen,
        taskTargetMet: taskExecutionPct == null ? null : taskExecutionPct >= taskExecutionTargetPct,
      };
    })
    .sort((a, b) => (a.name === "Unassigned" ? 1 : b.name === "Unassigned" ? -1 : a.name.localeCompare(b.name)));

  return {
    rows,
    taskExecutionTargetPct,
    ticketsClosedTargetPct,
    totals: { tasks: tasks.length, tickets: tickets.length, specialists: specialists.length },
  };
}
