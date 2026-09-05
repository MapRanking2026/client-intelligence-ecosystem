import {
  AUDIT_TEMPLATE,
  AuditItemV1,
  MONTHLY_AUDIT_TRANSITIONS,
  MonthlyAuditV1,
  UNRESOLVED_RESULTS,
  type AuditResult,
  type MonthlyAuditStatus,
} from "@/src/lib/domain/monthly-audit";
import { newId, nowIso } from "@/src/lib/ids";
import { getMonthlyAuditRepo } from "@/src/lib/server/repositories/monthly-audit-repo";

export async function listMonthlyAudits(tenantId: string, projectId: string) {
  return getMonthlyAuditRepo().listByProject(tenantId, projectId);
}

export async function getMonthlyAudit(tenantId: string, id: string) {
  return getMonthlyAuditRepo().get(tenantId, id);
}

/**
 * Create (or return existing) monthly audit for a period. Seeds the standard
 * checklist and carries forward any unresolved items from the most recent prior
 * audit — prior monthly history is preserved (a new document per period).
 */
export async function createMonthlyAudit(
  tenantId: string,
  projectId: string,
  clientId: string,
  period: string,
): Promise<MonthlyAuditV1> {
  const repo = getMonthlyAuditRepo();
  const existing = await repo.findByPeriod(tenantId, projectId, period);
  if (existing) return existing;

  const prior = (await repo.listByProject(tenantId, projectId)).filter((a) => a.period < period);
  const previous = prior[0]; // list is sorted period desc
  const carriedByKey = new Map<string, { notes?: string; remediation?: string }>();
  if (previous) {
    for (const item of previous.items) {
      if (UNRESOLVED_RESULTS.includes(item.result) && (item.notes || item.remediation)) {
        carriedByKey.set(item.key, { notes: item.notes, remediation: item.remediation });
      }
    }
  }

  const items: AuditItemV1[] = AUDIT_TEMPLATE.map((t) => {
    const carried = carriedByKey.get(t.key);
    return AuditItemV1.parse({
      key: t.key,
      label: t.label,
      category: t.category,
      result: "pending",
      notes: carried?.notes,
      remediation: carried?.remediation,
      carriedForward: Boolean(carried),
    });
  });

  const now = nowIso();
  const audit = MonthlyAuditV1.parse({
    schemaVersion: 1,
    id: newId("audit"),
    tenantId,
    projectId,
    clientId,
    period,
    status: "draft",
    items,
    createdAt: now,
    updatedAt: now,
  });
  return repo.save(audit);
}

export async function updateAuditItem(
  tenantId: string,
  auditId: string,
  key: string,
  patch: { result?: AuditResult; notes?: string; remediation?: string },
): Promise<MonthlyAuditV1> {
  const repo = getMonthlyAuditRepo();
  const audit = await repo.get(tenantId, auditId);
  if (!audit) throw new Error(`Audit not found: ${auditId}`);
  const items = audit.items.map((item) =>
    item.key === key
      ? {
          ...item,
          result: patch.result ?? item.result,
          notes: patch.notes ?? item.notes,
          remediation: patch.remediation ?? item.remediation,
        }
      : item,
  );
  return repo.save({ ...audit, items, updatedAt: nowIso() });
}

export async function transitionMonthlyAudit(
  tenantId: string,
  auditId: string,
  to: MonthlyAuditStatus,
  reviewerUserId: string,
): Promise<MonthlyAuditV1> {
  const repo = getMonthlyAuditRepo();
  const audit = await repo.get(tenantId, auditId);
  if (!audit) throw new Error(`Audit not found: ${auditId}`);
  if (!MONTHLY_AUDIT_TRANSITIONS[audit.status].includes(to)) {
    throw new Error(`Illegal audit transition ${audit.status} → ${to}`);
  }
  const now = nowIso();
  return repo.save({
    ...audit,
    status: to,
    reviewerUserId: to === "qa" || to === "published" ? reviewerUserId : audit.reviewerUserId,
    publishedAt: to === "published" ? now : audit.publishedAt,
    updatedAt: now,
  });
}
