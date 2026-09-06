import { NicheStudyV1 } from "@/src/lib/domain/niche-study";
import { newId, nowIso } from "@/src/lib/ids";
import { getNicheStudyRepo } from "@/src/lib/server/repositories/niche-study-repo";
import { fetchDriveDocs } from "@/src/lib/server/sync/drive-adapter";

export async function listNicheStudies(tenantId: string): Promise<NicheStudyV1[]> {
  const all = await getNicheStudyRepo().list(tenantId);
  return all.sort((a, b) => a.title.localeCompare(b.title));
}

export async function addNicheStudy(
  tenantId: string,
  input: { niche?: string; title: string; content: string },
): Promise<NicheStudyV1> {
  const now = nowIso();
  return getNicheStudyRepo().save(
    NicheStudyV1.parse({
      schemaVersion: 1,
      tenantId,
      id: newId("niche"),
      niche: input.niche?.trim() || undefined,
      title: input.title.trim(),
      content: input.content.trim(),
      source: "manual",
      createdAt: now,
      updatedAt: now,
    }),
  );
}

export async function removeNicheStudy(tenantId: string, id: string): Promise<void> {
  await getNicheStudyRepo().remove(tenantId, id);
}

const norm = (s: string) => s.toLowerCase();

/** Studies relevant to a niche: explicit niche match, or the niche word appears. */
export async function findForNiche(tenantId: string, niche?: string): Promise<NicheStudyV1[]> {
  const all = await getNicheStudyRepo().list(tenantId);
  const n = norm((niche ?? "").trim());
  if (!n) return all.slice(0, 3);
  const scored = all.filter((s) => {
    const sn = norm(s.niche ?? "");
    if (sn && (sn.includes(n) || n.includes(sn))) return true;
    return norm(`${s.title} ${s.content}`).includes(n);
  });
  return (scored.length ? scored : all).slice(0, 3);
}

/** Import Google Docs from a Drive folder as niche studies (dedup by file id). */
export async function importFromDrive(
  tenantId: string,
  folderId: string,
): Promise<{ ok: boolean; imported: number; updated: number; error?: string }> {
  const res = await fetchDriveDocs(tenantId, folderId);
  if (!res.ok) return { ok: false, imported: 0, updated: 0, error: res.error };

  const repo = getNicheStudyRepo();
  let imported = 0;
  let updated = 0;
  for (const doc of res.docs) {
    const now = nowIso();
    const existing = await repo.findByDriveFileId(tenantId, doc.id);
    if (existing) {
      await repo.save({ ...existing, title: doc.name, content: doc.content, updatedAt: now });
      updated += 1;
    } else {
      await repo.save(
        NicheStudyV1.parse({
          schemaVersion: 1,
          tenantId,
          id: newId("niche"),
          title: doc.name,
          content: doc.content,
          source: "drive",
          driveFileId: doc.id,
          createdAt: now,
          updatedAt: now,
        }),
      );
      imported += 1;
    }
  }
  return { ok: true, imported, updated };
}
