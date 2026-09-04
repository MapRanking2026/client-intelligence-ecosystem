import { AppMembershipV1 } from "@cie/contracts";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { COLLECTIONS, tenantCollection } from "./firestore-helpers";
import { seedStore } from "@/src/lib/server/seed";

/**
 * App-membership store. A user's SEOOS membership is looked up here; absence
 * means no SEOOS access (memberships are additive — never implicit).
 */
export interface MembershipRepo {
  getForUser(
    tenantId: string,
    userId: string,
    app: "mtos" | "seoos",
  ): Promise<AppMembershipV1 | null>;
}

const docId = (app: string, userId: string) => `${app}__${userId}`;

class InMemoryMembershipRepo implements MembershipRepo {
  async getForUser(tenantId: string, userId: string, app: "mtos" | "seoos") {
    return (
      seedStore.memberships.find(
        (m) => m.tenantId === tenantId && m.userId === userId && m.app === app,
      ) ?? null
    );
  }
}

class FirestoreMembershipRepo implements MembershipRepo {
  async getForUser(tenantId: string, userId: string, app: "mtos" | "seoos") {
    const db = getFirebaseAdminDb();
    if (!db) return null;
    const snap = await tenantCollection(db, tenantId, COLLECTIONS.memberships)
      .doc(docId(app, userId))
      .get();
    if (!snap.exists) return null;
    const parsed = AppMembershipV1.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  }
}

export function getMembershipRepo(): MembershipRepo {
  return getFirebaseAdminDb()
    ? new FirestoreMembershipRepo()
    : new InMemoryMembershipRepo();
}
