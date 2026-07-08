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
