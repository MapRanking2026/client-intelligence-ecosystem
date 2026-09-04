import {
  SeoIntelligencePackageV1,
  SeoIntelligenceRequestV1,
} from "@cie/contracts";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { COLLECTIONS, tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

type Request = SeoIntelligenceRequestV1;
type Package = SeoIntelligencePackageV1;

/**
 * SEO request + immutable package store. Requests are keyed by id; packages are
 * append-only versions per request (corrections add a version, never mutate).
 */
export interface RequestRepo {
  listRequests(tenantId: string): Promise<Request[]>;
  getRequest(tenantId: string, requestId: string): Promise<Request | null>;
  findRequestByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<Request | null>;
  saveRequest(request: Request): Promise<Request>;
  listPackages(tenantId: string, requestId: string): Promise<Package[]>;
  getLatestPackage(
    tenantId: string,
    requestId: string,
  ): Promise<Package | null>;
  savePackage(pkg: Package): Promise<Package>;
}

class InMemoryRequestRepo implements RequestRepo {
  async listRequests(tenantId: string) {
    return seedStore.requests
      .filter((r) => r.tenantId === tenantId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async getRequest(tenantId: string, requestId: string) {
    return (
      seedStore.requests.find(
        (r) => r.tenantId === tenantId && r.id === requestId,
      ) ?? null
    );
  }
  async findRequestByIdempotencyKey(tenantId: string, key: string) {
    return (
      seedStore.requests.find(
        (r) => r.tenantId === tenantId && r.idempotencyKey === key,
      ) ?? null
    );
  }
  async saveRequest(request: Request) {
    const idx = seedStore.requests.findIndex(
      (r) => r.tenantId === request.tenantId && r.id === request.id,
    );
    if (idx >= 0) seedStore.requests[idx] = request;
    else seedStore.requests.push(request);
    return request;
  }
  async listPackages(tenantId: string, requestId: string) {
    return seedStore.packages
      .filter((p) => p.tenantId === tenantId && p.requestId === requestId)
      .sort((a, b) => a.version - b.version);
  }
  async getLatestPackage(tenantId: string, requestId: string) {
    const versions = await this.listPackages(tenantId, requestId);
    return versions.length ? versions[versions.length - 1] : null;
  }
  async savePackage(pkg: Package) {
    seedStore.packages.push(pkg);
    return pkg;
  }
}

class FirestoreRequestRepo implements RequestRepo {
  async listRequests(tenantId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTIONS.requests)
      .orderBy("createdAt", "desc")
      .get();
    return snap.docs
      .map((d) => SeoIntelligenceRequestV1.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data);
  }
  async getRequest(tenantId: string, requestId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTIONS.requests)
      .doc(requestId)
      .get();
    if (!snap.exists) return null;
    const parsed = SeoIntelligenceRequestV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async findRequestByIdempotencyKey(tenantId: string, key: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTIONS.requests)
      .where("idempotencyKey", "==", key)
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (!doc) return null;
    const parsed = SeoIntelligenceRequestV1.safeParse(doc.data());
    return parsed.success ? parsed.data : null;
  }
  async saveRequest(request: Request) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, request.tenantId, COLLECTIONS.requests)
      .doc(request.id)
      .set(request);
    return request;
  }
  async listPackages(tenantId: string, requestId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTIONS.packages)
      .where("requestId", "==", requestId)
      .get();
    return snap.docs
      .map((d) => SeoIntelligencePackageV1.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data)
      .sort((a, b) => a.version - b.version);
  }
  async getLatestPackage(tenantId: string, requestId: string) {
    const versions = await this.listPackages(tenantId, requestId);
    return versions.length ? versions[versions.length - 1] : null;
  }
  async savePackage(pkg: Package) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    // Immutable: packages are keyed by their own id and never overwritten.
    await tenantCollection(db, pkg.tenantId, COLLECTIONS.packages)
      .doc(pkg.id)
      .create(pkg);
    return pkg;
  }
}

export function getRequestRepo(): RequestRepo {
  return getFirebaseAdminDb()
    ? new FirestoreRequestRepo()
    : new InMemoryRequestRepo();
}
