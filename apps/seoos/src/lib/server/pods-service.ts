import { SeoPodV1, normalizePodKey } from "@/src/lib/domain/pod";
import { nowIso } from "@/src/lib/ids";
import { getPodRepo } from "@/src/lib/server/repositories/pod-repo";

/**
 * Pod administration. Pods are discovered from ClickUp during a client sync and
 * assigned to SEO specialists here. A specialist sees every client whose pod is
 * assigned to them (see projects-service.listProjectsForViewer).
 */
export async function listPods(tenantId: string): Promise<SeoPodV1[]> {
  const pods = await getPodRepo().list(tenantId);
  return pods.sort((a, b) => a.name.localeCompare(b.name));
}

/** Upsert the set of pod names discovered in ClickUp, preserving assignments. */
export async function upsertDiscoveredPods(tenantId: string, podNames: string[]): Promise<void> {
  const repo = getPodRepo();
  for (const name of podNames) {
    const podKey = normalizePodKey(name);
    if (!podKey) continue;
    const existing = await repo.get(tenantId, podKey);
    const now = nowIso();
    if (existing) {
      // Keep the assignment; refresh the display name only if it changed.
      if (existing.name !== name) {
        await repo.save({ ...existing, name, updatedAt: now });
      }
      continue;
    }
    await repo.save(
      SeoPodV1.parse({
        schemaVersion: 1,
        tenantId,
        podKey,
        name,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
}

/** Assign (or clear, with null) the specialist who owns a pod. */
export async function assignPodSpecialist(
  tenantId: string,
  podKey: string,
  specialistUserId: string | null,
): Promise<SeoPodV1> {
  const repo = getPodRepo();
  const key = normalizePodKey(podKey);
  const existing = await repo.get(tenantId, key);
  const now = nowIso();
  if (existing) {
    const next = { ...existing, updatedAt: now };
    if (specialistUserId) next.specialistUserId = specialistUserId;
    else delete next.specialistUserId;
    return repo.save(next);
  }
  // Assigning a pod that hasn't been discovered yet — create it on the fly.
  return repo.save(
    SeoPodV1.parse({
      schemaVersion: 1,
      tenantId,
      podKey: key,
      name: podKey,
      specialistUserId: specialistUserId ?? undefined,
      createdAt: now,
      updatedAt: now,
    }),
  );
}

/** The set of pod keys owned by a given user (for read-time visibility). */
export async function podKeysForUser(tenantId: string, userId: string): Promise<Set<string>> {
  const pods = await getPodRepo().list(tenantId);
  return new Set(pods.filter((p) => p.specialistUserId === userId).map((p) => p.podKey));
}
