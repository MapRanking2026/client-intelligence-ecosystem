import { z } from "zod";
import { zCorrelationId, zIdempotencyKey, zIsoTimestamp, zTenantId, zClientId } from "./common";
import { DataGapV1, Freshness } from "./evidence";

/**
 * Integration Gateway contracts — the signed service-to-service boundary
 * through which SEOOS consumes MTOS's EXISTING encrypted connections. No
 * credentials, tokens, or raw provider URLs ever cross this boundary; only
 * secret-free health views and normalized, redacted data.
 */

/** Canonical provider ids (mirrors the MTOS integration catalog). */
export const GatewayProviderId = z.enum([
  "clickup",
  "google-business-profile",
  "google-search-console",
  "google-ads",
  "meta-ads",
  "google-analytics",
  "google-calendar",
  "google-meet",
  "gohighlevel",
  "google-drive",
  "gmail",
  "ahrefs",
  "rank-tracker",
  "geogrid",
  "map-checkins",
  "stripe",
  "quickbooks",
  "internal-database",
]);
export type GatewayProviderId = z.infer<typeof GatewayProviderId>;

/** Superset of connection/health states surfaced to SEOOS. */
export const ProviderHealthStatus = z.enum([
  "not_connected",
  "connected",
  "syncing",
  "partial",
  "stale",
  "action_required",
  "expiring",
  "error",
  "unsupported",
]);
export type ProviderHealthStatus = z.infer<typeof ProviderHealthStatus>;

/** Secret-free provider health, derived from the MTOS IntegrationProviderView. */
export const ProviderHealthV1 = z.object({
  schemaVersion: z.literal(1),
  id: GatewayProviderId,
  name: z.string(),
  category: z.string(),
  status: ProviderHealthStatus,
  statusDetail: z.string().default(""),
  isConnected: z.boolean().default(false),
  isShared: z.boolean().default(false),
  supportsSync: z.boolean().default(false),
  lastSyncAt: zIsoTimestamp.optional(),
  lastSyncStatus: z.enum(["idle", "running", "completed", "failed"]).optional(),
  tokenExpiresAt: zIsoTimestamp.optional(),
});
export type ProviderHealthV1 = z.infer<typeof ProviderHealthV1>;

/** Resources SEOOS may request through the gateway. */
export const GatewayResource = z.enum([
  "integration-health",
  "map-checkins.activity",
  "gohighlevel.leads",
  "rank-tracker.rankings",
  "gbp.performance",
  "search-console.performance",
]);
export type GatewayResource = z.infer<typeof GatewayResource>;

export const GatewayRequestV1 = z.object({
  schemaVersion: z.literal(1),
  resource: GatewayResource,
  tenantId: zTenantId,
  clientId: zClientId.optional(),
  params: z.record(z.string(), z.unknown()).default({}),
  correlationId: zCorrelationId,
  idempotencyKey: zIdempotencyKey.optional(),
  issuedAt: zIsoTimestamp,
});
export type GatewayRequestV1 = z.infer<typeof GatewayRequestV1>;

export const GatewayResponseV1 = z.object({
  schemaVersion: z.literal(1),
  ok: z.boolean(),
  resource: GatewayResource,
  correlationId: zCorrelationId,
  freshness: Freshness.default("unknown"),
  /** Resource-specific payload; validated per-resource by the caller. */
  data: z.unknown().optional(),
  dataGaps: z.array(DataGapV1).default([]),
  /** Present when ok=false. */
  error: z.string().optional(),
});
export type GatewayResponseV1 = z.infer<typeof GatewayResponseV1>;
