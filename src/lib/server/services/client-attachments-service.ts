import { nanoid } from "nanoid";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import {
  clientAttachmentPath,
  clientAttachmentsCollectionPath,
} from "@/src/lib/server/firebase/collections";

export type ClientAttachmentKind = "image" | "file" | "note";

export interface ClientAttachment {
  id: string;
  kind: ClientAttachmentKind;
  name: string;
  mimeType?: string;
  size?: number;
  /** base64 data URL for image/file kinds (kept small enough for a Firestore doc). */
  dataUrl?: string;
  /** pasted / typed text for the note kind. */
  text?: string;
  createdAt: string;
  createdBy?: string;
}

export interface NewClientAttachment {
  kind: ClientAttachmentKind;
  name: string;
  mimeType?: string;
  size?: number;
  dataUrl?: string;
  text?: string;
}

/** Firestore documents cap at ~1 MiB; keep the base64 payload safely under that. */
export const MAX_DATAURL_CHARS = 950_000;

export async function listClientAttachments(
  context: TenantContext,
  clientId: string,
): Promise<ClientAttachment[]> {
  const db = getFirebaseAdminDb();
  if (!db) return [];
  const snapshot = await db
    .collection(clientAttachmentsCollectionPath(context.tenantId, clientId))
    .orderBy("createdAt", "desc")
    .get();
  return snapshot.docs.map((doc) => doc.data() as ClientAttachment);
}

/** Cheap count (aggregation) — avoids reading every base64 doc just to show a badge. */
export async function countClientAttachments(context: TenantContext, clientId: string): Promise<number> {
  const db = getFirebaseAdminDb();
  if (!db) return 0;
  const snapshot = await db
    .collection(clientAttachmentsCollectionPath(context.tenantId, clientId))
    .count()
    .get();
  return snapshot.data().count;
}

export async function addClientAttachment(
  context: TenantContext,
  clientId: string,
  input: NewClientAttachment,
): Promise<ClientAttachment> {
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("Storage is not configured.");

  if (input.dataUrl && input.dataUrl.length > MAX_DATAURL_CHARS) {
    throw new Error(
      "This file is too large to store here — keep uploads under ~650 KB (screenshots usually are; compress or crop larger files).",
    );
  }
  if (input.kind === "note" ? !input.text?.trim() : !input.dataUrl) {
    throw new Error("Nothing to attach.");
  }

  const id = nanoid();
  const attachment: ClientAttachment = {
    id,
    kind: input.kind,
    name: input.name,
    createdAt: new Date().toISOString(),
    createdBy: context.userId,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    ...(input.size ? { size: input.size } : {}),
    ...(input.dataUrl ? { dataUrl: input.dataUrl } : {}),
    ...(input.text ? { text: input.text } : {}),
  };

  await db.doc(clientAttachmentPath(context.tenantId, clientId, id)).set(attachment);
  return attachment;
}

export async function deleteClientAttachment(
  context: TenantContext,
  clientId: string,
  attachmentId: string,
): Promise<void> {
  const db = getFirebaseAdminDb();
  if (!db) return;
  await db.doc(clientAttachmentPath(context.tenantId, clientId, attachmentId)).delete();
}
