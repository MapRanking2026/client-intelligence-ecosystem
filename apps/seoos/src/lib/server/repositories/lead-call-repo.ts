import type {
  LeadCallListQueryV1,
  LeadCallRecordV1,
  LeadCallVerificationChangeV1,
} from "@cie/contracts";
import { orderByOccurredAt } from "@cie/core";
import { getServerEnv } from "@/src/lib/server/env";
import { seedStore } from "@/src/lib/server/seed";

/**
 * CANONICAL Lead & Call repository — the SAME records MTOS uses. SEOOS reads and
 * (when authorized) writes verification changes here; it never keeps a divergent
 * copy. The live implementation is backed by the shared GoHighLevel-derived
 * canonical store behind the MTOS server boundary / integration gateway and is
 * `blocked_external` until that gateway + credentials are wired. The in-memory
 * implementation below powers seed/dev and exercises the shared sort/query
 * contract and audit semantics end to end.
 */
export interface LeadCallRepo {
  list(
    tenantId: string,
    query: LeadCallListQueryV1,
  ): Promise<{ items: LeadCallRecordV1[]; nextCursor: string | null; timezone: string }>;
  get(tenantId: string, recordId: string): Promise<LeadCallRecordV1 | null>;
  applyVerificationChange(
    tenantId: string,
    change: LeadCallVerificationChangeV1,
    nowIso: string,
  ): Promise<LeadCallRecordV1>;
}

function matchesFilter(
  record: LeadCallRecordV1,
  filter: LeadCallListQueryV1["filter"],
): boolean {
  if (filter.clientId && record.clientId !== filter.clientId) return false;
  if (filter.channel && record.channel !== filter.channel) return false;
  if (
    filter.verificationStatus &&
    record.verificationStatus !== filter.verificationStatus
  ) {
    return false;
  }
  if (filter.since && record.occurredAt && record.occurredAt < filter.since) {
    return false;
  }
  if (filter.until && record.occurredAt && record.occurredAt >= filter.until) {
    return false;
  }
  return true;
}

class InMemoryLeadCallRepo implements LeadCallRepo {
  async list(tenantId: string, query: LeadCallListQueryV1) {
    const filtered = seedStore.leadCalls.filter(
      (r) => r.tenantId === tenantId && matchesFilter(r, query.filter),
    );
    // Canonical sort applied server-side BEFORE pagination.
    const ordered = orderByOccurredAt(filtered, query.sort, (r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
    }));
    const start = query.cursor ? Number.parseInt(query.cursor, 10) || 0 : 0;
    const page = ordered.slice(start, start + query.limit);
    const nextIndex = start + query.limit;
    const nextCursor = nextIndex < ordered.length ? String(nextIndex) : null;
    return {
      items: page,
      nextCursor,
      timezone: getServerEnv().appEnv === "production" ? "UTC" : "UTC",
    };
  }
  async get(tenantId: string, recordId: string) {
    return (
      seedStore.leadCalls.find(
        (r) => r.tenantId === tenantId && r.id === recordId,
      ) ?? null
    );
  }
  async applyVerificationChange(
    tenantId: string,
    change: LeadCallVerificationChangeV1,
    nowIso: string,
  ) {
    const record = await this.get(tenantId, change.recordId);
    if (!record) throw new Error(`Lead/call record not found: ${change.recordId}`);
    const next: LeadCallRecordV1 = { ...record };
    if (change.verificationStatus && change.verificationStatus !== record.verificationStatus) {
      next.audit = [
        ...record.audit,
        {
          at: nowIso,
          actorUserId: change.actorUserId,
          app: change.app,
          field: "verificationStatus",
          previous: record.verificationStatus,
          next: change.verificationStatus,
          reason: change.reason,
        },
      ];
      next.verificationStatus = change.verificationStatus;
    }
    if (change.classification !== undefined && change.classification !== record.classification) {
      next.audit = [
        ...next.audit,
        {
          at: nowIso,
          actorUserId: change.actorUserId,
          app: change.app,
          field: "classification",
          previous: record.classification ?? null,
          next: change.classification ?? null,
          reason: change.reason,
        },
      ];
      next.classification = change.classification;
    }
    const idx = seedStore.leadCalls.findIndex((r) => r.id === record.id);
    if (idx >= 0) seedStore.leadCalls[idx] = next;
    return next;
  }
}

export function getLeadCallRepo(): LeadCallRepo {
  // Live GHL-backed canonical repo is blocked_external; in-memory seed is used
  // until the shared integration gateway is wired.
  return new InMemoryLeadCallRepo();
}
