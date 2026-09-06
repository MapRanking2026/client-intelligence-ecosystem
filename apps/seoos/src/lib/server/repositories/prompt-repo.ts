import { PromptV1 } from "@/src/lib/domain/prompt";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoPrompts";

export interface PromptRepo {
  list(tenantId: string): Promise<PromptV1[]>;
  get(tenantId: string, key: string): Promise<PromptV1 | null>;
  save(prompt: PromptV1): Promise<PromptV1>;
  remove(tenantId: string, key: string): Promise<void>;
}

class InMemoryPromptRepo implements PromptRepo {
  async list(tenantId: string) { return seedStore.prompts.filter((p) => p.tenantId === tenantId); }
  async get(tenantId: string, key: string) {
    return seedStore.prompts.find((p) => p.tenantId === tenantId && p.key === key) ?? null;
  }
  async save(prompt: PromptV1) {
    const i = seedStore.prompts.findIndex((p) => p.tenantId === prompt.tenantId && p.key === prompt.key);
    if (i >= 0) seedStore.prompts[i] = prompt; else seedStore.prompts.push(prompt);
    return prompt;
  }
  async remove(tenantId: string, key: string) {
    seedStore.prompts = seedStore.prompts.filter((p) => !(p.tenantId === tenantId && p.key === key));
  }
}

class FirestorePromptRepo implements PromptRepo {
  async list(tenantId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION).get();
    return snap.docs.map((d) => PromptV1.safeParse(d.data())).filter((r) => r.success).map((r) => r.data);
  }
  async get(tenantId: string, key: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(key).get();
    if (!snap.exists) return null;
    const parsed = PromptV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async save(prompt: PromptV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, prompt.tenantId, COLLECTION).doc(prompt.key).set(prompt);
    return prompt;
  }
  async remove(tenantId: string, key: string) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, tenantId, COLLECTION).doc(key).delete();
  }
}

export function getPromptRepo(): PromptRepo {
  return getFirebaseAdminDb() ? new FirestorePromptRepo() : new InMemoryPromptRepo();
}
