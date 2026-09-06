import { SpecialistV1, specialistSlug } from "@/src/lib/domain/specialist";
import { nowIso } from "@/src/lib/ids";
import { getSpecialistRepo } from "@/src/lib/server/repositories/specialist-repo";
import { getProjectRepo } from "@/src/lib/server/repositories/project-repo";
import { getUserRepo } from "@/src/lib/server/repositories/user-repo";

/** Initial roster (from the team). Provisioned once when the roster is empty. */
const DEFAULT_SPECIALISTS = [
  "Salvador Sarabia",
  "Iris Alfonso",
  "Hallen BL",
  "Angel Gonzalez",
  "Alberto Martinez",
];

function norm(s?: string): string {
  return (s ?? "").trim().toLowerCase().replace(/[@._-]+/g, " ").replace(/\s+/g, " ").trim();
}
function firstToken(s?: string): string {
  return norm(s).split(" ")[0] ?? "";
}

export async function listSpecialists(tenantId: string): Promise<SpecialistV1[]> {
  const repo = getSpecialistRepo();
  let all = await repo.list(tenantId);
  if (all.length === 0) {
    // Seed the known roster once (idempotent — only when empty).
    const now = nowIso();
    for (const name of DEFAULT_SPECIALISTS) {
      await repo.save(
        SpecialistV1.parse({
          schemaVersion: 1,
          tenantId,
          id: specialistSlug(name),
          name,
          active: true,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    all = await repo.list(tenantId);
  }
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function addSpecialist(
  tenantId: string,
  input: { name: string; email?: string },
): Promise<SpecialistV1> {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  const repo = getSpecialistRepo();
  let id = specialistSlug(name);
  if (await repo.get(tenantId, id)) id = `${id}-${Date.now().toString(36).slice(-4)}`;
  const now = nowIso();
  return repo.save(
    SpecialistV1.parse({
      schemaVersion: 1,
      tenantId,
      id,
      name,
      email: input.email?.trim() || undefined,
      active: true,
      createdAt: now,
      updatedAt: now,
    }),
  );
}

export async function updateSpecialist(
  tenantId: string,
  id: string,
  patch: { name?: string; email?: string | null; active?: boolean },
): Promise<SpecialistV1> {
  const repo = getSpecialistRepo();
  const existing = await repo.get(tenantId, id);
  if (!existing) throw new Error("Specialist not found");
  const next = { ...existing, updatedAt: nowIso() };
  if (patch.name?.trim()) next.name = patch.name.trim();
  if (patch.email !== undefined) {
    if (patch.email) next.email = patch.email.trim();
    else delete next.email;
  }
  if (patch.active !== undefined) next.active = patch.active;
  return repo.save(next);
}

/** Remove a specialist and clear any direct client assignments to them. */
export async function removeSpecialist(tenantId: string, id: string): Promise<void> {
  const projectRepo = getProjectRepo();
  const projects = await projectRepo.list(tenantId);
  for (const p of projects) {
    if (p.assignedSpecialistId === id) {
      const { assignedSpecialistId: _drop, ...rest } = p;
      await projectRepo.save({ ...rest, updatedAt: nowIso() });
    }
  }
  await getSpecialistRepo().remove(tenantId, id);
}

/**
 * Match a raw ClickUp specialist value (e.g. the ⭐ Responsable field, "Salvador")
 * to a roster specialist. Matches on the specialist's first-name token or full
 * name, so "Salvador" resolves to "Salvador Sarabia".
 */
export function matchSpecialistId(
  rawName: string | undefined,
  specialists: SpecialistV1[],
): string | undefined {
  const r = norm(rawName);
  if (!r) return undefined;
  const words = new Set(r.split(" "));
  for (const s of specialists) {
    if (!s.active) continue;
    const full = norm(s.name);
    const first = firstToken(s.name);
    if (r === full) return s.id;
    if (first && (words.has(first) || r.includes(first))) return s.id;
    if (s.email) {
      const local = firstToken(s.email);
      if (local && words.has(local)) return s.id;
    }
  }
  return undefined;
}

/** Resolve which specialist a logged-in user is (by email, else name). */
export async function resolveViewerSpecialistId(
  tenantId: string,
  userId: string,
): Promise<string | undefined> {
  const user = await getUserRepo().getById(tenantId, userId);
  if (!user) return undefined;
  const specialists = await listSpecialists(tenantId);
  if (user.email) {
    const byEmail = specialists.find(
      (s) => s.email && s.email.toLowerCase() === user.email.toLowerCase(),
    );
    if (byEmail) return byEmail.id;
  }
  const candidate = [user.displayName, user.email?.split("@")[0]].filter(Boolean).join(" ");
  return matchSpecialistId(candidate, specialists);
}
