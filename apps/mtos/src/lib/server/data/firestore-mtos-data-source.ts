import type {
  ClientRecord,
  CommitmentRecord,
  MonthlyTouchRecord,
  OpportunityRecord,
} from "@/src/lib/mtos-data";
import type { SyncedClientRecord } from "@/src/lib/contracts/client-sync";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { CommandCenterSnapshot, MtosDataSource } from "@/src/lib/server/data/mtos-data-source";
import {
  clientsCollectionPath,
  commitmentsCollectionPath,
  monthlyTouchPath,
  monthlyTouchesCollectionPath,
  opportunitiesCollectionPath,
  tenantUserSyncedClientsCollectionPath,
} from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";

type FirestoreClientRecord = ClientRecord & { id: string };
type FirestoreMonthlyTouchRecord = MonthlyTouchRecord & { id: string };
type FirestoreCommitmentRecord = CommitmentRecord & { id: string };
type FirestoreOpportunityRecord = OpportunityRecord & { id: string };

function isQuotaExceededError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("RESOURCE_EXHAUSTED") ||
    error.message.includes("Quota exceeded")
  );
}

export class FirestoreMtosDataSource implements MtosDataSource {
  private visibleClientIdsPromise: Promise<string[] | null> | null = null;

  constructor(private context: TenantContext) {}

  private get tenantId() {
    return this.context.tenantId;
  }

  private async withQuotaFallback<T>(label: string, fallback: T, operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (isQuotaExceededError(error)) {
        console.warn(
          `Firestore quota exceeded while loading ${label} for ${this.tenantId}/${this.context.userId}. Returning a safe fallback.`,
        );
        return fallback;
      }

      throw error;
    }
  }

  private async getVisibleClientIds(): Promise<string[] | null> {
    if (this.visibleClientIdsPromise) {
      return this.visibleClientIdsPromise;
    }

    this.visibleClientIdsPromise = this.loadVisibleClientIds();
    return this.visibleClientIdsPromise;
  }

  private async loadVisibleClientIds(): Promise<string[] | null> {
    const db = getFirebaseAdminDb();
    if (!db || !this.context.userId || this.context.userId === "unknown") {
      return null;
    }

    return this.withQuotaFallback("synced client visibility", [], async () => {
      const snapshot = await db
        .collection(tenantUserSyncedClientsCollectionPath(this.tenantId, this.context.userId))
        .orderBy("syncedAt", "desc")
        .get();

      if (snapshot.empty) {
        return [];
      }

      return Array.from(
        new Set(
          snapshot.docs
            .map((doc) => doc.data() as SyncedClientRecord)
            .map((record) => record.clientId)
            .filter(Boolean),
        ),
      );
    });
  }

  private async isClientVisible(clientId: string) {
    const visibleClientIds = await this.getVisibleClientIds();
    if (visibleClientIds === null) {
      return true;
    }
    return visibleClientIds.includes(clientId);
  }

  async getCommandCenterSnapshot(): Promise<CommandCenterSnapshot> {
    const db = getFirebaseAdminDb();
    if (!db) {
      return {
        focusDate: "Unavailable",
        priorities: [],
        alerts: [],
      };
    }

    const today = new Date();
    const focusDate = today.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "2-digit",
    });

    const visibleClientIds = await this.getVisibleClientIds();
    if (Array.isArray(visibleClientIds) && visibleClientIds.length === 0) {
      return {
        focusDate,
        priorities: [],
        alerts: [],
      };
    }

    const [touchesSnap, commitmentsSnap] = await this.withQuotaFallback<
      readonly [FirebaseFirestore.QuerySnapshot | null, FirebaseFirestore.QuerySnapshot | null]
    >(
      "command center source collections",
      [null, null] as const,
      async () =>
        Promise.all([
          db.collection(monthlyTouchesCollectionPath(this.tenantId)).limit(12).get(),
          db.collection(commitmentsCollectionPath(this.tenantId)).limit(50).get(),
        ]) as Promise<readonly [FirebaseFirestore.QuerySnapshot | null, FirebaseFirestore.QuerySnapshot | null]>,
    );

    if (!touchesSnap || !commitmentsSnap) {
      return {
        focusDate,
        priorities: [],
        alerts: [],
      };
    }

    const visibleSet = visibleClientIds ? new Set(visibleClientIds) : null;
    const touches = touchesSnap.docs
      .map((doc) => doc.data() as FirestoreMonthlyTouchRecord)
      .filter((touch) => !visibleSet || visibleSet.has(touch.clientId));
    const commitments = commitmentsSnap.docs
      .map((doc) => doc.data() as FirestoreCommitmentRecord)
      .filter((commitment) => !visibleSet || visibleSet.has(commitment.clientId));

    const meetingPrepIncomplete = touches.filter((touch) => touch.status !== "Ready").length;
    const overdueCommitments = commitments.filter((commitment) => commitment.status === "Overdue").length;

    const alerts: CommandCenterSnapshot["alerts"] = [];
    if (meetingPrepIncomplete) {
      alerts.push({
        label: `${meetingPrepIncomplete} meeting prep incomplete`,
        tone: "warning",
      });
    }
    if (overdueCommitments) {
      alerts.push({
        label: `${overdueCommitments} overdue commitment`,
        tone: "danger",
      });
    }

    return {
      focusDate,
      priorities: [],
      alerts,
    };
  }

  async getClients(): Promise<ClientRecord[]> {
    const db = getFirebaseAdminDb();
    if (!db) {
      return [];
    }
    const [snapshot, visibleClientIds] = await this.withQuotaFallback<
      readonly [FirebaseFirestore.QuerySnapshot | null, string[] | null]
    >(
      "clients collection",
      [null, [] as string[] | null] as const,
      async () =>
        Promise.all([
          db.collection(clientsCollectionPath(this.tenantId)).get(),
          this.getVisibleClientIds(),
        ]) as Promise<readonly [FirebaseFirestore.QuerySnapshot | null, string[] | null]>,
    );
    if (!snapshot) {
      return [];
    }
    const clients = snapshot.docs.map((doc) => doc.data() as FirestoreClientRecord);
    if (visibleClientIds === null) {
      return clients;
    }
    if (visibleClientIds.length === 0) {
      return [];
    }
    const visibleSet = new Set(visibleClientIds);
    return clients
      .filter((client) => visibleSet.has(client.id))
      .sort((left, right) => visibleClientIds.indexOf(left.id) - visibleClientIds.indexOf(right.id));
  }

  async getClientById(clientId: string): Promise<ClientRecord | undefined> {
    const db = getFirebaseAdminDb();
    if (!db) {
      return undefined;
    }
    const visible = await this.isClientVisible(clientId);
    if (!visible) {
      return undefined;
    }
    const snapshot = await this.withQuotaFallback(
      `client ${clientId}`,
      null as FirebaseFirestore.DocumentSnapshot | null,
      () => db.doc(`${clientsCollectionPath(this.tenantId)}/${clientId}`).get(),
    );
    if (!snapshot) {
      return undefined;
    }
    if (!snapshot.exists) {
      return undefined;
    }
    return snapshot.data() as FirestoreClientRecord;
  }

  async getMonthlyTouches(): Promise<MonthlyTouchRecord[]> {
    const db = getFirebaseAdminDb();
    if (!db) {
      return [];
    }
    const [snapshot, visibleClientIds] = await this.withQuotaFallback<
      readonly [FirebaseFirestore.QuerySnapshot | null, string[] | null]
    >(
      "monthly touches collection",
      [null, [] as string[] | null] as const,
      async () =>
        Promise.all([
          db.collection(monthlyTouchesCollectionPath(this.tenantId)).get(),
          this.getVisibleClientIds(),
        ]) as Promise<readonly [FirebaseFirestore.QuerySnapshot | null, string[] | null]>,
    );
    if (!snapshot) {
      return [];
    }
    const touches = snapshot.docs.map((doc) => doc.data() as FirestoreMonthlyTouchRecord);
    if (visibleClientIds === null) {
      return touches;
    }
    const visibleSet = new Set(visibleClientIds);
    return touches.filter((touch) => visibleSet.has(touch.clientId));
  }

  async getMonthlyTouchById(touchId: string): Promise<MonthlyTouchRecord | undefined> {
    const db = getFirebaseAdminDb();
    if (!db) {
      return undefined;
    }
    const snapshot = await this.withQuotaFallback(
      `monthly touch ${touchId}`,
      null as FirebaseFirestore.DocumentSnapshot | null,
      () => db.doc(monthlyTouchPath(this.tenantId, touchId)).get(),
    );
    if (!snapshot) {
      return undefined;
    }
    if (!snapshot.exists) {
      return undefined;
    }
    return snapshot.data() as FirestoreMonthlyTouchRecord;
  }

  async getCommitments(clientId?: string): Promise<CommitmentRecord[]> {
    const db = getFirebaseAdminDb();
    if (!db) {
      return [];
    }

    if (clientId) {
      const visible = await this.isClientVisible(clientId);
      if (!visible) {
        return [];
      }
    }

    const collection = db.collection(commitmentsCollectionPath(this.tenantId));
    const snapshot = await this.withQuotaFallback(
      clientId ? `commitments for ${clientId}` : "commitments collection",
      null as FirebaseFirestore.QuerySnapshot | null,
      () => (clientId ? collection.where("clientId", "==", clientId).get() : collection.get()),
    );
    if (!snapshot) {
      return [];
    }
    const commitments = snapshot.docs.map((doc) => doc.data() as FirestoreCommitmentRecord);
    if (clientId) {
      return commitments;
    }
    const visibleClientIds = await this.getVisibleClientIds();
    if (visibleClientIds === null) {
      return commitments;
    }
    const visibleSet = new Set(visibleClientIds);
    return commitments.filter((commitment) => visibleSet.has(commitment.clientId));
  }

  async getOpportunities(clientId?: string): Promise<OpportunityRecord[]> {
    const db = getFirebaseAdminDb();
    if (!db) {
      return [];
    }

    if (clientId) {
      const visible = await this.isClientVisible(clientId);
      if (!visible) {
        return [];
      }
    }

    const collection = db.collection(opportunitiesCollectionPath(this.tenantId));
    const snapshot = await this.withQuotaFallback(
      clientId ? `opportunities for ${clientId}` : "opportunities collection",
      null as FirebaseFirestore.QuerySnapshot | null,
      () => (clientId ? collection.where("clientId", "==", clientId).get() : collection.get()),
    );
    if (!snapshot) {
      return [];
    }
    const opportunities = snapshot.docs.map((doc) => doc.data() as FirestoreOpportunityRecord);
    if (clientId) {
      return opportunities;
    }
    const visibleClientIds = await this.getVisibleClientIds();
    if (visibleClientIds === null) {
      return opportunities;
    }
    const visibleSet = new Set(visibleClientIds);
    return opportunities.filter((opportunity) => visibleSet.has(opportunity.clientId));
  }
}
