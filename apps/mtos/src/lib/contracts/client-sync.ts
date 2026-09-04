import type { IntegrationProviderId } from "@/src/lib/contracts/integrations";
import type { IntegrationSyncCounts, IntegrationSyncStatus } from "@/src/lib/contracts/integration-sync";

export interface SyncedClientRecord {
  id: string;
  tenantId: string;
  userId: string;
  clientId: string;
  providerId: IntegrationProviderId;
  externalObjectId: string;
  managerName: string;
  syncedAt: string;
}

export interface ClientSyncRunRecord {
  id: string;
  tenantId: string;
  userId: string;
  providerId: IntegrationProviderId;
  status: IntegrationSyncStatus;
  startedAt: string;
  finishedAt?: string;
  managerName: string;
  summary: string;
  counts: IntegrationSyncCounts;
  selectedIds?: string[];
  errorMessage?: string;
}
