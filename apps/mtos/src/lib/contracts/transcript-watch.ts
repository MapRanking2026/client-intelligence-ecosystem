/**
 * Waiting for the call's transcript, and deciding which Gemini notes are actually the call.
 *
 * After "End call" the account manager is sitting on the Live screen with nothing to do until
 * Google publishes the notes. Four rules govern that wait, and all four exist because the
 * obvious version of this is wrong in a way nobody notices until a recap quotes the wrong
 * meeting:
 *
 *  - **Only the calendar event's own attachments count.** Google attaches the notes Doc to the
 *    event itself, so that is the join key. Searching Drive by client name and date -- which the
 *    older interactive lookup does as a fallback -- can pick up another meeting's notes, and a
 *    recap built on the wrong call is worse than no recap.
 *  - **A Doc with no dialogue is not the call.** Gemini writes a notes Doc per language, and for
 *    a Spanish-speaking client the English one is a short summary with no Transcript tab at all.
 *    Rather than guessing the client's language and hoping, a Doc earns its place by carrying
 *    dialogue; the language is used to order the reads and to break a tie.
 *  - **Two Docs with dialogue in the same language are one call in two parts.** A call that was
 *    stopped and redialled leaves a continuation, and they are joined in time order. Two Docs
 *    with dialogue in DIFFERENT languages are the same call twice, and joining those would count
 *    every sentence twice -- so one is used and the other is kept for reference.
 *  - **The wait ends either way.** The follow-through opens when the transcript is found, or
 *    after fifteen minutes regardless, because an AM must not be held on a screen by a Doc that
 *    is never going to arrive. It keeps polling afterwards.
 *
 * Kept free of Google, Firestore and React so the decisions can be exercised directly: which Doc
 * is the call is the one judgement in this step that nothing downstream can correct.
 */

/** How often the calendar event is re-read while the transcript is missing. */
export const TX_POLL_MS = 60_000;

/** How long the AM is asked to wait before the follow-through opens anyway. */
export const TX_WAIT_MS = 15 * 60_000;

/**
 * Below this, a Transcript tab holds only Gemini's "transcription ended" scaffolding.
 *
 * Deliberately low. The job here is to tell a Doc with dialogue from a Doc with none, not to
 * judge whether a call was long enough -- a genuinely five-minute call is still the call.
 */
export const MIN_DIALOGUE_CHARS = 40;

/**
 * Matches the Transcript tab in both languages.
 *
 * `/transcript/i` does NOT match "Transcripción" -- the tenth letter is a `c`, not a `t` -- so a
 * Spanish notes Doc read with the English-only pattern comes back with no dialogue in it and the
 * whole call looks untranscribed. That is the bug this pattern exists to prevent.
 */
export const TRANSCRIPT_TAB_PATTERN = /transcript|transcripci/i;

/** The Full notes tab in both languages. Must not match "Quick notes" / "Notas rápidas". */
export const FULL_NOTES_TAB_PATTERN = /full\s*notes|notas\s*completas/i;

export type TranscriptLanguage = "en" | "es";

/**
 * The language of a Gemini notes Doc, read off its title.
 *
 * Gemini names them `<event> - <YYYY/MM/DD HH:MM TZ> - Notes by Gemini (Spanish)` in English
 * locales and `... - Notas de Gemini` in Spanish ones, so both the parenthesis and the Spanish
 * product name are real signals. An unlabelled Doc returns undefined rather than being assumed
 * English: the assumption is what sends a Spanish call's dialogue to the bottom of the pile.
 */
export function geminiDocLanguage(title: string): TranscriptLanguage | undefined {
  const value = title.toLowerCase();
  if (/\((spanish|español|espanol|es)\)/.test(value) || value.includes("notas de gemini")) return "es";
  if (/\((english|inglés|ingles|en)\)/.test(value) || value.includes("notes by gemini")) return "en";
  return undefined;
}

export const LANGUAGE_NAME: Record<TranscriptLanguage, string> = {
  en: "English",
  es: "Spanish",
};

/**
 * The call time out of a Gemini title, as a sortable `YYYY/MM/DD HH:MM`.
 *
 * The wall clock rather than an instant: the title carries a zone abbreviation, which is not
 * reliably parseable, and every Doc for one call carries the same abbreviation anyway. For
 * ordering the parts of a single call the local wall time is exact; it is never compared across
 * zones.
 */
export function geminiDocWallClock(title: string): string | undefined {
  const match = /(\d{4}\/\d{2}\/\d{2}) (\d{1,2}):(\d{2})/.exec(title);
  if (!match) return undefined;
  return `${match[1]} ${match[2].padStart(2, "0")}:${match[3]}`;
}

export interface NotesDocRef {
  docId: string;
  name: string;
  url?: string;
}

/**
 * The order to read the attachments in.
 *
 * Only an order: which Doc wins is decided by what is inside it, never by this. The client's
 * language goes first because for a Spanish client the English Doc is a summary with no dialogue,
 * so reading it first spends a Docs API round trip to learn nothing.
 */
export function orderNotesDocs<T extends NotesDocRef>(docs: T[], clientLanguage?: TranscriptLanguage): T[] {
  return [...docs]
    .map((doc, index) => ({
      doc,
      index,
      language: geminiDocLanguage(doc.name),
      clock: geminiDocWallClock(doc.name) || "",
    }))
    .sort((a, b) => {
      const aMatch = clientLanguage && a.language === clientLanguage ? 0 : a.language ? 2 : 1;
      const bMatch = clientLanguage && b.language === clientLanguage ? 0 : b.language ? 2 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      if (a.clock !== b.clock) return a.clock.localeCompare(b.clock);
      // Stable for everything the rules above cannot separate, so one call's Docs are read in a
      // repeatable order and a retry reports the same thing as the first attempt.
      return a.index - b.index;
    })
    .map((entry) => entry.doc);
}

export type TranscriptFileDecision = "used" | "ignored" | "kept";

/** One notes Doc the event carried, and what was done with it. */
export interface TranscriptFile {
  docId: string;
  name: string;
  url?: string;
  decision: TranscriptFileDecision;
  /** Why, in a sentence the AM reads. Never a code. */
  reason: string;
  /** Characters of dialogue found in it, so a thin part can be seen for what it is. */
  chars: number;
  language?: TranscriptLanguage;
}

/** A notes Doc as read from Google, before anything has been decided about it. */
export interface NotesDocRead extends NotesDocRef {
  /** The Transcript tab, trimmed. Empty when the Doc has none. */
  transcript: string;
  /** The Full notes tab, trimmed. Empty when the Doc has none. */
  fullNotes: string;
  /** Drive's own creation time, used to order parts whose titles carry no clock. */
  createdTime?: string;
}

export interface TranscriptSelection {
  files: TranscriptFile[];
  /** The Docs that were joined, in the order they were joined. */
  usedDocIds: string[];
  /** The joined dialogue, with a header per part once there is more than one. */
  transcript: string;
  /** Gemini's own summary from the first used Doc, when it has one. */
  fullNotes: string;
  /** The language the dialogue came back in, once it is known. */
  language?: TranscriptLanguage;
}

function partHeader(file: { name: string }): string {
  return `----- ${file.name} -----`;
}

/**
 * Decide which of the event's notes Docs are the call, and join them.
 *
 * Reads as a sequence of eliminations rather than a score, because every outcome has to be
 * explainable to the AM in one sentence: a Doc is either the call, a duplicate of it in the other
 * language, or not the call at all.
 */
export function selectTranscriptDocs(
  reads: NotesDocRead[],
  options: { clientLanguage?: TranscriptLanguage } = {},
): TranscriptSelection {
  const graded = reads.map((read) => ({
    read,
    language: geminiDocLanguage(read.name),
    clock: geminiDocWallClock(read.name) || read.createdTime || "",
    chars: read.transcript.trim().length,
  }));

  const files: TranscriptFile[] = [];
  const withDialogue = graded.filter((entry) => entry.chars >= MIN_DIALOGUE_CHARS);

  for (const entry of graded) {
    if (entry.chars >= MIN_DIALOGUE_CHARS) continue;
    files.push({
      docId: entry.read.docId,
      name: entry.read.name,
      ...(entry.read.url ? { url: entry.read.url } : {}),
      decision: "ignored",
      reason: entry.read.fullNotes.trim()
        ? "A summary with no transcript in it, so it is not the dialogue — Gemini writes one of these per language and only one of them carries the call."
        : "Empty — no transcript and no summary, which is what Gemini leaves behind when a join dropped and was redialled.",
      chars: entry.chars,
      ...(entry.language ? { language: entry.language } : {}),
    });
  }

  if (!withDialogue.length) {
    return { files, usedDocIds: [], transcript: "", fullNotes: "" };
  }

  // Group by language, then pick one group. Two Docs with dialogue in two languages are one call
  // written twice, and joining both would count every sentence twice.
  const groups = new Map<string, typeof withDialogue>();
  for (const entry of withDialogue) {
    const key = entry.language || "unknown";
    groups.set(key, [...(groups.get(key) || []), entry]);
  }

  const preferred = options.clientLanguage && groups.get(options.clientLanguage);
  const chosenKey =
    preferred?.length && options.clientLanguage
      ? options.clientLanguage
      : // No preference, or the client's language carried no dialogue: the longest group is the
        // call, because the duplicate in the other language is the short one.
        [...groups.entries()].sort((a, b) => {
          const aChars = a[1].reduce((sum, entry) => sum + entry.chars, 0);
          const bChars = b[1].reduce((sum, entry) => sum + entry.chars, 0);
          return bChars - aChars;
        })[0][0];

  const used = [...(groups.get(chosenKey) || [])].sort((a, b) => a.clock.localeCompare(b.clock));
  const usedLanguage = used[0]?.language;

  for (const entry of used) {
    files.push({
      docId: entry.read.docId,
      name: entry.read.name,
      ...(entry.read.url ? { url: entry.read.url } : {}),
      decision: "used",
      reason:
        used.length > 1
          ? "Joined in time order — the call was stopped and restarted, so this is one part of it."
          : "The call itself, attached to this touch's calendar event.",
      chars: entry.chars,
      ...(entry.language ? { language: entry.language } : {}),
    });
  }

  for (const [key, group] of groups) {
    if (key === chosenKey) continue;
    for (const entry of group) {
      files.push({
        docId: entry.read.docId,
        name: entry.read.name,
        ...(entry.read.url ? { url: entry.read.url } : {}),
        decision: "kept",
        reason: `The same call again in ${
          entry.language ? LANGUAGE_NAME[entry.language] : "another language"
        }. Kept for reference and not joined, so nothing is counted twice.`,
        chars: entry.chars,
        ...(entry.language ? { language: entry.language } : {}),
      });
    }
  }

  const transcript =
    used.length > 1
      ? used.map((entry) => [partHeader(entry.read), entry.read.transcript.trim()].join("\n")).join("\n\n")
      : used[0].read.transcript.trim();

  return {
    files,
    usedDocIds: used.map((entry) => entry.read.docId),
    transcript,
    // The summary from the first part. Gemini re-summarises each part separately, so stacking
    // them would read as the same meeting happening twice.
    fullNotes: used[0].read.fullNotes.trim(),
    ...(usedLanguage ? { language: usedLanguage } : {}),
  };
}

// ---------------------------------------------------------------------------
// The wait itself
// ---------------------------------------------------------------------------

export type TranscriptWaitPhase =
  /** The call has not ended, so there is nothing to wait for yet. */
  | "not_ended"
  /** Waiting on Google to publish the notes. */
  | "waiting"
  /** Found and joined from the calendar event. */
  | "found"
  /** Pasted or attached by the AM. */
  | "attached"
  /** The event has notes, but none of them carry dialogue. */
  | "none";

export interface TranscriptWaitView {
  phase: TranscriptWaitPhase;
  /** Milliseconds since the call ended. 0 before it has. */
  elapsedMs: number;
  /** Whether the fifteen minutes are up. */
  waitedOut: boolean;
  /** Whether the Begin follow-through button belongs on screen. */
  canBeginFollowThrough: boolean;
  /** Whether the event should still be re-read every minute. */
  keepPolling: boolean;
  /** The headline, e.g. "Waiting for the transcript — 4 min". */
  label: string;
  /** The sentence under it: where MTOS is looking, or what it found. */
  detail: string;
}

function minutes(ms: number): number {
  return Math.floor(ms / 60_000);
}

/**
 * What the wait panel shows, and whether the follow-through may be opened.
 *
 * The fifteen-minute fallback is deliberately not a timeout: polling continues afterwards, and
 * the follow-through says it is still waiting. A transcript that turns up at minute twenty is
 * still the transcript, and an AM who has started writing notes should get it rather than be told
 * the search was abandoned.
 */
export function transcriptWaitView(options: {
  callEndedAt?: string;
  status?: TranscriptWaitPhase | "waiting" | "found" | "attached" | "none";
  usedCount?: number;
  /**
   * What the last look actually found, from the watcher.
   *
   * Preferred over the generic sentence for the phase, because the phase is far coarser than the
   * reasons: "waiting" covers Gemini not having published yet AND Google refusing the calendar
   * read, and "none" covers a call nobody transcribed AND a touch with no calendar event. Telling
   * an AM that transcription was off for a call when the real problem is a disconnected
   * integration sends them looking in the wrong place.
   */
  note?: string;
  nowIso?: string;
}): TranscriptWaitView {
  const ended = options.callEndedAt ? Date.parse(options.callEndedAt) : Number.NaN;
  if (Number.isNaN(ended)) {
    return {
      phase: "not_ended",
      elapsedMs: 0,
      waitedOut: false,
      canBeginFollowThrough: false,
      keepPolling: false,
      label: "The call has not ended yet",
      detail: "End the call above, and MTOS starts looking for the transcript on its calendar event.",
    };
  }

  const now = options.nowIso ? Date.parse(options.nowIso) : Date.now();
  const elapsedMs = Math.max(0, (Number.isNaN(now) ? Date.now() : now) - ended);
  const waitedOut = elapsedMs >= TX_WAIT_MS;

  if (options.status === "found" || options.status === "attached") {
    const count = options.usedCount || 0;
    return {
      phase: options.status,
      elapsedMs,
      waitedOut,
      canBeginFollowThrough: true,
      keepPolling: false,
      label: options.status === "attached" ? "Transcript attached" : "Transcript found",
      detail:
        options.status === "attached"
          ? "Attached by you, so nothing further is being looked for."
          : count > 1
            ? `Joined from ${count} notes Docs on the calendar event, in time order.`
            : "Read from the notes Doc attached to this touch's calendar event.",
    };
  }

  if (options.status === "none") {
    return {
      phase: "none",
      elapsedMs,
      waitedOut,
      canBeginFollowThrough: true,
      keepPolling: true,
      label: "No transcript in the notes Google published",
      detail:
        "The notes Doc on the calendar event has no dialogue in it, which means transcription was off for the call. Attach a transcript below, or begin the follow-through from your own notes.",
    };
  }

  const waited = minutes(elapsedMs);
  return {
    phase: "waiting",
    elapsedMs,
    waitedOut,
    canBeginFollowThrough: waitedOut,
    keepPolling: true,
    label: waited > 0 ? `Waiting for the transcript — ${waited} min` : "Waiting for the transcript",
    detail: waitedOut
      ? "Still checking the calendar event every minute. You can begin the follow-through now — it will pick the transcript up when it arrives."
      : `Checking this touch's Google Calendar event every minute for the notes Gemini writes. The follow-through opens as soon as it arrives, or after ${minutes(
          TX_WAIT_MS,
        )} minutes either way.`,
  };
}

/**
 * The view with the watcher's own sentence in place of the generic one for the phase.
 *
 * A wrapper rather than a branch inside every return above: the phase decides what the AM may do
 * next, and the note only decides what they are told, so the two are worth keeping apart.
 */
export function transcriptWaitPanel(options: Parameters<typeof transcriptWaitView>[0]): TranscriptWaitView {
  const view = transcriptWaitView(options);
  const note = options.note?.trim();
  if (!note || view.phase === "not_ended" || view.phase === "found" || view.phase === "attached") {
    return view;
  }
  return {
    ...view,
    detail: view.waitedOut && view.phase === "waiting" ? `${note} You can begin the follow-through now.` : note,
  };
}
