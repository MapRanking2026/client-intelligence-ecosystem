"use client";

import { useState, useTransition } from "react";
import { BookOpenText, Cloud, Download, LoaderCircle, RefreshCw, Search, Trash2 } from "lucide-react";

import type { KnowledgeDocSummary, KnowledgeRetrievalHit } from "@/src/lib/contracts/knowledge";

interface KnowledgeManagerProps {
  initialDocuments: KnowledgeDocSummary[];
}

interface ClickupDoc {
  id: string;
  name: string;
}

interface KnowledgeResponse {
  data?: {
    documents?: KnowledgeDocSummary[];
    result?: { chunkCount?: number; truncated?: boolean; added?: number; skipped?: number; provider?: string };
    hits?: KnowledgeRetrievalHit[];
    connected?: boolean;
    clickupDocs?: ClickupDoc[];
    clickupImport?: { docsImported: number; pagesImported: number; chunks: number; skipped: number; capped: boolean };
    clickupResync?: {
      docsChecked: number;
      pagesUpdated: number;
      pagesUnchanged: number;
      pagesPruned: number;
      docsPruned: number;
      chunks: number;
      capped: boolean;
      note?: string;
    };
  };
  error?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  monthly_touch: "Monthly touch",
  clickup: "ClickUp wiki",
  import: "Import",
};

export function KnowledgeManager({ initialDocuments }: KnowledgeManagerProps) {
  const [documents, setDocuments] = useState<KnowledgeDocSummary[]>(initialDocuments);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [text, setText] = useState("");

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KnowledgeRetrievalHit[] | null>(null);

  const [clickupDocs, setClickupDocs] = useState<ClickupDoc[] | null>(null);
  const [clickupConnected, setClickupConnected] = useState<boolean | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());

  function call(body: unknown, label: string, onData?: (data: NonNullable<KnowledgeResponse["data"]>) => void) {
    startTransition(async () => {
      setError(null);
      setNotice(null);
      setPending(label);
      try {
        const response = await fetch("/api/knowledge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as KnowledgeResponse;
        if (!response.ok) {
          throw new Error(payload.error || "Action failed");
        }
        if (payload.data?.documents) {
          setDocuments(payload.data.documents);
        }
        onData?.(payload.data || {});
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Action failed");
      } finally {
        setPending(null);
      }
    });
  }

  function addDocument() {
    const tagList = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    call({ action: "add", title, tags: tagList, text }, "add", (data) => {
      const chunks = data.result?.chunkCount ?? 0;
      setNotice(
        `Added “${title}” — ${chunks} chunk${chunks === 1 ? "" : "s"} embedded${
          data.result?.provider ? ` via ${data.result.provider}` : ""
        }${data.result?.truncated ? " (document was long and got truncated)" : ""}.`,
      );
      setTitle("");
      setTags("");
      setText("");
    });
  }

  function backfill() {
    call({ action: "backfill" }, "backfill", (data) => {
      setNotice(`Backfill complete — ${data.result?.added ?? 0} added, ${data.result?.skipped ?? 0} skipped.`);
    });
  }

  function runRetrieve() {
    call({ action: "retrieve", query, topK: 5 }, "retrieve", (data) => {
      setHits(data.hits || []);
    });
  }

  function remove(docId: string, docTitle: string) {
    call({ action: "delete", docId }, `delete-${docId}`, () => {
      setNotice(`Removed “${docTitle}”.`);
    });
  }

  function loadClickupDocs() {
    call({ action: "clickup_list" }, "clickup_list", (data) => {
      setClickupConnected(data.connected ?? false);
      setClickupDocs(data.clickupDocs || []);
      setSelectedDocs(new Set());
      if (data.connected === false) {
        setNotice(null);
      }
    });
  }

  function toggleDoc(docId: string) {
    setSelectedDocs((current) => {
      const next = new Set(current);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  }

  function resyncClickup() {
    call({ action: "clickup_resync" }, "clickup_resync", (data) => {
      const r = data.clickupResync;
      if (r) {
        setNotice(
          r.note
            ? `ClickUp re-sync: ${r.note}`
            : `ClickUp re-sync — ${r.pagesUpdated} page(s) updated, ${r.pagesUnchanged} unchanged, ${r.pagesPruned} pruned across ${r.docsChecked} doc(s)${
                r.capped ? " (hit the per-run cap — run again to finish)" : ""
              }.`,
        );
      }
    });
  }

  function importClickup() {
    call({ action: "clickup_import", docIds: [...selectedDocs] }, "clickup_import", (data) => {
      const result = data.clickupImport;
      if (result) {
        setNotice(
          `Imported ${result.pagesImported} page(s) from ${result.docsImported} ClickUp doc(s) — ${result.chunks} chunk(s) embedded${
            result.skipped ? `, ${result.skipped} empty page(s) skipped` : ""
          }${result.capped ? " (hit the per-run page cap — run again to continue)" : ""}.`,
        );
      }
      setSelectedDocs(new Set());
    });
  }

  return (
    <div className="space-y-8">
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-200">{notice}</p> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Add a document */}
        <div className="space-y-3 rounded-[24px] border border-white/8 bg-black/20 p-5">
          <div className="flex items-center gap-2 text-white">
            <BookOpenText className="h-4 w-4" />
            <p className="text-sm font-semibold">Add knowledge</p>
          </div>
          <p className="text-xs text-slate-500">
            Paste an SOP, playbook, or strategy note. It&apos;s split into chunks, embedded, and made retrievable.
          </p>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title (e.g. GBP optimization playbook)"
            className="w-full rounded-2xl border border-white/12 bg-black/30 px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-white/30"
          />
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="Tags, comma separated (optional)"
            className="w-full rounded-2xl border border-white/12 bg-black/30 px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-white/30"
          />
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            placeholder="Paste the document text here…"
            className="w-full rounded-2xl border border-white/12 bg-black/30 px-4 py-3 text-sm text-slate-100 outline-none focus:border-white/30"
          />
          <button
            type="button"
            onClick={addDocument}
            disabled={isPending || !title.trim() || !text.trim()}
            style={{ color: "#0d1625" }}
            className="inline-flex items-center gap-2 rounded-full border border-[#d7f5ec]/20 bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0d1625] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending && pending === "add" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BookOpenText className="h-4 w-4" />}
            Add to knowledge base
          </button>
        </div>

        {/* Test retrieval */}
        <div className="space-y-3 rounded-[24px] border border-white/8 bg-black/20 p-5">
          <div className="flex items-center gap-2 text-white">
            <Search className="h-4 w-4" />
            <p className="text-sm font-semibold">Test retrieval</p>
          </div>
          <p className="text-xs text-slate-500">
            See what the AI would pull in for a question — the same retrieval that grounds monthly-touch prep.
          </p>
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            rows={3}
            placeholder="e.g. How do we handle a client with slow lead call-back times?"
            className="w-full rounded-2xl border border-white/12 bg-black/30 px-4 py-3 text-sm text-slate-100 outline-none focus:border-white/30"
          />
          <button
            type="button"
            onClick={runRetrieve}
            disabled={isPending || !query.trim()}
            className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/4 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending && pending === "retrieve" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Retrieve
          </button>
          {hits ? (
            <div className="space-y-2">
              {hits.length === 0 ? (
                <p className="text-xs text-slate-500">No relevant knowledge found for that query.</p>
              ) : (
                hits.map((hit, index) => (
                  <div key={`${hit.docId}-${index}`} className="rounded-2xl border border-white/8 bg-white/4 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-white">{hit.title}</p>
                      <span className="text-[10px] text-slate-500">score {hit.score}</span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-xs text-slate-400">{hit.text}</p>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Import from ClickUp wiki */}
      <div className="space-y-3 rounded-[24px] border border-white/8 bg-black/20 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-white">
            <Cloud className="h-4 w-4" />
            <p className="text-sm font-semibold">Import from ClickUp wiki</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resyncClickup}
              disabled={isPending}
              title="Re-embed changed pages and prune deleted ones for docs already imported"
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/4 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending && pending === "clickup_resync" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Re-sync now
            </button>
            <button
              type="button"
              onClick={loadClickupDocs}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/4 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending && pending === "clickup_list" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
              Load ClickUp docs
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Pull Docs from your connected ClickUp workspace (including the Map Ranking wiki) straight into the
          knowledge base. Re-importing a doc updates it in place — no duplicates. The wiki also re-syncs
          automatically every day; use <span className="text-slate-300">Re-sync now</span> to update on demand.
        </p>

        {clickupConnected === false ? (
          <p className="text-sm text-amber-200">
            ClickUp isn&apos;t connected. Connect it in Settings → Integrations, then load docs here.
          </p>
        ) : null}

        {clickupDocs && clickupConnected ? (
          clickupDocs.length === 0 ? (
            <p className="text-sm text-slate-400">No ClickUp docs were found in this workspace.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedDocs((current) =>
                      current.size === clickupDocs.length ? new Set() : new Set(clickupDocs.map((doc) => doc.id)),
                    )
                  }
                  className="text-xs text-slate-300 underline-offset-2 hover:underline"
                >
                  {selectedDocs.size === clickupDocs.length ? "Clear selection" : "Select all"}
                </button>
                <button
                  type="button"
                  onClick={importClickup}
                  disabled={isPending || selectedDocs.size === 0}
                  style={{ color: "#0d1625" }}
                  className="inline-flex items-center gap-2 rounded-full border border-[#d7f5ec]/20 bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0d1625] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending && pending === "clickup_import" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Import {selectedDocs.size || ""} selected
                </button>
              </div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {clickupDocs.map((doc) => (
                  <label
                    key={doc.id}
                    className="flex cursor-pointer items-center gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-2.5 text-sm text-slate-200 transition hover:bg-white/8"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDocs.has(doc.id)}
                      onChange={() => toggleDoc(doc.id)}
                      className="h-4 w-4 accent-[#d7f5ec]"
                    />
                    <span className="truncate">{doc.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )
        ) : null}
      </div>

      {/* Documents list */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
            Stored knowledge ({documents.length})
          </p>
          <button
            type="button"
            onClick={backfill}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/4 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending && pending === "backfill" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Backfill from past monthly touches
          </button>
        </div>

        {documents.length === 0 ? (
          <div className="rounded-[24px] border border-white/8 bg-black/20 px-5 py-8 text-center text-sm text-slate-400">
            No knowledge yet. Add a document above, or backfill from your past monthly touches.
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.docId}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{doc.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {SOURCE_LABEL[doc.sourceType] || doc.sourceType} · {doc.chunkCount} chunk
                    {doc.chunkCount === 1 ? "" : "s"}
                    {doc.tags.length ? ` · ${doc.tags.join(", ")}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(doc.docId, doc.title)}
                  disabled={isPending}
                  aria-label={`Remove ${doc.title}`}
                  className="inline-flex items-center gap-1 rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-100 transition hover:bg-rose-500/20 disabled:opacity-60"
                >
                  {pending === `delete-${doc.docId}` ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
