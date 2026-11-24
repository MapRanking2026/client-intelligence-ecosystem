"use client";

/* eslint-disable @next/next/no-img-element -- Thumbnails are private per-touch bytes served from Firestore, not optimisable assets. */
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { PresentationMedia } from "@/src/lib/mtos-data";
import { MAX_PRESENTATION_MEDIA } from "@/src/lib/contracts/presentation-media";

/**
 * Attaching your own material to the deck: a screenshot, a photo, or pages out of a PDF.
 *
 * Two things are worth knowing about how this works, and the panel says both out loud.
 *
 * A PDF never reaches the server. It is opened here, in the browser, its pages are drawn to a
 * canvas, and the pages the account manager picks are uploaded as images. A slide can show a
 * page; it cannot show a 40-page attachment, and rendering PDFs on a serverless function to find
 * that out would be a slow way to arrive at the same place.
 *
 * And nothing reads the picture. The note is the only description of it that exists anywhere, so
 * it is what the deck writer is given and what any caption is written from. An upload with no
 * note gets a slide with its file name on it, which is rarely what anybody wanted.
 */

/** Longest edge of a stored image. Beyond this a deck slide gains nothing and the upload slows. */
const MAX_EDGE = 1800;

interface StagedPage {
  page: number;
  dataUrl: string;
  width: number;
  height: number;
  selected: boolean;
}

function canvasToUpload(canvas: HTMLCanvasElement, preferPng: boolean) {
  // PNG for anything rendered from a document or a screenshot -- text stays crisp and the flat
  // colour compresses well. JPEG for photographs, where PNG would be several times the size.
  const dataUrl = preferPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.88);
  if (preferPng && dataUrl.length > 6_000_000) return canvas.toDataURL("image/jpeg", 0.88);
  return dataUrl;
}

function fitted(width: number, height: number) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function imageUpload(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const size = fitted(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the image.");
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return { dataUrl: canvasToUpload(canvas, file.type === "image/png"), ...size };
  } finally {
    bitmap.close();
  }
}

export function PresentationMediaUploader({ touchId, initial = [] }: { touchId: string; initial?: PresentationMedia[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [notes, setNotes] = useState<Record<string, string>>(() => Object.fromEntries(initial.map((item) => [item.id, item.note || ""])));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [pdf, setPdf] = useState<{ name: string; pages: StagedPage[] } | null>(null);

  async function post(body: object) {
    const response = await fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}/presentation-media`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as { data?: PresentationMedia[]; error?: string };
    if (!response.ok || !result.data) throw new Error(result.error || "The upload could not be saved.");
    setItems(result.data);
    setNotes((current) => ({ ...Object.fromEntries(result.data!.map((item) => [item.id, item.note || ""])), ...current }));
    return result.data;
  }

  async function withBusy(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    try {
      await work();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy("");
    }
  }

  /** Open a PDF here and draw its pages, so the account manager picks the ones worth a slide. */
  async function stagePdf(file: File) {
    const pdfjs = await import("pdfjs-dist");
    // The worker ships with the package; the bundler emits it beside this chunk.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const document_ = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    try {
      const count = Math.min(document_.numPages, 40);
      const pages: StagedPage[] = [];
      for (let number = 1; number <= count; number++) {
        const page = await document_.getPage(number);
        const unscaled = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, MAX_EDGE / Math.max(unscaled.width, unscaled.height)) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This browser could not draw the PDF pages.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, viewport }).promise;
        pages.push({ page: number, dataUrl: canvasToUpload(canvas, true), width: canvas.width, height: canvas.height, selected: false });
      }
      setPdf({ name: file.name, pages });
    } finally {
      await document_.destroy();
    }
  }

  function choose(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      void withBusy(`Opening ${file.name}…`, () => stagePdf(file));
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Attach an image (PNG or JPEG) or a PDF.");
      return;
    }
    void withBusy(`Uploading ${file.name}…`, async () => {
      const prepared = await imageUpload(file);
      await post({ action: "add", name: file.name, ...prepared });
    });
  }

  const staged = pdf?.pages.filter((page) => page.selected) || [];

  return (
    <div className="grid gap-3">
      <div>
        <label className="field-label" htmlFor={`presentation-media-${touchId}`}>Images and PDF pages for this deck</label>
        <input
          id={`presentation-media-${touchId}`}
          className="input"
          type="file"
          accept="image/png,image/jpeg,application/pdf"
          disabled={Boolean(busy)}
          onChange={(event) => {
            choose(event.target.files);
            event.target.value = "";
          }}
        />
        <p className="field-hint">
          A PDF is opened in your browser and you pick the pages to include; the document itself is not uploaded.
          Up to {MAX_PRESENTATION_MEDIA} images on one deck. Write what each one shows — nothing here can see inside
          the picture, so the note is what the slide caption is written from.
        </p>
      </div>

      {pdf ? (
        <div className="card grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{pdf.name} · {pdf.pages.length} page{pdf.pages.length === 1 ? "" : "s"}</strong>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-sm"
                disabled={Boolean(busy) || !staged.length}
                onClick={() => void withBusy(`Adding ${staged.length} page${staged.length === 1 ? "" : "s"}…`, async () => {
                  for (const page of staged) {
                    await post({
                      action: "add",
                      name: `${pdf.name} — page ${page.page}`,
                      sourceName: pdf.name,
                      page: page.page,
                      dataUrl: page.dataUrl,
                      width: page.width,
                      height: page.height,
                    });
                  }
                  setPdf(null);
                })}
              >
                Add {staged.length || ""} selected page{staged.length === 1 ? "" : "s"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => setPdf(null)}>Discard</button>
            </div>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
            {pdf.pages.map((page) => (
              <label key={page.page} className="grid gap-1" style={{ cursor: "pointer" }}>
                <img
                  src={page.dataUrl}
                  alt={`Page ${page.page}`}
                  style={{ width: "100%", border: page.selected ? "2px solid var(--accent)" : "1px solid var(--hair)", borderRadius: 6 }}
                />
                <span className="text-xs">
                  <input
                    type="checkbox"
                    checked={page.selected}
                    onChange={(event) => setPdf((current) => current && {
                      ...current,
                      pages: current.pages.map((item) => (item.page === page.page ? { ...item, selected: event.target.checked } : item)),
                    })}
                  />{" "}
                  Page {page.page}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {items.length ? (
        <ul className="grid gap-3" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((item) => (
            <li key={item.id} className="card grid gap-2" style={{ gridTemplateColumns: "140px minmax(0, 1fr)", alignItems: "start" }}>
              <img
                src={`/api/monthly-touches/${encodeURIComponent(touchId)}/presentation-media?image=${encodeURIComponent(item.id)}`}
                alt={item.note || item.name}
                style={{ width: "100%", borderRadius: 6, border: "1px solid var(--hair)" }}
              />
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm">{item.sourceName ? `${item.sourceName} · page ${item.page}` : item.name}</strong>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={Boolean(busy)}
                    onClick={() => void withBusy("Removing…", () => post({ action: "remove", id: item.id }))}
                  >
                    Remove
                  </button>
                </div>
                <label className="field-label">
                  What does this show?
                  <textarea
                    className="textarea"
                    rows={2}
                    maxLength={1000}
                    value={notes[item.id] ?? ""}
                    placeholder="Example: The booking page on a phone, showing the form the client said was cut off."
                    onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                    onBlur={() => {
                      if ((notes[item.id] ?? "") === (item.note || "")) return;
                      void withBusy("Saving…", () => post({ action: "describe", id: item.id, note: notes[item.id] ?? "" }));
                    }}
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {busy ? <p role="status" className="field-hint">{busy}</p> : null}
      {error ? <p role="alert" className="field-hint">{error}</p> : null}
    </div>
  );
}
