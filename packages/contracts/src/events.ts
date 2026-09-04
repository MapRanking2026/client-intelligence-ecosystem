import { z } from "zod";
import {
  zClientId,
  zCorrelationId,
  zId,
  zIdempotencyKey,
  zIsoTimestamp,
  zTenantId,
} from "./common";

/**
 * Domain events delivered through a durable Firestore outbox (at-least-once,
 * with retry/next-attempt/dead-letter bookkeeping on the envelope).
 */

export const SeoEventType = z.enum([
  "SeoRequestSubmitted",
  "SeoRequestNeedsInput",
  "SeoRequestFailed",
  "SeoPackageReady",
  "SeoPackageDelivered",
  "SeoSignificantChangeDetected",
]);
export type SeoEventType = z.infer<typeof SeoEventType>;

/** Delivery bookkeeping carried by every outbox row. */
export const OutboxDeliveryV1 = z.object({
  attempts: z.number().int().min(0).default(0),
  nextAttemptAt: zIsoTimestamp.nullable().default(null),
  lastError: z.string().max(1000).nullable().default(null),
  deadLettered: z.boolean().default(false),
});
export type OutboxDeliveryV1 = z.infer<typeof OutboxDeliveryV1>;

export const OutboxEventV1 = z.object({
  schemaVersion: z.literal(1),
  id: zId,
  type: SeoEventType,
  tenantId: zTenantId,
  clientId: zClientId.optional(),
  /** Subject the event is about (e.g. requestId or packageId). */
  subjectId: zId,
  correlationId: zCorrelationId,
  idempotencyKey: zIdempotencyKey,
  occurredAt: zIsoTimestamp,
  /** Event-type-specific, non-sensitive payload. */
  payload: z.record(z.string(), z.unknown()).default({}),
  delivery: OutboxDeliveryV1.default({
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    deadLettered: false,
  }),
});
export type OutboxEventV1 = z.infer<typeof OutboxEventV1>;
