import { z } from "zod";

import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "@/src/lib/server/repositories/firestore-helpers";
import {
  AivAgencySettingsV1,
  AivAttemptV1,
  AivAuditEventV1,
  AivEvidenceFileV1,
  AivJobV1,
  AivObservationV1,
  AivProfileV1,
  AivPromptV1,
  AivProviderSettingsV1,
  AivScanV1,
} from "@/src/lib/ai-visibility/types";

/**
 * Tenant-scoped document store for the AI Visibility Tracker.
 *
 * Firestore (`tenants/{tenantId}/{collection}/{id}`) when Firebase admin is
 * configured, otherwise an in-process memory store (dev only — not durable).
 * Queries are limited to single-field equality so no composite indexes are
 * needed. Every read is schema-validated; invalid docs are skipped, not trusted.
 */

export interface DocRepo<T> {
  readonly name: string;
  get(tenantId: string, id: string): Promise<T | null>;
  list(tenantId: string): Promise<T[]>;
  listWhere(tenantId: string, field: string, value: string | number | boolean): Promise<T[]>;
  set(tenantId: string, id: string, doc: T): Promise<T>;
  /** Write only if no doc exists with this id. Returns true when created. */
  createIfAbsent(tenantId: string, id: string, doc: T): Promise<boolean>;
  /**
   * Atomic read-modify-write. `fn` receives the current doc (or null) and returns
   * the doc to write (or null for no write) plus a result.
   */
  transact<R>(tenantId: string, id: string, fn: (cur: T | null) => { next: T | null; result: R }): Promise<R>;
  delete(tenantId: string, id: string): Promise<void>;
}

type Schema<T> = z.ZodType<T>;

/* ------------------------------ memory -------------------------------- */

type MemTables = Map<string, Map<string, unknown>>;
const g = globalThis as unknown as { __aivMem?: MemTables };
function mem(): MemTables {
  if (!g.__aivMem) g.__aivMem = new Map();
  return g.__aivMem;
}

/** Test helper: wipe the memory store. */
export function resetMemoryStore(): void {
  g.__aivMem = new Map();
}

class MemoryRepo<T> implements DocRepo<T> {
  constructor(readonly name: string, private schema: Schema<T>) {}
  private table(tenantId: string) {
    const key = `${tenantId}/${this.name}`;
    let t = mem().get(key);
    if (!t) {
      t = new Map();
      mem().set(key, t);
    }
    return t as Map<string, unknown>;
  }
  private parse(v: unknown): T | null {
    const r = this.schema.safeParse(v);
    return r.success ? r.data : null;
  }
  async get(tenantId: string, id: string) {
    const v = this.table(tenantId).get(id);
    return v === undefined ? null : this.parse(structuredClone(v));
  }
  async list(tenantId: string) {
    return [...this.table(tenantId).values()].map((v) => this.parse(structuredClone(v))).filter((x): x is T => x !== null);
  }
  async listWhere(tenantId: string, field: string, value: string | number | boolean) {
    return (await this.list(tenantId)).filter((d) => (d as Record<string, unknown>)[field] === value);
  }
  async set(tenantId: string, id: string, doc: T) {
    this.table(tenantId).set(id, structuredClone(this.schema.parse(doc)));
    return doc;
  }
  async createIfAbsent(tenantId: string, id: string, doc: T) {
    const t = this.table(tenantId);
    if (t.has(id)) return false;
    t.set(id, structuredClone(this.schema.parse(doc)));
    return true;
  }
  async transact<R>(tenantId: string, id: string, fn: (cur: T | null) => { next: T | null; result: R }) {
    // Synchronous critical section: no await between read and write.
    const t = this.table(tenantId);
    const raw = t.get(id);
    const cur = raw === undefined ? null : this.parse(structuredClone(raw));
    const { next, result } = fn(cur);
    if (next) t.set(id, structuredClone(this.schema.parse(next)));
    return result;
  }
  async delete(tenantId: string, id: string) {
    this.table(tenantId).delete(id);
  }
}

/* ----------------------------- firestore ------------------------------ */

function stripUndefined<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

class FirestoreRepo<T> implements DocRepo<T> {
  constructor(readonly name: string, private schema: Schema<T>) {}
  private col(tenantId: string) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    return tenantCollection(db, tenantId, this.name);
  }
  private parse(v: unknown): T | null {
    const r = this.schema.safeParse(v);
    return r.success ? r.data : null;
  }
  async get(tenantId: string, id: string) {
    const snap = await this.col(tenantId).doc(id).get();
    return snap.exists ? this.parse(snap.data()) : null;
  }
  async list(tenantId: string) {
    const snap = await this.col(tenantId).get();
    return snap.docs.map((d) => this.parse(d.data())).filter((x): x is T => x !== null);
  }
  async listWhere(tenantId: string, field: string, value: string | number | boolean) {
    const snap = await this.col(tenantId).where(field, "==", value).get();
    return snap.docs.map((d) => this.parse(d.data())).filter((x): x is T => x !== null);
  }
  async set(tenantId: string, id: string, doc: T) {
    await this.col(tenantId).doc(id).set(stripUndefined(this.schema.parse(doc)) as FirebaseFirestore.DocumentData);
    return doc;
  }
  async createIfAbsent(tenantId: string, id: string, doc: T) {
    try {
      await this.col(tenantId).doc(id).create(stripUndefined(this.schema.parse(doc)) as FirebaseFirestore.DocumentData);
      return true;
    } catch (e) {
      // gRPC ALREADY_EXISTS = 6
      if ((e as { code?: number }).code === 6) return false;
      throw e;
    }
  }
  async transact<R>(tenantId: string, id: string, fn: (cur: T | null) => { next: T | null; result: R }) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    const ref = this.col(tenantId).doc(id);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? this.parse(snap.data()) : null;
      const { next, result } = fn(cur);
      if (next) tx.set(ref, stripUndefined(this.schema.parse(next)) as FirebaseFirestore.DocumentData);
      return result;
    });
  }
  async delete(tenantId: string, id: string) {
    await this.col(tenantId).doc(id).delete();
  }
}

function repo<T>(name: string, schema: Schema<T>): () => DocRepo<T> {
  let cached: { firestore: boolean; r: DocRepo<T> } | null = null;
  return () => {
    const firestore = Boolean(getFirebaseAdminDb());
    if (!cached || cached.firestore !== firestore) {
      cached = { firestore, r: firestore ? new FirestoreRepo(name, schema) : new MemoryRepo(name, schema) };
    }
    return cached.r;
  };
}

export function storeBackend(): "firestore" | "memory" {
  return getFirebaseAdminDb() ? "firestore" : "memory";
}

export const profiles = repo("aivProfiles", AivProfileV1);
export const prompts = repo("aivPrompts", AivPromptV1);
export const scans = repo("aivScans", AivScanV1);
export const jobs = repo("aivJobs", AivJobV1);
export const attempts = repo("aivAttempts", AivAttemptV1);
export const observations = repo("aivObservations", AivObservationV1);
export const providerSettings = repo("aivProviderSettings", AivProviderSettingsV1);
export const agencySettings = repo("aivAgencySettings", AivAgencySettingsV1);
export const auditEvents = repo("aivAuditEvents", AivAuditEventV1);
export const evidenceFiles = repo("aivEvidenceFiles", AivEvidenceFileV1);

/** Spend ledger: one doc per (scope, month) with an atomically incremented total. */
export const SpendDocV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: z.string(),
  scope: z.string(),
  month: z.string(),
  calculatedUsd: z.number().min(0).default(0),
  /** In-flight upper-bound reservations not yet reconciled. */
  reservedUsd: z.number().min(0).default(0),
  updatedAt: z.string(),
});
export type SpendDocV1 = z.infer<typeof SpendDocV1>;
export const spend = repo("aivSpend", SpendDocV1);
