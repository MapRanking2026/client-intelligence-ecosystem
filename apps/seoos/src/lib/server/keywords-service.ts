import {
  BulkKeywordAction,
  CreateKeywordInput,
  KeywordV1,
  normalizePhrase,
} from "@/src/lib/domain/keyword";
import { newId, nowIso } from "@/src/lib/ids";
import { getKeywordRepo } from "@/src/lib/server/repositories/keyword-repo";

export async function listKeywords(tenantId: string, projectId: string) {
  return getKeywordRepo().listByProject(tenantId, projectId);
}

export interface CreateKeywordResult {
  keyword: KeywordV1;
  deduped: boolean;
}

export async function createKeyword(
  tenantId: string,
  input: CreateKeywordInput,
): Promise<CreateKeywordResult> {
  const parsed = CreateKeywordInput.parse(input);
  const repo = getKeywordRepo();
  const normalized = normalizePhrase(parsed.phrase);
  const existing = await repo.findByNormalized(tenantId, parsed.projectId, normalized);
  if (existing) return { keyword: existing, deduped: true };

  const now = nowIso();
  const keyword = KeywordV1.parse({
    schemaVersion: 1,
    id: newId("kw"),
    tenantId,
    projectId: parsed.projectId,
    clientId: parsed.clientId,
    phrase: parsed.phrase.trim(),
    normalizedPhrase: normalized,
    status: "proposed",
    intent: parsed.intent,
    group: parsed.group,
    priority: parsed.priority,
    locationIds: parsed.locationIds,
    targetUrl: parsed.targetUrl,
    tags: parsed.tags,
    notes: parsed.notes,
    createdAt: now,
    updatedAt: now,
  });
  await repo.save(keyword);
  return { keyword, deduped: false };
}

export interface ImportResult {
  created: number;
  skipped: number;
  createdKeywords: KeywordV1[];
}

/** Import a list of phrases; dedups within the batch and against existing. */
export async function importKeywords(
  tenantId: string,
  projectId: string,
  clientId: string,
  phrases: string[],
): Promise<ImportResult> {
  const repo = getKeywordRepo();
  const existing = await repo.listByProject(tenantId, projectId);
  const seen = new Set(existing.map((k) => k.normalizedPhrase));
  const now = nowIso();

  const toCreate: KeywordV1[] = [];
  let skipped = 0;
  for (const raw of phrases) {
    const phrase = raw.trim();
    if (!phrase) continue;
    const normalized = normalizePhrase(phrase);
    if (seen.has(normalized)) {
      skipped += 1;
      continue;
    }
    seen.add(normalized);
    toCreate.push(
      KeywordV1.parse({
        schemaVersion: 1,
        id: newId("kw"),
        tenantId,
        projectId,
        clientId,
        phrase,
        normalizedPhrase: normalized,
        status: "proposed",
        priority: "normal",
        locationIds: [],
        tags: [],
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
  if (toCreate.length) await repo.saveMany(toCreate);
  return { created: toCreate.length, skipped, createdKeywords: toCreate };
}

export async function applyBulkAction(
  tenantId: string,
  action: BulkKeywordAction,
): Promise<{ updated: number }> {
  const parsed = BulkKeywordAction.parse(action);
  const repo = getKeywordRepo();
  const now = nowIso();
  let updated = 0;
  for (const id of parsed.keywordIds) {
    const kw = await repo.get(tenantId, id);
    if (!kw) continue;
    let next = kw;
    if (parsed.action === "set_status" && parsed.status) {
      next = { ...kw, status: parsed.status, updatedAt: now };
    } else if (parsed.action === "set_group" && parsed.group !== undefined) {
      next = { ...kw, group: parsed.group, updatedAt: now };
    } else if (parsed.action === "retire") {
      next = { ...kw, status: "retired", updatedAt: now };
    }
    await repo.save(next);
    updated += 1;
  }
  return { updated };
}
