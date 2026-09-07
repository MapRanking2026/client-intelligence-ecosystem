import { ClientBrain, FirestoreClientStore, InMemoryClientStore } from "@cie/brain";
import type { NormalizedClientInput } from "@cie/contracts";

import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import type { RosterClient } from "@/src/lib/server/sync/clickup-clients";

/**
 * SEOOS's handle on the shared Client Brain. The brain is a shared in-monorepo
 * module (@cie/brain); we inject SEOOS's Firestore so the brain never owns
 * Firebase init. Falls back to in-memory when Firestore isn't configured.
 */
let brain: ClientBrain | null = null;
export function getClientBrain(): ClientBrain {
  if (brain) return brain;
  const db = getFirebaseAdminDb();
  brain = new ClientBrain(db ? new FirestoreClientStore(db) : new InMemoryClientStore());
  return brain;
}

/** Map SEOOS's ClickUp SEO Dashboard roster into canonical brain inputs. */
export function rosterToInputs(clients: RosterClient[]): NormalizedClientInput[] {
  return clients.map((c) => ({
    source: "clickup:seo-dashboard",
    sourceRecordId: c.taskId,
    businessName: c.name,
    website: c.website,
    niche: c.niche,
    locations: c.location ? [c.location] : [],
    status: c.status,
    packageName: c.serviceTier,
    accountManager: c.accountManager,
    // Native ClickUp assignee is the authoritative specialist, else ⭐ Responsable.
    seoSpecialist: c.assignedTo || c.seoSpecialist,
    pod: c.pod,
    healthScore: c.health,
    externalIds: { clickupTaskId: c.taskId },
    metrics: c.metrics ?? {},
  }));
}
