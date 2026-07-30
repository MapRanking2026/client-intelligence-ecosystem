import { createHash } from "crypto";

import { nanoid } from "nanoid";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import type {
  KnowledgeChunk,
  KnowledgeDocSummary,
  KnowledgeRetrievalHit,
  KnowledgeSourceType,
} from "@/src/lib/contracts/knowledge";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { fetchClickupDocPages, getClickupAccess, listClickupDocs } from "@/src/lib/server/services/clickup-docs";
import { getServerEnv } from "@/src/lib/server/env";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { knowledgeChunkPath, knowledgeChunksCollectionPath } from "@/src/lib/server/firebase/collections";
import {
  cosineSimilarity,
  embedText,
  getNowIso,
  hasEmbeddingProvider,
  stripUndefinedDeep,
  type EmbeddingProvider,
} from "@/src/lib/server/services/mtos-ai";

/** Cap chunks per document and total scan, to bound embedding cost and reads. */
const MAX_CHUNKS_PER_DOC = 80;
const MAX_RETRIEVAL_SCAN = 4000;
const MAX_BACKFILL_TOUCHES = 60;
/** Cap pages embedded per ClickUp import run; re-run to continue a large wiki. */
const MAX_CLICKUP_PAGES_PER_RUN = 150;

type Db = NonNullable<ReturnType<typeof getFirebaseAdminDb>>;

function requireDb(): Db {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("The knowledge base needs the Firestore-backed data source (Firebase Admin is not configured).");
  }
  return db;
}

/**
 * Split text into overlapping chunks on paragraph boundaries, staying under
 * maxChars. Overlap keeps a little context across the seam so a retrieved chunk
 * isn't cut off mid-thought.
 */
export function chunkText(text: string, maxChars = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) {
    return [];
  }
  if (clean.length <= maxChars) {
    return [clean];
  }

  const paragraphs = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  const flushLongParagraph = () => {
    while (current.length > maxChars) {
      chunks.push(current.slice(0, maxChars).trim());
      current = current.slice(maxChars - overlap);
    }
  };

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars && current) {
      chunks.push(current.trim());
      current = `${current.slice(-overlap)}\n\n${paragraph}`;
    } else {
      current = candidate;
    }
    flushLongParagraph();
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
}

export interface AddKnowledgeInput {
  title: string;
  source?: string;
  sourceType?: KnowledgeSourceType;
  tags?: string[];
  text: string;
  /** Optional stable id (used by backfill/sync to make re-runs idempotent). */
  docId?: string;
  /** Origin id for synced sources (e.g. the ClickUp doc id). */
  sourceRefId?: string;
  /** sha256 of the source text; lets a re-sync skip unchanged content. */
  sourceHash?: string;
}

/**
 * Chunk, embed, and store a knowledge document. All chunks of a document are
 * embedded with the same provider (the first chunk's provider is reused) so a
 * document's vectors stay comparable.
 */
export async function addKnowledgeDocument(
  context: TenantContext,
  input: AddKnowledgeInput,
): Promise<{ docId: string; chunkCount: number; truncated: boolean; provider: string; model: string }> {
  const db = requireDb();
  const env = getServerEnv();
  if (!hasEmbeddingProvider(env)) {
    throw new Error("No embedding provider is configured. Set OPENAI_API_KEY or GEMINI_API_KEY to build the knowledge base.");
  }

  const title = input.title.trim() || "Untitled";
  const allChunks = chunkText(input.text);
  if (!allChunks.length) {
    throw new Error("There is no text to add.");
  }
  const chunks = allChunks.slice(0, MAX_CHUNKS_PER_DOC);
  const truncated = allChunks.length > chunks.length;

  const docId = input.docId || `doc-${nanoid(10)}`;
  const createdAt = getNowIso();
  const source = (input.source || title).trim();
  const sourceType = input.sourceType || "manual";
  const tags = (input.tags || []).map((tag) => tag.trim()).filter(Boolean);

  // Re-adding the same docId replaces its chunks (idempotent backfill / edits).
  await deleteKnowledgeDocument(context, docId);

  const batch = db.batch();
  let preferred: EmbeddingProvider | undefined;
  let usedProvider = "";
  let usedModel = "";

  for (let index = 0; index < chunks.length; index += 1) {
    const { embedding, provider, model } = await embedText(env, chunks[index], { preferredProvider: preferred });
    preferred = provider;
    usedProvider = provider;
    usedModel = model;

    const chunk: KnowledgeChunk = {
      id: `${docId}-${index}`,
      docId,
      title,
      source,
      sourceType,
      tags,
      text: chunks[index],
      embedding,
      embeddingProvider: provider,
      embeddingModel: model,
      chunkIndex: index,
      createdAt,
      sourceRefId: input.sourceRefId,
      sourceHash: input.sourceHash,
    };
    batch.set(db.doc(knowledgeChunkPath(context.tenantId, chunk.id)), stripUndefinedDeep(chunk));
  }

  await batch.commit();
  return { docId, chunkCount: chunks.length, truncated, provider: usedProvider, model: usedModel };
}

/** List stored documents (grouped from chunks), newest first. */
export async function listKnowledge(context: TenantContext): Promise<KnowledgeDocSummary[]> {
  const db = getFirebaseAdminDb();
  if (!db) {
    return [];
  }
  const snapshot = await db.collection(knowledgeChunksCollectionPath(context.tenantId)).get();
  const byDoc = new Map<string, KnowledgeDocSummary>();
  for (const doc of snapshot.docs) {
    const chunk = doc.data() as KnowledgeChunk;
    const existing = byDoc.get(chunk.docId);
    if (existing) {
      existing.chunkCount += 1;
    } else {
      byDoc.set(chunk.docId, {
        docId: chunk.docId,
        title: chunk.title,
        source: chunk.source,
        sourceType: chunk.sourceType,
        tags: chunk.tags || [],
        chunkCount: 1,
        createdAt: chunk.createdAt,
      });
    }
  }
  return [...byDoc.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Delete every chunk belonging to a document. */
export async function deleteKnowledgeDocument(
  context: TenantContext,
  docId: string,
): Promise<{ deleted: number }> {
  const db = requireDb();
  const snapshot = await db
    .collection(knowledgeChunksCollectionPath(context.tenantId))
    .where("docId", "==", docId)
    .get();
  if (snapshot.empty) {
    return { deleted: 0 };
  }
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return { deleted: snapshot.size };
}

/**
 * Seed the knowledge base from existing MTOS data: each past monthly touch's
 * executive brief + wins + risks becomes one document. Idempotent — a touch
 * already ingested (docId `touch-<id>`) is skipped.
 */
export async function backfillFromTouches(context: TenantContext): Promise<{ added: number; skipped: number }> {
  const db = requireDb();
  const dataSource = getMtosDataSource(context);
  const [touches, clients] = await Promise.all([dataSource.getMonthlyTouches(), dataSource.getClients()]);
  const clientName = new Map(clients.map((client) => [client.id, client.name]));

  const existing = await db.collection(knowledgeChunksCollectionPath(context.tenantId)).get();
  const existingDocIds = new Set(existing.docs.map((doc) => (doc.data() as KnowledgeChunk).docId));

  let added = 0;
  let skipped = 0;
  for (const touch of touches.slice(0, MAX_BACKFILL_TOUCHES)) {
    const docId = `touch-${touch.id}`;
    if (existingDocIds.has(docId)) {
      skipped += 1;
      continue;
    }
    const text = [touch.executiveBrief, ...(touch.wins || []), ...(touch.risks || [])]
      .filter((part) => typeof part === "string" && part.trim())
      .join("\n\n");
    if (text.trim().length < 100) {
      skipped += 1;
      continue;
    }
    const name = clientName.get(touch.clientId) || touch.clientId;
    await addKnowledgeDocument(context, {
      title: `Monthly touch — ${name}`,
      source: `Monthly touch — ${name}`,
      sourceType: "monthly_touch",
      tags: ["monthly_touch", touch.clientId],
      text,
      docId,
    });
    added += 1;
  }
  return { added, skipped };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The stable knowledge doc id for a ClickUp page. */
function clickupPageDocId(clickupDocId: string, pageId: string): string {
  return `clickup-${clickupDocId}-${pageId}`;
}

interface ClickupTrackedDoc {
  /** Last-seen name (from the stored `source`), a fallback if the doc was renamed/removed. */
  name: string;
  /** Knowledge doc ids currently stored for this ClickUp doc. */
  pageDocIds: Set<string>;
}

interface ClickupIndex {
  /** knowledge docId -> stored sourceHash (for skip-if-unchanged). */
  hashByDocId: Map<string, string>;
  /** ClickUp doc id -> tracked pages. */
  trackedDocs: Map<string, ClickupTrackedDoc>;
}

/** One Firestore read of the clickup chunks → hashes + the tracked-doc index. */
async function loadClickupIndex(context: TenantContext): Promise<ClickupIndex> {
  const hashByDocId = new Map<string, string>();
  const trackedDocs = new Map<string, ClickupTrackedDoc>();
  const db = getFirebaseAdminDb();
  if (!db) {
    return { hashByDocId, trackedDocs };
  }

  const snapshot = await db
    .collection(knowledgeChunksCollectionPath(context.tenantId))
    .where("sourceType", "==", "clickup")
    .get();

  for (const doc of snapshot.docs) {
    const chunk = doc.data() as KnowledgeChunk;
    if (chunk.sourceHash) {
      hashByDocId.set(chunk.docId, chunk.sourceHash);
    }
    const refId = chunk.sourceRefId;
    if (!refId) {
      continue;
    }
    const tracked = trackedDocs.get(refId) || {
      name: chunk.source.replace(/^ClickUp:\s*/, ""),
      pageDocIds: new Set<string>(),
    };
    tracked.pageDocIds.add(chunk.docId);
    trackedDocs.set(refId, tracked);
  }

  return { hashByDocId, trackedDocs };
}

interface SyncDocResult {
  updated: number;
  unchanged: number;
  skippedEmpty: number;
  chunks: number;
  /** Knowledge doc ids that currently exist in ClickUp (embedded or skipped). */
  writtenDocIds: string[];
  capped: boolean;
}

/**
 * Sync one ClickUp doc's pages into the knowledge base. Unchanged pages (matching
 * sourceHash) are skipped without an embedding call; changed/new pages are
 * re-embedded. `budget` bounds pages embedded this run across all docs.
 */
async function syncClickupDoc(
  context: TenantContext,
  access: NonNullable<Awaited<ReturnType<typeof getClickupAccess>>>,
  clickupDocId: string,
  docName: string,
  hashByDocId: Map<string, string>,
  budget: { remaining: number },
): Promise<SyncDocResult> {
  const pages = await fetchClickupDocPages(access, clickupDocId);
  let updated = 0;
  let unchanged = 0;
  let skippedEmpty = 0;
  let chunks = 0;
  let capped = false;
  const writtenDocIds: string[] = [];

  for (const page of pages) {
    const text = page.content.trim();
    if (text.length < 40) {
      skippedEmpty += 1;
      continue;
    }
    const knowledgeDocId = clickupPageDocId(clickupDocId, page.id);
    const hash = sha256(text);
    writtenDocIds.push(knowledgeDocId);

    if (hashByDocId.get(knowledgeDocId) === hash) {
      unchanged += 1;
      continue;
    }
    if (budget.remaining <= 0) {
      capped = true;
      // Leave it in writtenDocIds so it isn't pruned; it'll re-embed next run.
      continue;
    }

    const result = await addKnowledgeDocument(context, {
      title: page.name.trim() || docName,
      source: `ClickUp: ${docName}`,
      sourceType: "clickup",
      tags: ["clickup", "wiki"],
      text,
      docId: knowledgeDocId,
      sourceRefId: clickupDocId,
      sourceHash: hash,
    });
    chunks += result.chunkCount;
    updated += 1;
    budget.remaining -= 1;
  }

  return { updated, unchanged, skippedEmpty, chunks, writtenDocIds, capped };
}

/** Delete stored pages for a ClickUp doc that are no longer present in ClickUp. */
async function prunePages(context: TenantContext, trackedPageDocIds: Set<string>, keep: Set<string>): Promise<number> {
  let pruned = 0;
  for (const docId of trackedPageDocIds) {
    if (!keep.has(docId)) {
      await deleteKnowledgeDocument(context, docId);
      pruned += 1;
    }
  }
  return pruned;
}

/**
 * Ingest selected ClickUp Docs (the Map Ranking wiki). Unchanged pages are skipped
 * (no re-embed); pages removed from a selected doc are pruned. Idempotent.
 */
export async function ingestClickupDocs(
  context: TenantContext,
  docIds: string[],
): Promise<{ docsImported: number; pagesImported: number; pagesUnchanged: number; chunks: number; skipped: number; capped: boolean }> {
  requireDb();
  const env = getServerEnv();
  if (!hasEmbeddingProvider(env)) {
    throw new Error("No embedding provider is configured. Set OPENAI_API_KEY or GEMINI_API_KEY to import into the knowledge base.");
  }
  const access = await getClickupAccess(context);
  if (!access) {
    throw new Error("ClickUp isn't connected. Connect it in Settings → Integrations, then try again.");
  }

  const [{ docs }, index] = await Promise.all([listClickupDocs(context), loadClickupIndex(context)]);
  const nameById = new Map(docs.map((doc) => [doc.id, doc.name]));
  const budget = { remaining: MAX_CLICKUP_PAGES_PER_RUN };

  let docsImported = 0;
  let pagesImported = 0;
  let pagesUnchanged = 0;
  let chunks = 0;
  let skipped = 0;
  let capped = false;

  for (const docId of docIds) {
    const docName = nameById.get(docId) || index.trackedDocs.get(docId)?.name || "ClickUp doc";
    const result = await syncClickupDoc(context, access, docId, docName, index.hashByDocId, budget);
    pagesImported += result.updated;
    pagesUnchanged += result.unchanged;
    chunks += result.chunks;
    skipped += result.skippedEmpty;
    capped = capped || result.capped;
    if (result.updated > 0 || result.unchanged > 0) {
      docsImported += 1;
    }
    // Prune pages that were removed from this doc in ClickUp.
    const tracked = index.trackedDocs.get(docId);
    if (tracked) {
      await prunePages(context, tracked.pageDocIds, new Set(result.writtenDocIds));
    }
  }

  return { docsImported, pagesImported, pagesUnchanged, chunks, skipped, capped };
}

export interface ClickupResyncReport {
  docsChecked: number;
  pagesUpdated: number;
  pagesUnchanged: number;
  pagesPruned: number;
  docsPruned: number;
  chunks: number;
  capped: boolean;
  note?: string;
}

/**
 * Re-sync every ClickUp doc already imported: re-embed changed pages, skip
 * unchanged ones, and prune pages/docs deleted in ClickUp. Non-fatal and a clean
 * no-op when nothing is tracked / ClickUp isn't connected / no embedding provider.
 * Safe to run on a schedule.
 */
export async function resyncClickupKnowledge(context: TenantContext): Promise<ClickupResyncReport> {
  const empty: ClickupResyncReport = {
    docsChecked: 0,
    pagesUpdated: 0,
    pagesUnchanged: 0,
    pagesPruned: 0,
    docsPruned: 0,
    chunks: 0,
    capped: false,
  };

  const db = getFirebaseAdminDb();
  if (!db) {
    return { ...empty, note: "No Firestore data source." };
  }
  const env = getServerEnv();
  if (!hasEmbeddingProvider(env)) {
    return { ...empty, note: "No embedding provider configured." };
  }

  const index = await loadClickupIndex(context);
  if (index.trackedDocs.size === 0) {
    return { ...empty, note: "No ClickUp docs have been imported yet." };
  }

  const access = await getClickupAccess(context);
  if (!access) {
    return { ...empty, note: "ClickUp isn't connected." };
  }

  const { docs } = await listClickupDocs(context);
  const nameById = new Map(docs.map((doc) => [doc.id, doc.name]));
  const budget = { remaining: MAX_CLICKUP_PAGES_PER_RUN };

  const report: ClickupResyncReport = { ...empty };

  for (const [clickupDocId, tracked] of index.trackedDocs) {
    report.docsChecked += 1;

    // Doc deleted in ClickUp (no longer listed) → prune all its stored pages.
    if (!nameById.has(clickupDocId)) {
      report.pagesPruned += await prunePages(context, tracked.pageDocIds, new Set());
      report.docsPruned += 1;
      continue;
    }

    const docName = nameById.get(clickupDocId) || tracked.name;
    const result = await syncClickupDoc(context, access, clickupDocId, docName, index.hashByDocId, budget);
    report.pagesUpdated += result.updated;
    report.pagesUnchanged += result.unchanged;
    report.chunks += result.chunks;
    report.capped = report.capped || result.capped;
    report.pagesPruned += await prunePages(context, tracked.pageDocIds, new Set(result.writtenDocIds));
  }

  return report;
}

/**
 * Retrieve the top-k most relevant chunks for a query. Embeds the query with the
 * same provider the stored chunks used (vectors are only comparable within a
 * model), scores by cosine similarity, and returns the best matches. Non-fatal:
 * returns [] when the base is empty or embeddings are unavailable.
 */
export async function retrieveKnowledge(
  context: TenantContext,
  queryText: string,
  topK = 5,
  minScore = 0.2,
): Promise<KnowledgeRetrievalHit[]> {
  const db = getFirebaseAdminDb();
  if (!db || !queryText.trim()) {
    return [];
  }
  const env = getServerEnv();
  if (!hasEmbeddingProvider(env)) {
    return [];
  }

  const snapshot = await db.collection(knowledgeChunksCollectionPath(context.tenantId)).get();
  if (snapshot.empty) {
    return [];
  }
  const chunks = snapshot.docs.map((doc) => doc.data() as KnowledgeChunk).slice(0, MAX_RETRIEVAL_SCAN);

  // Embed the query with the same provider the stored chunks used.
  const sampleProvider = chunks[0]?.embeddingProvider as EmbeddingProvider | undefined;
  let query;
  try {
    query = await embedText(env, queryText, { preferredProvider: sampleProvider });
  } catch {
    return [];
  }

  return chunks
    .filter(
      (chunk) =>
        chunk.embeddingProvider === query.provider &&
        chunk.embeddingModel === query.model &&
        Array.isArray(chunk.embedding) &&
        chunk.embedding.length === query.embedding.length,
    )
    .map((chunk) => ({ chunk, score: cosineSimilarity(query.embedding, chunk.embedding) }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk, score }) => ({
      docId: chunk.docId,
      title: chunk.title,
      source: chunk.source,
      text: chunk.text,
      score: Math.round(score * 1000) / 1000,
    }));
}
