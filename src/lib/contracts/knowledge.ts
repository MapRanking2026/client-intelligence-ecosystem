/**
 * Knowledge base (RAG) contracts. A "document" is a unit an operator adds (an
 * SOP, a playbook, a past monthly touch); it is split into chunks, each embedded
 * and stored on its own so retrieval can pull the most relevant pieces. Every
 * chunk records which provider+model embedded it, because vectors are only
 * comparable within the same model.
 */

export type KnowledgeSourceType = "manual" | "monthly_touch" | "import";

export interface KnowledgeChunk {
  id: string;
  /** Groups every chunk that came from the same source document. */
  docId: string;
  title: string;
  /** Human-readable origin, e.g. "SOP: GBP optimization" or "Monthly touch — Oakline Dental". */
  source: string;
  sourceType: KnowledgeSourceType;
  tags: string[];
  text: string;
  embedding: number[];
  embeddingProvider: string;
  embeddingModel: string;
  chunkIndex: number;
  createdAt: string;
}

/** One row in the admin list — a document, not its individual chunks. */
export interface KnowledgeDocSummary {
  docId: string;
  title: string;
  source: string;
  sourceType: KnowledgeSourceType;
  tags: string[];
  chunkCount: number;
  createdAt: string;
}

/** A retrieval result injected into a prompt as grounding. */
export interface KnowledgeRetrievalHit {
  docId: string;
  title: string;
  source: string;
  text: string;
  score: number;
}
