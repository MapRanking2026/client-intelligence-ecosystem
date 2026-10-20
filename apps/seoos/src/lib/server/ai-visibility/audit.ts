import { newId, nowIso } from "@/src/lib/ids";
import type { AivAuditEventV1 } from "@/src/lib/ai-visibility/types";
import { redact } from "./providers/types";
import { auditEvents } from "./store";

/** Append-only audit trail for important tracker changes. Never stores secrets. */
export async function audit(
  tenantId: string,
  actor: string,
  action: string,
  opts: { projectId?: string; target?: string; detail?: Record<string, unknown> } = {},
): Promise<void> {
  const detail = JSON.parse(redact(JSON.stringify(opts.detail ?? {}))) as Record<string, unknown>;
  const ev: AivAuditEventV1 = {
    schemaVersion: 1,
    id: newId("aud"),
    tenantId,
    projectId: opts.projectId,
    actor,
    action,
    target: opts.target,
    detail,
    at: nowIso(),
  };
  try {
    await auditEvents().set(tenantId, ev.id, ev);
  } catch (e) {
    // Auditing must not take the request down, but the failure is surfaced in logs.
    console.error("[aiv] audit write failed:", e instanceof Error ? e.message : e);
  }
}

export async function listAudit(tenantId: string, projectId?: string, limit = 100): Promise<AivAuditEventV1[]> {
  const rows = projectId ? await auditEvents().listWhere(tenantId, "projectId", projectId) : await auditEvents().list(tenantId);
  return rows.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}
