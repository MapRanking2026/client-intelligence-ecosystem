"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Upload, X, Trash2, FileText, FileImage } from "lucide-react";

import type { ClientAttachment } from "@/src/lib/server/services/client-attachments-service";

interface Staged {
  localId: string;
  kind: "image" | "file";
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

const MAX_DATAURL = 950_000;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Couldn't read file"));
    reader.readAsDataURL(file);
  });
}

/** Resize + re-encode an image so it fits comfortably inside a Firestore document. */
function compressImage(file: File): Promise<{ dataUrl: string; size: number; name: string }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxDim = 1600;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas unavailable"));
      ctx.drawImage(img, 0, 0, width, height);
      let quality = 0.85;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (dataUrl.length > MAX_DATAURL && quality > 0.4) {
        quality -= 0.12;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      const base = (file.name || "screenshot").replace(/\.[^.]+$/, "");
      resolve({ dataUrl, size: Math.round(dataUrl.length * 0.75), name: `${base}.jpg` });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that image"));
    };
    img.src = url;
  });
}

export function ClientAttachments({
  clientId,
  clientName,
  initialCount = 0,
}: {
  clientId: string;
  clientName: string;
  initialCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [attachments, setAttachments] = useState<ClientAttachment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const count = loaded ? attachments.length : initialCount;

  async function refresh() {
    try {
      const res = await fetch(`/api/clients/${clientId}/attachments`);
      if (res.ok) {
        const json = await res.json();
        setAttachments(json.data as ClientAttachment[]);
        setLoaded(true);
      }
    } catch {
      /* keep existing list */
    }
  }

  async function addFiles(files: File[]) {
    setError(null);
    for (const file of files) {
      try {
        if (file.type.startsWith("image/")) {
          const { dataUrl, size, name } = await compressImage(file);
          setStaged((s) => [...s, { localId: crypto.randomUUID(), kind: "image", name, mimeType: "image/jpeg", size, dataUrl }]);
        } else {
          const dataUrl = await readAsDataUrl(file);
          if (dataUrl.length > MAX_DATAURL) {
            setError(`"${file.name}" is too large (keep files under ~650 KB, or paste it as a screenshot).`);
            continue;
          }
          setStaged((s) => [
            ...s,
            { localId: crypto.randomUUID(), kind: "file", name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, dataUrl },
          ]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't add that file");
      }
    }
  }

  // Capture clipboard paste (screenshots + text) anywhere while the modal is open.
  useEffect(() => {
    if (!open) return;
    async function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      let pastedText = "";
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) imageFiles.push(f);
        } else if (item.kind === "string" && item.type === "text/plain") {
          pastedText = await new Promise<string>((r) => item.getAsString(r));
        }
      }
      if (imageFiles.length) {
        e.preventDefault();
        void addFiles(imageFiles);
      }
      if (pastedText && !imageFiles.length) {
        setNote((n) => (n ? `${n}\n${pastedText}` : pastedText));
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      for (const item of staged) {
        const res = await fetch(`/api/clients/${clientId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: item.kind, name: item.name, mimeType: item.mimeType, size: item.size, dataUrl: item.dataUrl }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Upload failed");
      }
      if (note.trim()) {
        const res = await fetch(`/api/clients/${clientId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "note", name: "Note", text: note.trim() }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Couldn't save note");
      }
      setStaged([]);
      setNote("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setAttachments((a) => a.filter((x) => x.id !== id));
    await fetch(`/api/clients/${clientId}/attachments?id=${id}`, { method: "DELETE" });
  }

  const hasStaged = staged.length > 0 || note.trim().length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
        className="inline-flex items-center gap-1.5 text-[0.8rem] font-semibold"
        style={{ color: "var(--accent)" }}
      >
        <Paperclip style={{ width: 14, height: 14 }} />
        Attach supporting documents
        {count ? <span className="muted" style={{ fontWeight: 500 }}>({count})</span> : null}
      </button>

      {open ? (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", padding: 16, background: "rgba(10,16,26,0.5)", backdropFilter: "blur(2px)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="card"
            style={{ width: "min(660px, 96vw)", maxHeight: "88vh", overflowY: "auto", padding: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-head">
              <div>
                <div className="h4">Supporting documents</div>
                <div className="muted text-[0.78rem]">{clientName}</div>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close" type="button">
                <X />
              </button>
            </div>

            <div style={{ padding: 20 }}>
              <p className="muted text-[0.82rem]" style={{ marginBottom: 14 }}>
                Drop files, choose from your computer, or <b style={{ color: "var(--text)" }}>paste a screenshot</b> (⌘/Ctrl+V) —
                GBP performance, Google Ads exports, anything that helps build the Monthly Touch.
              </p>

              {/* Drop / choose zone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void addFiles(Array.from(e.dataTransfer.files));
                }}
                onClick={() => fileInputRef.current?.click()}
                style={{ border: "1.5px dashed var(--hair-strong)", borderRadius: "var(--r-lg)", padding: "26px 20px", textAlign: "center", cursor: "pointer", background: "var(--surface-2)" }}
              >
                <div className="insight-icon" style={{ margin: "0 auto 10px", background: "var(--accent-soft)", color: "var(--accent)" }}>
                  <Upload />
                </div>
                <div className="text-[0.88rem]" style={{ color: "var(--text)", fontWeight: 600 }}>
                  Drag &amp; drop, click to choose, or paste
                </div>
                <div className="muted text-[0.76rem] mt-1">Images are auto-compressed to fit · one file per item</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.csv,.txt,.doc,.docx,.xls,.xlsx"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files) void addFiles(Array.from(e.target.files));
                    e.target.value = "";
                  }}
                />
              </div>

              {/* Notes */}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Paste text or add context — e.g. 'GBP calls up 18% MoM per the screenshot', or notes from a Google Ads export…"
                rows={3}
                style={{ width: "100%", marginTop: 14, padding: "11px 13px", borderRadius: "var(--r-md)", border: "1px solid var(--hair)", background: "var(--surface)", color: "var(--text)", fontSize: "0.86rem", resize: "vertical" }}
              />

              {error ? (
                <div className="chip risk" style={{ marginTop: 12 }}>
                  {error}
                </div>
              ) : null}

              {/* Staged preview */}
              {staged.length ? (
                <div style={{ marginTop: 16 }}>
                  <div className="card-title" style={{ marginBottom: 10 }}>Ready to attach</div>
                  <div className="flex flex-wrap gap-2.5">
                    {staged.map((s) => (
                      <div key={s.localId} style={{ position: "relative", width: 92 }}>
                        {s.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.dataUrl} alt={s.name} style={{ width: 92, height: 68, objectFit: "cover", borderRadius: 8, border: "1px solid var(--hair)" }} />
                        ) : (
                          <div style={{ width: 92, height: 68, borderRadius: 8, border: "1px solid var(--hair)", background: "var(--surface-2)", display: "grid", placeItems: "center", color: "var(--slate-400)" }}>
                            <FileText />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setStaged((arr) => arr.filter((x) => x.localId !== s.localId))}
                          style={{ position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: "50%", background: "var(--risk)", color: "#fff", display: "grid", placeItems: "center" }}
                          aria-label="Remove"
                        >
                          <X style={{ width: 12, height: 12 }} />
                        </button>
                        <div className="muted" style={{ fontSize: "0.64rem", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.name}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex items-center justify-between" style={{ marginTop: 18 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} type="button">
                  Close
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={!hasStaged || busy} type="button" style={!hasStaged || busy ? { opacity: 0.5 } : undefined}>
                  {busy ? "Saving…" : `Attach ${staged.length + (note.trim() ? 1 : 0) || ""}`.trim()}
                </button>
              </div>

              {/* Existing attachments */}
              {attachments.length ? (
                <div style={{ marginTop: 22, borderTop: "1px solid var(--hair)", paddingTop: 16 }}>
                  <div className="card-title" style={{ marginBottom: 12 }}>Attached ({attachments.length})</div>
                  <div className="flex flex-col gap-2.5">
                    {attachments.map((a) => (
                      <div key={a.id} className="list-row" style={{ padding: 10, border: "1px solid var(--hair)" }}>
                        {a.kind === "image" && a.dataUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.dataUrl} alt={a.name} style={{ width: 46, height: 40, objectFit: "cover", borderRadius: 6 }} />
                        ) : (
                          <div style={{ width: 46, height: 40, borderRadius: 6, background: "var(--surface-2)", display: "grid", placeItems: "center", color: "var(--slate-400)" }}>
                            {a.kind === "note" ? <FileText style={{ width: 18, height: 18 }} /> : <FileImage style={{ width: 18, height: 18 }} />}
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="text-[0.84rem]" style={{ color: "var(--text)", fontWeight: 550, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {a.kind === "note" ? a.text?.slice(0, 80) : a.name}
                          </div>
                          <div className="muted text-[0.7rem]">
                            {a.kind} · {new Date(a.createdAt).toLocaleDateString("en-US")}
                          </div>
                        </div>
                        {a.dataUrl ? (
                          <a href={a.dataUrl} download={a.name} className="icon-btn" title="Download" style={{ width: 32, height: 32 }}>
                            <Upload style={{ width: 15, height: 15, transform: "rotate(180deg)" }} />
                          </a>
                        ) : null}
                        <button className="icon-btn" onClick={() => void remove(a.id)} title="Delete" type="button" style={{ width: 32, height: 32 }}>
                          <Trash2 style={{ width: 15, height: 15 }} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
