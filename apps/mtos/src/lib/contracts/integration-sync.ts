import type { IntegrationProviderId } from "@/src/lib/contracts/integrations";

export type IntegrationSyncStatus = "idle" | "running" | "completed" | "failed";

export interface IntegrationSyncCounts {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface IntegrationSyncJobRecord {
  id: string;
  tenantId: string;
  providerId: IntegrationProviderId;
  status: IntegrationSyncStatus;
  startedAt: string;
  finishedAt?: string;
  summary: string;
  counts: IntegrationSyncCounts;
  errorMessage?: string;
}

export interface ExternalRecordMappingRecord {
  id: string;
  tenantId: string;
  providerId: IntegrationProviderId;
  externalObjectId: string;
  externalObjectType: string;
  mtosObjectId: string;
  mtosObjectType: "commitment" | "client" | "monthly_touch" | "snapshot";
  clientId?: string;
  lastSyncedAt: string;
}

export interface IntegrationSnapshotRecord<TPayload = Record<string, unknown>> {
  id: string;
  tenantId: string;
  providerId: IntegrationProviderId;
  syncedAt: string;
  summary: string;
  counts: IntegrationSyncCounts;
  payload: TPayload;
}

/**
 * One probe against a single upstream API during a connection test. `skipped` means the probe could
 * not run (e.g. no account/location to sample), which is not a failure. `approvalBlocked` flags the
 * shape of error Google returns when the API is not enabled or the access request has not been
 * granted for the project ("has not been used / is disabled", PERMISSION_DENIED, or a zero quota).
 */
export interface IntegrationConnectionTestCheck {
  api: string;
  endpoint: string;
  status: "ok" | "failed" | "skipped";
  httpStatus?: number;
  detail: string;
  approvalBlocked?: boolean;
}

export interface IntegrationConnectionTestResult {
  providerId: IntegrationProviderId;
  ok: boolean;
  checkedAt: string;
  summary: string;
  checks: IntegrationConnectionTestCheck[];
}
