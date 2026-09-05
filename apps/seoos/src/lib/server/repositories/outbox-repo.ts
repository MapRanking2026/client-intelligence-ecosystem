import { OutboxEventV1 } from "@cie/contracts";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoOutbox";

/** Durable outbox for reliable at-least-once event delivery. */
export interface OutboxRepo {
  enqueue(event: OutboxEventV1): Promise<OutboxEventV1>;
  /** Pending, non-dead-lettered events whose nextAttemptAt is due (or null). */
  claimDue(tenantId: string | null, nowIso: string, limit: number): Promise<OutboxEventV1[]>;
  save(event: OutboxEventV1): Promise<OutboxEventV1>;
  list(tenantId: string): Promise<OutboxEventV1[]>;
}

function isDue(e: OutboxEventV1, nowIso: string): boolean {
  if (e.delivery.deadLettered || e.delivery.deliveredAt) return false;
  return e.delivery.nextAttemptAt == null || e.delivery.nextAttemptAt <= nowIso;
}

class InMemoryOutboxRepo implements OutboxRepo {
  async enqueue(event: OutboxEventV1) {
    seedStore.outbox.push(event);
    return event;
  }
  async claimDue(tenantId: string | null, nowIso: string, limit: number) {
    return seedStore.outbox
      .filter((e) => (tenantId ? e.tenantId === tenantId : true) && isDue(e, nowIso))
      .slice(0, limit);
  }
  async save(event: OutboxEventV1) {
    const idx = seedStore.outbox.findIndex((e) => e.id === event.id);
    if (idx >= 0) seedStore.outbox[idx] = event;
    else seedStore.outbox.push(event);
    return event;
  }
  async list(tenantId: string) {
    return seedStore.outbox
      .filter((e) => e.tenantId === tenantId)
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  }
}

class FirestoreOutboxRepo implements OutboxRepo {
  async enqueue(event: OutboxEventV1) {
    return this.save(event);
  }
  async claimDue(tenantId: string | null, nowIso: string, limit: number) {
    const db = getFirebaseAdminDb();
    if (!db || !tenantId) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION).get();
    return snap.docs
      .map((d) => OutboxEventV1.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data)
      .filter((e) => isDue(e, nowIso))
      .slice(0, limit);
  }
  async save(event: OutboxEventV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, event.tenantId, COLLECTION).doc(event.id).set(event);
    return event;
  }
  async list(tenantId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION).get();
    return snap.docs
      .map((d) => OutboxEventV1.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data)
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  }
}

export function getOutboxRepo(): OutboxRepo {
  return getFirebaseAdminDb() ? new FirestoreOutboxRepo() : new InMemoryOutboxRepo();
}
