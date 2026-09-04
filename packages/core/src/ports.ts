import type {
  LeadCallListQueryV1,
  LeadCallRecordV1,
  LeadCallVerificationChangeV1,
  OutboxEventV1,
  SeoIntelligencePackageV1,
  SeoIntelligenceRequestV1,
} from "@cie/contracts";

/**
 * Ports (hexagonal boundaries). Implementations live behind each app's server
 * boundary — Firestore adapters, the protected recording proxy, secrets, etc.
 * The packages define only the shape; nothing here does I/O or holds secrets.
 *
 * Every implementation is expected to have ALREADY enforced authn + tenant
 * membership + client visibility + app membership + the specific permission
 * before it is called. UI visibility is never authorization.
 */

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
  /** IANA timezone the caller should render timestamps in. */
  timezone: string;
}

/** Canonical Lead & Call store — the same records both apps read/write. */
export interface LeadCallRepositoryPort {
  /**
   * List records for a tenant. Implementations MUST apply the canonical sort
   * (see sortLeadCallRecords) server-side before pagination.
   */
  list(
    tenantId: string,
    query: LeadCallListQueryV1,
  ): Promise<PageResult<LeadCallRecordV1>>;

  get(tenantId: string, recordId: string): Promise<LeadCallRecordV1 | null>;

  /** Apply an audited verification/classification change to one record. */
  applyVerificationChange(
    tenantId: string,
    change: LeadCallVerificationChangeV1,
  ): Promise<LeadCallRecordV1>;
}

/** SEOOS request→package engine, consumed by MTOS via a narrow service. */
export interface SeoIntelligencePort {
  submitRequest(
    request: SeoIntelligenceRequestV1,
  ): Promise<SeoIntelligenceRequestV1>;

  getRequest(
    tenantId: string,
    requestId: string,
  ): Promise<SeoIntelligenceRequestV1 | null>;

  /** Latest immutable package version for a request, if any is ready. */
  getLatestPackage(
    tenantId: string,
    requestId: string,
  ): Promise<SeoIntelligencePackageV1 | null>;
}

/** Durable at-least-once event delivery (Firestore outbox). */
export interface OutboxPort {
  enqueue(event: OutboxEventV1): Promise<void>;

  /** Claim a batch of due events for delivery (visibility-locked). */
  claimDue(limit: number, now: string): Promise<OutboxEventV1[]>;

  markDelivered(eventId: string): Promise<void>;

  /** Record a failed attempt with the next retry time (or dead-letter). */
  markFailed(
    eventId: string,
    error: string,
    nextAttemptAt: string | null,
  ): Promise<void>;
}
