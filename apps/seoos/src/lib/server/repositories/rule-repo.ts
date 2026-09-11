import { RuleV1 } from "@/src/lib/domain/rule";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

const COLLECTION = "seoRules";

export interface RuleRepo {
  list(tenantId: string): Promise<RuleV1[]>;
  get(tenantId: string, key: string): Promise<RuleV1 | null>;
  save(rule: RuleV1): Promise<RuleV1>;
  remove(tenantId: string, key: string): Promise<void>;
}

class InMemoryRuleRepo implements RuleRepo {
  async list(tenantId: string) { return seedStore.rules.filter((r) => r.tenantId === tenantId); }
  async get(tenantId: string, key: string) {
    return seedStore.rules.find((r) => r.tenantId === tenantId && r.key === key) ?? null;
  }
  async save(rule: RuleV1) {
    const i = seedStore.rules.findIndex((r) => r.tenantId === rule.tenantId && r.key === rule.key);
    if (i >= 0) seedStore.rules[i] = rule; else seedStore.rules.push(rule);
    return rule;
  }
  async remove(tenantId: string, key: string) {
    seedStore.rules = seedStore.rules.filter((r) => !(r.tenantId === tenantId && r.key === key));
  }
}

class FirestoreRuleRepo implements RuleRepo {
  async list(tenantId: string) {
    const db = getFirebaseAdminDb();
    if (!db) return [];
    const snap = await tenantCollection(db, tenantId, COLLECTION).get();
    return snap.docs.map((d) => RuleV1.safeParse(d.data())).filter((r) => r.success).map((r) => r.data);
  }
  async get(tenantId: string, key: string) {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    // Firestore doc ids can't contain "/", but rule keys use "." — safe as-is.
    const snap = await tenantCollection(db, tenantId, COLLECTION).doc(docId(key)).get();
    if (!snap.exists) return null;
    const parsed = RuleV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
  async save(rule: RuleV1) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, rule.tenantId, COLLECTION).doc(docId(rule.key)).set(rule);
    return rule;
  }
  async remove(tenantId: string, key: string) {
    const db = getFirebaseAdminDb();
    if (!db) throw new Error("Firestore unavailable");
    await tenantCollection(db, tenantId, COLLECTION).doc(docId(key)).delete();
  }
}

/** Rule keys are dotted (e.g. "gbp.description.char_target"); Firestore doc ids only forbid "/". */
function docId(key: string): string {
  return key.replace(/\//g, "_");
}

export function getRuleRepo(): RuleRepo {
  return getFirebaseAdminDb() ? new FirestoreRuleRepo() : new InMemoryRuleRepo();
}
