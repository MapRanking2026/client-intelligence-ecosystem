import { createHash } from "node:crypto";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import { MAX_PRESENTATION_MEDIA } from "@/src/lib/contracts/presentation-media";
import type { MonthlyTouchRecord, PresentationMedia } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath, presentationMediaPath } from "@/src/lib/server/firebase/collections";

/**
 * The images an account manager uploads for a month's deck.
 *
 * The deck has always been written from what MTOS already holds. This is the one door for
 * material that only the account manager has: the screenshot of the thing the client complained
 * about, the photo from the site visit, the page of the audit PDF that makes the point better
 * than a bullet can. The PDF itself never arrives here -- the browser renders the pages the
 * account manager picked and uploads those, because a page is what a slide can show and a 40-page
 * attachment is not something to carry around in Firestore.
 *
 * Nothing in MTOS can see inside these images, and nothing pretends to: the model that writes the
 * deck gets each file's name and the account manager's note, and writes its caption from those.
 * That is the whole reason `note` exists.
 */

/**
 * Firestore stops a single document at 1MB. The base64 goes into 600k chunks under the image's
 * own document, the same shape the rank captures use, so one large screenshot cannot fail a save.
 */
const CHUNK = 600_000;

/** ~6MB of base64 per image: a full-page screenshot at 2x, with room to spare. */
const MAX_BASE64 = 8_000_000;

export interface NewPresentationMedia {
  name: string;
  /** A data URL: `data:image/png;base64,...` or the JPEG equivalent. */
  dataUrl: string;
  width: number;
  height: number;
  note?: string;
  sourceName?: string;
  page?: number;
}

/** The touch, if this account may see it at all. Every entry point goes through here. */
async function visibleTouch(context: TenantContext, touchId: string): Promise<MonthlyTouchRecord> {
  const touch = await getMtosDataSource(context).getMonthlyTouchById(touchId);
  if (!touch) throw new Error("This Monthly Touch is not available to your account.");
  return touch;
}

export async function listPresentationMedia(context: TenantContext, touchId: string): Promise<PresentationMedia[]> {
  return (await visibleTouch(context, touchId)).presentationMedia || [];
}

/**
 * Store one image and record it on the touch.
 *
 * The id is the hash of the bytes, so uploading the same screenshot twice replaces the entry
 * rather than filling the list with copies of it -- a real thing on a call, where the account
 * manager re-drags the file after editing a note.
 */
export async function addPresentationMedia(
  context: TenantContext,
  touchId: string,
  input: NewPresentationMedia,
): Promise<PresentationMedia> {
  await visibleTouch(context, touchId);
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("MTOS storage is unavailable.");

  const match = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(input.dataUrl.trim());
  if (!match) throw new Error("Upload a PNG or JPEG image. PDF pages are turned into images in your browser before they are sent.");
  const mimeType = match[1] as PresentationMedia["mimeType"];
  const base64 = match[2];
  if (base64.length > MAX_BASE64) throw new Error("This image is too large to store. Reduce its size or upload the part of it that matters.");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) throw new Error("That file arrived empty.");
  if (!Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width < 1 || input.height < 1) {
    throw new Error("The image dimensions are missing, so the slide cannot place it without distorting it.");
  }

  const id = createHash("sha256").update(bytes).digest("hex");
  const media: PresentationMedia = {
    id,
    touchId,
    name: input.name.trim().slice(0, 200) || "Uploaded image",
    width: Math.round(input.width),
    height: Math.round(input.height),
    mimeType,
    bytes: bytes.length,
    uploadedAt: new Date().toISOString(),
    uploadedBy: context.userId,
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, 1000) } : {}),
    ...(input.sourceName?.trim() ? { sourceName: input.sourceName.trim().slice(0, 200) } : {}),
    ...(Number.isFinite(input.page) && (input.page || 0) > 0 ? { page: Math.round(input.page!) } : {}),
  };

  const ref = db.doc(presentationMediaPath(context.tenantId, touchId, id));
  const chunks = Math.ceil(base64.length / CHUNK);
  const batch = db.batch();
  for (let index = 0; index < chunks; index++) {
    batch.set(ref.collection("chunks").doc(String(index)), { data: base64.slice(index * CHUNK, (index + 1) * CHUNK) });
  }
  batch.set(ref, { ...media, chunks });
  await batch.commit();

  // The descriptor list is read back inside the transaction: two uploads dropped at once would
  // otherwise each write the list they read before the other, and the first one would vanish.
  await db.runTransaction(async (tx) => {
    const touchRef = db.doc(monthlyTouchPath(context.tenantId, touchId));
    const fresh = (await tx.get(touchRef)).data() as MonthlyTouchRecord | undefined;
    const existing = (fresh?.presentationMedia || []).filter((item) => item.id !== id);
    if (existing.length >= MAX_PRESENTATION_MEDIA) {
      throw new Error(`Keep up to ${MAX_PRESENTATION_MEDIA} uploads on one deck. Remove one before adding another.`);
    }
    tx.update(touchRef, { presentationMedia: [...existing, media] });
  });
  return media;
}

/** The account manager's description. Editable after the fact, since it is what captions are written from. */
export async function describePresentationMedia(
  context: TenantContext,
  touchId: string,
  mediaId: string,
  note: string,
): Promise<PresentationMedia[]> {
  await visibleTouch(context, touchId);
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("MTOS storage is unavailable.");
  const trimmed = note.trim().slice(0, 1000);
  return db.runTransaction(async (tx) => {
    const touchRef = db.doc(monthlyTouchPath(context.tenantId, touchId));
    const fresh = (await tx.get(touchRef)).data() as MonthlyTouchRecord | undefined;
    const list = fresh?.presentationMedia || [];
    if (!list.some((item) => item.id === mediaId)) throw new Error("That upload is no longer on this Monthly Touch.");
    const next = list.map((item) => (item.id === mediaId ? { ...item, ...(trimmed ? { note: trimmed } : { note: "" }) } : item));
    tx.update(touchRef, { presentationMedia: next });
    return next;
  });
}

/**
 * Remove an upload.
 *
 * The bytes go, and so does the descriptor, but a deck already built keeps its own copy of the
 * descriptor on the slide. That slide will then show the missing-image message rather than
 * silently losing its frame -- the same way a rank comparison does when its capture is gone.
 */
export async function removePresentationMedia(
  context: TenantContext,
  touchId: string,
  mediaId: string,
): Promise<PresentationMedia[]> {
  await visibleTouch(context, touchId);
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("MTOS storage is unavailable.");
  const ref = db.doc(presentationMediaPath(context.tenantId, touchId, mediaId));
  await db.recursiveDelete(ref);
  return db.runTransaction(async (tx) => {
    const touchRef = db.doc(monthlyTouchPath(context.tenantId, touchId));
    const fresh = (await tx.get(touchRef)).data() as MonthlyTouchRecord | undefined;
    const next = (fresh?.presentationMedia || []).filter((item) => item.id !== mediaId);
    tx.update(touchRef, { presentationMedia: next });
    return next;
  });
}

/** The stored image, reassembled. Used by the viewer, the .pptx export and the uploader's thumbnails. */
export async function loadPresentationMedia(
  context: TenantContext,
  touchId: string,
  mediaId: string,
): Promise<{ bytes: Buffer; mimeType: PresentationMedia["mimeType"] }> {
  await visibleTouch(context, touchId);
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("MTOS storage is unavailable.");
  const ref = db.doc(presentationMediaPath(context.tenantId, touchId, mediaId));
  const snapshot = await ref.get();
  const saved = snapshot.data() as (PresentationMedia & { chunks: number }) | undefined;
  if (!saved) throw new Error("That uploaded image is no longer stored on this Monthly Touch.");
  const chunks = await Promise.all(
    Array.from({ length: saved.chunks }, (_, index) => ref.collection("chunks").doc(String(index)).get()),
  );
  return {
    bytes: Buffer.from(chunks.map((chunk) => (chunk.data()?.data as string) || "").join(""), "base64"),
    mimeType: saved.mimeType || "image/png",
  };
}
