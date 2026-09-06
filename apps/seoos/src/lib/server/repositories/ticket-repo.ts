import { TicketV1 } from "@/src/lib/domain/ticket";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoTickets";

export interface TicketRepo {
  listByTenant(tenantId: string): Promise<TicketV1[]>;
  listByProject(tenantId: string, projectId: string): Promise<TicketV1[]>;
  get(tenantId: string, id: string): Promise<TicketV1 | null>;
  getByExternalId(tenantId: string, externalId: string): Promise<TicketV1 | null>;
  save(ticket: TicketV1): Promise<TicketV1>;
  saveMany(tickets: TicketV1[]): Promise<void>;
}

class InMemoryTicketRepo implements TicketRepo {
  async listByTenant(tenantId: string) {
    return seedStore.tickets.filter((t) => t.tenantId === tenantId);
  }
  async listByProject(tenantId: string, projectId: string) {
    return seedStore.tickets.filter((t) => t.tenantId === tenantId && t.projectId === projectId);
  }
  async get(tenantId: string, id: string) {
    return seedStore.tickets.find((t) => t.tenantId === tenantId && t.id === id) ?? null;
  }
  async getByExternalId(tenantId: string, externalId: string) {
    return (
      seedStore.tickets.find((t) => t.tenantId === tenantId && t.externalId === externalId) ?? null
    );
  }
  async save(ticket: TicketV1) {
    const i = seedStore.tickets.findIndex(
      (t) => t.tenantId === ticket.tenantId && t.id === ticket.id,
    );
    if (i >= 0) seedStore.tickets[i] = ticket;
    else seedStore.tickets.push(ticket);
    return ticket;
  }
  async saveMany(tickets: TicketV1[]) {
    for (const t of tickets) await this.save(t);
  }
}

class FirestoreTicketRepo implements TicketRepo {
  async listByTenant(tenantId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION).get();
    return snap.docs
      .map((d) => TicketV1.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data);
  }
  async listByProject(tenantId: string, projectId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION)
      .where("projectId", "==", projectId)
      .get();
    return snap.docs
      .map((d) => TicketV1.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data);
  }
  async get(tenantId: string, id: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(id).get();
    if (!snap.exists) return null;
    const parsed = TicketV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async getByExternalId(tenantId: string, externalId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION)
      .where("externalId", "==", externalId)
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (!doc) return null;
    const parsed = TicketV1.safeParse(doc.data());
    return parsed.success ? parsed.data : null;
  }
  async save(ticket: TicketV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, ticket.tenantId, COLLECTION).doc(ticket.id).set(ticket);
    return ticket;
  }
  async saveMany(tickets: TicketV1[]) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    // Batched writes (Firestore caps a batch at 500).
    for (let i = 0; i < tickets.length; i += 450) {
      const batch = db.batch();
      for (const t of tickets.slice(i, i + 450)) {
        batch.set(tenantCollection(db, t.tenantId, COLLECTION).doc(t.id), t);
      }
      await batch.commit();
    }
  }
}

let repo: TicketRepo | null = null;
export function getTicketRepo(): TicketRepo {
  if (repo) return repo;
  repo = getFirebaseAdminDb() ? new FirestoreTicketRepo() : new InMemoryTicketRepo();
  return repo;
}
