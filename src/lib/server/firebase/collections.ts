export function tenantPath(tenantId: string) {
  return `tenants/${tenantId}`;
}

export function clientPath(tenantId: string, clientId: string) {
  return `${tenantPath(tenantId)}/clients/${clientId}`;
}

export function clientsCollectionPath(tenantId: string) {
  return `${tenantPath(tenantId)}/clients`;
}

/** AM-uploaded supporting documents / screenshots / notes attached to a client. */
export function clientAttachmentsCollectionPath(tenantId: string, clientId: string) {
  return `${clientPath(tenantId, clientId)}/attachments`;
}

export function clientAttachmentPath(tenantId: string, clientId: string, attachmentId: string) {
  return `${clientAttachmentsCollectionPath(tenantId, clientId)}/${attachmentId}`;
}

export function monthlyTouchesCollectionPath(tenantId: string) {
  return `${tenantPath(tenantId)}/monthlyTouches`;
}

export function monthlyTouchPath(tenantId: string, touchId: string) {
  return `${monthlyTouchesCollectionPath(tenantId)}/${touchId}`;
}

export function commitmentsCollectionPath(tenantId: string) {
  return `${tenantPath(tenantId)}/commitments`;
}

export function opportunitiesCollectionPath(tenantId: string) {
  return `${tenantPath(tenantId)}/opportunities`;
}

export function integrationsCollectionPath(tenantId: string) {
  return `${tenantPath(tenantId)}/integrations`;
}

export function integrationConnectionPath(tenantId: string, providerId: string) {
  return `${integrationsCollectionPath(tenantId)}/${providerId}`;
}

export function externalRecordMappingsCollectionPath(tenantId: string) {
  return `${tenantPath(tenantId)}/externalRecordMappings`;
}

export function integrationSyncJobsCollectionPath(tenantId: string) {
  return `${tenantPath(tenantId)}/integrationSyncJobs`;
}

export function integrationSnapshotsCollectionPath(tenantId: string) {
  return `${tenantPath(tenantId)}/integrationSnapshots`;
}

export function integrationSnapshotPath(tenantId: string, providerId: string) {
  return `${integrationSnapshotsCollectionPath(tenantId)}/${providerId}`;
}

export function leadVerificationsCollectionPath(tenantId: string) {
  return `${tenantPath(tenantId)}/leadVerifications`;
}

/** One document per client holding the latest lead & call verification review. */
export function leadVerificationPath(tenantId: string, clientId: string) {
  return `${leadVerificationsCollectionPath(tenantId)}/${clientId}`;
}

export function knowledgeChunksCollectionPath(tenantId: string) {
  return `${tenantPath(tenantId)}/knowledgeChunks`;
}

/** One document per embedded chunk in the Map Ranking knowledge base (RAG). */
export function knowledgeChunkPath(tenantId: string, chunkId: string) {
  return `${knowledgeChunksCollectionPath(tenantId)}/${chunkId}`;
}

export function tenantUsersCollectionPath(tenantId: string) {
  return `${tenantPath(tenantId)}/users`;
}

export function tenantUserPath(tenantId: string, userId: string) {
  return `${tenantUsersCollectionPath(tenantId)}/${userId}`;
}

export function tenantUserSyncedClientsCollectionPath(tenantId: string, userId: string) {
  return `${tenantUserPath(tenantId, userId)}/syncedClients`;
}

export function tenantUserSyncedClientPath(tenantId: string, userId: string, clientId: string) {
  return `${tenantUserSyncedClientsCollectionPath(tenantId, userId)}/${clientId}`;
}

export function tenantUserClientSyncRunsCollectionPath(tenantId: string, userId: string) {
  return `${tenantUserPath(tenantId, userId)}/clientSyncRuns`;
}

export function tenantUserClientSyncRunPath(tenantId: string, userId: string, runId: string) {
  return `${tenantUserClientSyncRunsCollectionPath(tenantId, userId)}/${runId}`;
}
