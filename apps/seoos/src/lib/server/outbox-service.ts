import {
  OutboxEventV1,
  type SeoIntelligencePackageV1,
  type SeoIntelligenceRequestV1,
} from "@cie/contracts";
import { newId, nowIso } from "@/src/lib/ids";
import { getOutboxRepo } from "@/src/lib/server/repositories/outbox-repo";
import { deliverToMtos } from "@/src/lib/server/gateway/client";

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 3_600_000;

/** Enqueue a durable SeoPackageReady event for delivery to MTOS. */
export async function enqueuePackageReady(
  request: SeoIntelligenceRequestV1,
  pkg: SeoIntelligencePackageV1,
): Promise<void> {
  const event = OutboxEventV1.parse({
    schemaVersion: 1,
    id: newId("evt"),
    type: "SeoPackageReady",
    tenantId: pkg.tenantId,
    clientId: pkg.clientId,
    subjectId: pkg.id,
    correlationId: pkg.correlationId,
    // Dedup key ensures redelivery + duplicate enqueues collapse downstream.
    idempotencyKey: `deliver:${pkg.idempotencyKey}`,
    occurredAt: nowIso(),
    payload: {
      requestId: request.id,
      packageId: pkg.id,
      version: pkg.version,
      capability: pkg.capability,
    },
  });
  await getOutboxRepo().enqueue(event);
}

export interface DeliveryRunResult {
  attempted: number;
  delivered: number;
  failed: number;
  deadLettered: number;
}

function backoffIso(nowMs: number, attempts: number): string {
  const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempts);
  return new Date(nowMs + delay).toISOString();
}

/**
 * Deliver due outbox events. At-least-once: on failure we retry with
 * exponential backoff and dead-letter after MAX_ATTEMPTS. MTOS dedups by
 * idempotencyKey, so redelivery is safe.
 */
export async function runOutboxDelivery(
  tenantId: string | null,
  nowMs: number,
  limit = 20,
): Promise<DeliveryRunResult> {
  const repo = getOutboxRepo();
  const due = await repo.claimDue(tenantId, new Date(nowMs).toISOString(), limit);
  const result: DeliveryRunResult = { attempted: 0, delivered: 0, failed: 0, deadLettered: 0 };

  for (const event of due) {
    result.attempted += 1;
    const outcome = await deliverToMtos(event);
    if (outcome.ok) {
      await repo.save({
        ...event,
        delivery: { ...event.delivery, deliveredAt: nowIso(), nextAttemptAt: null, lastError: null },
      });
      result.delivered += 1;
      continue;
    }
    const attempts = event.delivery.attempts + 1;
    const dead = attempts >= MAX_ATTEMPTS;
    await repo.save({
      ...event,
      delivery: {
        ...event.delivery,
        attempts,
        lastError: outcome.error ?? "delivery_failed",
        deadLettered: dead,
        nextAttemptAt: dead ? null : backoffIso(nowMs, attempts),
      },
    });
    if (dead) result.deadLettered += 1;
    else result.failed += 1;
  }
  return result;
}

export async function listOutbox(tenantId: string) {
  return getOutboxRepo().list(tenantId);
}
