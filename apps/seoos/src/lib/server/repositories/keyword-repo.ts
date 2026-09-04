import { KeywordV1 } from "@/src/lib/domain/keyword";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoKeywords";

export interface KeywordRepo {
  listByProject(tenantId: string, projectId: string): Promise<KeywordV1[]>;
  get(tenantId: string, keywordId: string): Promise<KeywordV1 | null>;
  findByNormalized(
    tenantId: string,
    projectId: string,
    normalized: string,
  ): Promise<KeywordV1 | null>;
  save(keyword: KeywordV1): Promise<KeywordV1>;
  saveMany(keywords: KeywordV1[]): Promise<void>;
}

class InMemoryKeywordRepo implements KeywordRepo {
  async listByProject(tenantId: string, projectId: string) {
    return seedStore.keywords
      .filter((k) => k.tenantId === tenantId && k.projectId === projectId)
      .sort((a, b) => a.normalizedPhrase.localeCompare(b.normalizedPhrase));
  }
  async get(tenantId: string, keywordId: string) {
    return (
      seedStore.keywords.find((k) => k.tenantId === tenantId && k.id === keywordId) ?? null
    );
  }
  async findByNormalized(tenantId: string, projectId: string, normalized: string) {
    return (
      seedStore.keywords.find(
        (k) => k.tenantId === tenantId && k.projectId === projectId && k.normalizedPhrase === normalized,
      ) ?? null
    );
  }
  async save(keyword: KeywordV1) {
    const idx = seedStore.keywords.findIndex(
      (k) => k.tenantId === keyword.tenantId && k.id === keyword.id,
    );
    if (idx >= 0) seedStore.keywords[idx] = keyword;
    else seedStore.keywords.push(keyword);
    return keyword;
  }
  async saveMany(keywords: KeywordV1[]) {
    for (const k of keywords) await this.save(k);
  }
}

class FirestoreKeywordRepo implements KeywordRepo {
  async listByProject(tenantId: string, projectId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION)
      .where("projectId", "==", projectId)
      .get();
    return snap.docs
      .map((d) => KeywordV1.safeParse(d.data()))
      .filter((r) => r.success)
      .map((r) => r.data)
      .sort((a, b) => a.normalizedPhrase.localeCompare(b.normalizedPhrase));
  }
  async get(tenantId: string, keywordId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(keywordId).get();
    if (!snap.exists) return null;
    const parsed = KeywordV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async findByNormalized(tenantId: string, projectId: string, normalized: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION)
      .where("projectId", "==", projectId)
      .where("normalizedPhrase", "==", normalized)
      .limit(1)
      .get();
    const doc = snap.docs[0];
    if (!doc) return null;
    const parsed = KeywordV1.safeParse(doc.data());
    return parsed.success ? parsed.data : null;
  }
  async save(keyword: KeywordV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, keyword.tenantId, COLLECTION).doc(keyword.id).set(keyword);
    return keyword;
  }
  async saveMany(keywords: KeywordV1[]) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    // Commit in chunks of 400 (Firestore's 500-write batch limit).
    for (let i = 0; i < keywords.length; i += 400) {
      const batch = db.batch();
      for (const k of keywords.slice(i, i + 400)) {
        batch.set(tenantCollection(db, k.tenantId, COLLECTION).doc(k.id), k);
      }
      await batch.commit();
    }
  }
}

export function getKeywordRepo(): KeywordRepo {
  return getFirebaseAdminDb() ? new FirestoreKeywordRepo() : new InMemoryKeywordRepo();
}
