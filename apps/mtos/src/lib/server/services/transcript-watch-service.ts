import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { MonthlyTouchRecord, TouchTranscriptState } from "@/src/lib/mtos-data";
import {
  type NotesDocRead,
  type TranscriptFile,
  type TranscriptLanguage,
  orderNotesDocs,
  selectTranscriptDocs,
} from "@/src/lib/contracts/transcript-watch";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchArtifactPath, monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import {
  CALENDAR_API,
  FULL_NOTES_MARKER,
  TRANSCRIPT_MARKER,
  docUrl,
  googleGet,
  parseDocIdFromUrl,
  readNotesDoc,
  resolveAccessToken,
} from "@/src/lib/server/services/meeting-transcript-service";

/**
 * The transcript watch that runs after "End call".
 *
 * Deliberately narrower than the interactive lookup in `meeting-transcript-service`. That one
 * falls back to searching Drive by client name and date, which is right when an AM is hunting for
 * a transcript by hand and can see what came back -- and wrong for an unattended poll, because
 * one client can have two Docs on one day and a recap built from the wrong call is worse than no
 * recap at all. This one reads the touch's own calendar event and nothing else.
 *
 * It reads EVERY notes Doc the event carries rather than picking one. A call that was stopped and
 * redialled leaves a continuation, and Gemini writes a separate Doc per language, so "the notes
 * Doc" is routinely three or four documents of which one or two are the call. Which ones is
 * decided by `selectTranscriptDocs`, and every Doc is reported with what was done to it.
 *
 * Nothing it writes is irreversible: the state is a record of what was found, the payload lands in
 * the touch's artifacts subcollection, and a transcript the AM attached by hand is never
 * overwritten by a later poll.
 */

/** The one artifact id this service writes. */
export const TRANSCRIPT_ARTIFACT_ID = "transcript";

/**
 * At most this many Docs are read per poll.
 *
 * The poll runs every minute for fifteen minutes, so an uncapped read of a client with a long
 * history of redials would be a few hundred Docs API round trips per call. Six covers every real
 * case seen so far -- two languages times a redial, plus a stray.
 */
const MAX_DOCS = 6;

interface CalendarAttachment {
  fileUrl?: string;
  title?: string;
}

export interface TranscriptWatchResult {
  transcript: TouchTranscriptState;
  /** The joined dialogue, when there is any. Returned so the caller need not read it back. */
  payload?: string;
}

/**
 * Every Google Docs attachment on the event, in the order Google lists them.
 *
 * All of them, not just the one titled "Notes by Gemini": a Spanish notes Doc is titled "Notas de
 * Gemini", and a redial's continuation is a second attachment with the same title as the first.
 * Non-Docs attachments -- an agenda, a deck the AM attached by hand -- carry no Docs id and fall
 * out here.
 */
function eventNotesAttachments(attachments: CalendarAttachment[] | undefined) {
  const seen = new Set<string>();
  const docs: { docId: string; name: string; url: string }[] = [];
  for (const attachment of attachments || []) {
    const docId = parseDocIdFromUrl(attachment.fileUrl || "");
    if (!docId || seen.has(docId)) continue;
    seen.add(docId);
    docs.push({ docId, name: attachment.title || "Notes by Gemini", url: docUrl(docId) });
  }
  return docs;
}

/** The language this client's notes should be read in, as far as anything in MTOS records it. */
function clientLanguage(touch: MonthlyTouchRecord): TranscriptLanguage | undefined {
  // The client profile has no language field yet, so the nearest real signal is the language the
  // deck for this client was written in. Never a guess from the client's name or location.
  const stored = touch.transcript?.lang;
  if (stored === "en" || stored === "es") return stored;
  const deck = touch.presentation?.language;
  return deck === "en" || deck === "es" ? deck : undefined;
}

function payloadOf(fullNotes: string, transcript: string): string {
  return [...(fullNotes ? [FULL_NOTES_MARKER, fullNotes, ""] : []), TRANSCRIPT_MARKER, transcript].join("\n");
}

async function persist(
  context: TenantContext,
  touchId: string,
  state: TouchTranscriptState,
  payload?: string,
): Promise<TranscriptWatchResult> {
  const db = getFirebaseAdminDb();
  if (db) {
    // `mergeFields` so a poll can never touch anything else on the touch: the live notes autosave
    // and the preparation both write this document, and a whole-document merge from here would
    // restore whatever this request happened to have read.
    await db.doc(monthlyTouchPath(context.tenantId, touchId)).set({ transcript: state }, {
      mergeFields: ["transcript"],
    });
    if (payload) {
      await db
        .doc(monthlyTouchArtifactPath(context.tenantId, touchId, TRANSCRIPT_ARTIFACT_ID))
        .set({ payload, savedAt: new Date().toISOString() });
    }
  }
  return { transcript: state, ...(payload ? { payload } : {}) };
}

/**
 * Look once for this touch's transcript, and record what was found.
 *
 * Called on a one-minute poll from the Live step, so every expected failure comes back as a state
 * with a sentence in `note` rather than as a thrown error: a connection the AM has to fix, an
 * event with no notes yet, and a call nobody transcribed are all things to say on screen, not
 * faults.
 */
export async function watchTouchTranscript(
  context: TenantContext,
  touchId: string,
): Promise<TranscriptWatchResult> {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }

  const checkedAt = new Date().toISOString();
  const previous = touch.transcript;

  // A transcript the AM attached by hand is the AM's decision, and a poll must not overrule it.
  if (previous?.status === "attached") {
    return { transcript: previous };
  }

  const base: TouchTranscriptState = {
    status: "waiting",
    docIds: [],
    lastCheckedAt: checkedAt,
  };

  if (!touch.calendarEventId) {
    return persist(context, touchId, {
      ...base,
      status: "none",
      note:
        "This touch has no Google Calendar event linked to it, and the notes Doc is attached to the event — so there is nothing to read it from. Attach the transcript below.",
    });
  }

  const token = await resolveAccessToken(context);
  if (!token.ok) {
    // The reason from the integration layer says exactly what to reconnect, so it is passed
    // through verbatim rather than restated more vaguely here.
    return persist(context, touchId, { ...base, status: "none", note: token.lookup.reason });
  }

  const eventUrl = new URL(
    `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(touch.calendarEventId)}`,
  );
  const eventResult = await googleGet(eventUrl.toString(), token.accessToken);
  if (!eventResult.ok) {
    return persist(context, touchId, {
      ...base,
      status: eventResult.status === 404 ? "none" : "waiting",
      note:
        eventResult.status === 404
          ? "The calendar event this touch was booked on no longer exists on your calendar, so MTOS cannot read the notes attached to it. Attach the transcript below."
          : `Google would not return the calendar event (${eventResult.message}). Still checking every minute.`,
    });
  }

  const attachments = eventNotesAttachments(
    (eventResult.payload as { attachments?: CalendarAttachment[] }).attachments,
  );
  if (!attachments.length) {
    return persist(context, touchId, {
      ...base,
      note:
        "The calendar event has no notes Doc attached yet. Gemini usually attaches it a few minutes after the call ends.",
    });
  }

  const language = clientLanguage(touch);
  const reads: NotesDocRead[] = [];
  const unreadable: TranscriptFile[] = [];

  for (const attachment of orderNotesDocs(attachments, language).slice(0, MAX_DOCS)) {
    const read = await readNotesDoc(token.accessToken, attachment.docId);
    if (read.kind === "ok") {
      reads.push({
        docId: read.doc.id,
        // Drive's name rather than the attachment title: the attachment title is a label Google
        // wrote once, and the Doc's own name is what the AM sees if they open it.
        name: read.doc.title || attachment.name,
        url: read.doc.url,
        transcript: read.transcript,
        fullNotes: read.fullNotes,
        ...(read.doc.createdTime ? { createdTime: read.doc.createdTime } : {}),
      });
      continue;
    }
    unreadable.push({
      docId: attachment.docId,
      name: attachment.name,
      url: attachment.url,
      decision: "ignored",
      reason:
        read.kind === "unreadable"
          ? "This Google account cannot open it — the call was hosted by someone else and the Doc has not been shared."
          : `Google would not return it: ${read.message}`,
      chars: 0,
    });
  }

  const selection = selectTranscriptDocs(reads, { ...(language ? { clientLanguage: language } : {}) });
  const files = [...selection.files, ...unreadable];

  if (!selection.usedDocIds.length) {
    // A Doc with a summary and no dialogue is finished and will not grow a transcript: that call
    // was not transcribed. A Doc with neither is Gemini still writing, so the wait continues.
    const summaryOnly = reads.some((read) => read.fullNotes.trim() && read.transcript.trim().length < 40);
    return persist(context, touchId, {
      ...base,
      status: summaryOnly ? "none" : "waiting",
      files,
      ...(language ? { lang: language } : {}),
      note: summaryOnly
        ? "Google published the notes for this call but there is no dialogue in them, which means transcription was off. Attach a transcript below, or write the follow-through from your own notes."
        : `${files.length} notes ${files.length === 1 ? "Doc is" : "Docs are"} attached to the event but none carry dialogue yet. Still checking every minute.`,
    });
  }

  return persist(
    context,
    touchId,
    {
      status: "found",
      docIds: selection.usedDocIds,
      files,
      ...(selection.language ? { lang: selection.language } : {}),
      chars: selection.transcript.length,
      foundAt: previous?.foundAt || checkedAt,
      lastCheckedAt: checkedAt,
    },
    payloadOf(selection.fullNotes, selection.transcript),
  );
}

/**
 * Attach a transcript by hand.
 *
 * The escape hatch for every case the automatic path cannot cover: a call on Zoom, a call hosted
 * by the client, a call nobody transcribed. Stored as `attached` so later polls leave it alone --
 * the AM pasting the dialogue is a decision, not a guess to be improved on.
 */
export async function attachTouchTranscript(
  context: TenantContext,
  touchId: string,
  text: string,
): Promise<TranscriptWatchResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("There is nothing in that transcript to attach.");
  }

  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }

  const now = new Date().toISOString();
  // Anything already carrying the section markers is passed through untouched, so a payload read
  // from Google and edited by the AM keeps its two labelled halves.
  const payload = trimmed.includes(TRANSCRIPT_MARKER) ? trimmed : payloadOf("", trimmed);

  return persist(
    context,
    touchId,
    {
      status: "attached",
      docIds: [],
      // Whatever a poll found before is kept: the AM may have attached the dialogue because the
      // Doc Google published was the wrong call, and that list is the evidence for it.
      ...(touch.transcript?.files ? { files: touch.transcript.files } : {}),
      ...(touch.transcript?.lang ? { lang: touch.transcript.lang } : {}),
      chars: trimmed.length,
      foundAt: now,
      lastCheckedAt: now,
      note: "Attached by you, so MTOS has stopped looking.",
    },
    payload,
  );
}

/** The joined transcript for this touch, for the follow-through to be written from. */
export async function readTouchTranscriptPayload(
  context: TenantContext,
  touchId: string,
): Promise<string | undefined> {
  const db = getFirebaseAdminDb();
  if (!db) return undefined;
  const snapshot = await db
    .doc(monthlyTouchArtifactPath(context.tenantId, touchId, TRANSCRIPT_ARTIFACT_ID))
    .get();
  const payload = snapshot.exists ? (snapshot.data() as { payload?: unknown } | undefined)?.payload : undefined;
  return typeof payload === "string" && payload.trim() ? payload : undefined;
}
