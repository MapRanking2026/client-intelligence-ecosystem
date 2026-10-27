import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import {
  getIntegrationConnection,
  getIntegrationCredentials,
  getIntegrationDefinition,
  getMissingIntegrationScopes,
  refreshIntegration,
} from "@/src/lib/server/integrations";

/**
 * Automatic transcript retrieval for the post-meeting step.
 *
 * Francisco's monthly touches run on Google Meet with Gemini note-taking on. A few minutes
 * after the call, Gemini writes ONE Doc named
 * `<event title> - <YYYY/MM/DD HH:MM TZ> - Notes by Gemini[ (<language>)]` whose tabs are
 * Quick notes / Full notes / Transcript. The verbatim dialogue is the Transcript TAB of that
 * Doc -- there is no separate "- Transcript" Drive file, and searching Drive for one finds
 * nothing.
 *
 * How a touch is joined to its Doc (verified against live data 2026-10-26): the calendar
 * event itself carries the Doc in `attachments[]`:
 *
 *   "attachments": [{ "fileUrl": "https://docs.google.com/document/d/<id>/edit?usp=meet_tnfm_calendar",
 *                     "title": "Notes by Gemini" }]
 *
 * That is Google's own event -> artifact link, so it is the primary key here. `syncGoogleCalendar`
 * already persists `calendarEventId` on the touch, which makes the whole chain
 * touch -> event -> attachment -> Doc with no title or timestamp guessing. Title matching
 * exists only as a fallback for touches whose event predates the attachment (or lost it), and
 * it is genuinely ambiguous: one client can have two Docs on one day, and Gemini emits a
 * separate Doc per language.
 */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DOCS_API = "https://docs.googleapis.com/v1";
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
const DOCUMENT_MIME = "application/vnd.google-apps.document";

/** The provider that owns Meet artifacts -- calendar + Drive + Docs reads live on this one. */
const TRANSCRIPT_PROVIDER = "google-meet" as const;

export type TranscriptLookupStatus =
  /** A transcript was found and is ready to analyze. */
  | "loaded"
  /** Google Meet has never been connected by this user. */
  | "not_connected"
  /** Connected, but before the Drive/Docs scopes were added -- the user must reconnect. */
  | "needs_reconsent"
  /** The touch has no calendar event, so there is nothing to resolve an artifact from. */
  | "no_calendar_event"
  /** The event exists but Gemini has not written (or has not shared) a notes Doc yet. */
  | "artifact_not_ready"
  /** The Doc exists but carries no Transcript tab -- transcription was off for the call. */
  | "no_transcript"
  /** The Doc was found but this account cannot read it (hosted elsewhere, not shared). */
  | "doc_unreadable"
  /** Anything else -- network, quota, unexpected API shape. */
  | "failed";

export interface MeetingTranscriptLookup {
  status: TranscriptLookupStatus;
  /** A sentence the post-meeting step shows verbatim. Always set. */
  reason: string;
  /**
   * The analyzer payload: Gemini's Full notes and the verbatim dialogue under the section
   * markers below. Present only when status is "loaded". This is what lands in the textarea,
   * so it has to stay human-readable and editable.
   */
  transcript?: string;
  /** The Doc we resolved, when we got far enough to identify one. */
  doc?: { id: string; title: string; url: string };
  /** How the Doc was found, so the UI can say when it fell back to title matching. */
  matchedBy?: "calendar_attachment" | "title_and_time";
  /** Which tabs made it into `transcript`, so the UI can say what was and wasn't found. */
  sections?: { fullNotes: boolean; transcript: boolean };
}

/**
 * Section markers for the combined payload.
 *
 * Francisco wants both Gemini's Full notes (Summary / Decisions / Next steps) and the verbatim
 * dialogue fed to the analyzer. They travel as ONE string because the textarea is the AM's
 * editable override and must keep round-tripping a hand-pasted Zoom transcript unchanged -- but
 * they are labelled rather than silently concatenated, so `analyzeWithClaude` can split them
 * back into separate fields and the model can tell Gemini's interpretation from what was said.
 *
 * Changing these strings breaks that split; `splitTranscriptPayload` is the other half.
 */
export const FULL_NOTES_MARKER = "===== GEMINI FULL NOTES (Gemini's summary -- not verbatim) =====";
export const TRANSCRIPT_MARKER = "===== MEETING TRANSCRIPT (verbatim dialogue) =====";

/**
 * Split a combined payload back into its two parts.
 *
 * Anything without the markers is treated as transcript in full, which is what keeps manual
 * pastes, Zoom transcripts and every previously stored touch working untouched.
 */
export function splitTranscriptPayload(payload: string): { fullNotes?: string; transcript: string } {
  const transcriptAt = payload.indexOf(TRANSCRIPT_MARKER);
  const fullNotesAt = payload.indexOf(FULL_NOTES_MARKER);

  if (transcriptAt < 0 && fullNotesAt < 0) {
    return { transcript: payload.trim() };
  }

  // Full notes is written first, so the transcript marker bounds it.
  const fullNotes =
    fullNotesAt >= 0
      ? payload
          .slice(fullNotesAt + FULL_NOTES_MARKER.length, transcriptAt >= 0 ? transcriptAt : undefined)
          .trim()
      : undefined;
  const transcript = transcriptAt >= 0 ? payload.slice(transcriptAt + TRANSCRIPT_MARKER.length).trim() : "";

  return { fullNotes: fullNotes || undefined, transcript };
}

interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  createdTime?: string;
  owners?: { emailAddress?: string }[];
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
}

interface CalendarEvent {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  attachments?: { fileUrl?: string; title?: string; mimeType?: string }[];
}

function docUrl(docId: string) {
  return `https://docs.google.com/document/d/${docId}/edit`;
}

/** Google returns errors as JSON; surface the message rather than a bare status code. */
async function googleGet(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (response.ok) {
    return { ok: true as const, status: response.status, payload: (await response.json()) as Record<string, unknown> };
  }
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  return {
    ok: false as const,
    status: response.status,
    message: body.error?.message || `Google returned ${response.status}`,
  };
}

async function googleGetText(url: string, accessToken: string) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false as const, status: response.status, message: body.slice(0, 300) || `Google returned ${response.status}` };
  }
  return { ok: true as const, status: response.status, text: await response.text() };
}

/**
 * The access token for the Meet connection, or the reason the UI should show instead.
 *
 * The scope check is the important half: a connection authorized before Drive/Docs scopes were
 * added keeps refreshing happily and then 403s on the first Drive call, which would otherwise
 * surface as a confusing "failed". Catching it up front lets the UI say "reconnect".
 */
async function resolveAccessToken(
  context: TenantContext,
): Promise<{ ok: true; accessToken: string } | { ok: false; lookup: MeetingTranscriptLookup }> {
  const definition = getIntegrationDefinition(TRANSCRIPT_PROVIDER);
  let record = await getIntegrationConnection(context, TRANSCRIPT_PROVIDER);

  if (!record || record.status !== "connected") {
    return {
      ok: false,
      lookup: {
        status: "not_connected",
        reason: `${definition.name} isn't connected, so MTOS can't reach the Gemini notes Doc. Connect it in Settings -> Integrations, then fetch again.`,
      },
    };
  }

  const missingScopes = getMissingIntegrationScopes(TRANSCRIPT_PROVIDER, record);
  if (missingScopes.length) {
    return {
      ok: false,
      lookup: {
        status: "needs_reconsent",
        reason: `${definition.name} is connected but was authorized before transcript access was added, so Google hasn't granted the Drive and Docs reads yet. Reconnect it in Settings -> Integrations to approve them, then fetch again.`,
      },
    };
  }

  // Refresh with the same 10-minute buffer the provider syncs use, so a token that lapses
  // mid-fetch doesn't turn into a spurious failure on the AM's screen.
  const expiresAt = record.tokenExpiresAt ? new Date(record.tokenExpiresAt).getTime() : 0;
  if (expiresAt && expiresAt - Date.now() <= 10 * 60 * 1000) {
    await refreshIntegration(context, TRANSCRIPT_PROVIDER);
    record = (await getIntegrationConnection(context, TRANSCRIPT_PROVIDER)) || record;
  }

  const accessToken = getIntegrationCredentials(record).accessToken;
  if (!accessToken) {
    return {
      ok: false,
      lookup: {
        status: "not_connected",
        reason: `${definition.name} is connected but has no usable access token. Reconnect it in Settings -> Integrations.`,
      },
    };
  }

  return { ok: true, accessToken };
}

/** Extract a Docs file id from any Google Docs URL shape. */
function parseDocIdFromUrl(url: string): string | undefined {
  return /\/document\/d\/([a-zA-Z0-9_-]{20,})/.exec(url)?.[1];
}

/**
 * The Gemini notes Doc attached to the event, if Google has attached it yet.
 *
 * Gemini titles the attachment "Notes by Gemini"; prefer that, but fall back to any Docs
 * attachment so a renamed artifact still resolves. Non-Docs attachments (agendas, decks the
 * AM attached by hand) are ignored.
 */
function pickNotesAttachment(event: CalendarEvent): string | undefined {
  const docAttachments = (event.attachments || [])
    .map((attachment) => ({
      title: (attachment.title || "").toLowerCase(),
      docId: parseDocIdFromUrl(attachment.fileUrl || ""),
    }))
    .filter((attachment): attachment is { title: string; docId: string } => Boolean(attachment.docId));

  const gemini = docAttachments.find(
    (attachment) => attachment.title.includes("notes by gemini") || attachment.title.includes("gemini"),
  );
  return (gemini || docAttachments[0])?.docId;
}

/**
 * `<event title> - <YYYY/MM/DD HH:MM TZ> - Notes by Gemini[ (<language>)]`, capturing the event
 * title. The optional trailing parenthesis is real: Gemini appends " (Spanish)" / " (English)"
 * and emits a separate Doc per language for the same call.
 */
const TITLE_PATTERN =
  /^(.+) - \d{4}\/\d{2}\/\d{2} \d{1,2}:\d{2}(?: [A-Za-z]{2,5})? - Notes by Gemini(?: \(.+\))?$/;

function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Fallback resolution by title prefix + proximity in time.
 *
 * Only used when the event carries no attachment. Deliberately conservative: the event's own
 * summary must match the Doc title's prefix, because one client can have several Gemini Docs
 * on the same day (and one per language), and feeding the wrong call's dialogue into
 * analyze_transcript would produce confidently wrong tickets.
 *
 * Candidates are scored on `createdTime` rather than the timestamp inside the title: the title
 * carries a local abbreviation ("PDT", "CEST") that can't be resolved to an instant reliably,
 * while createdTime is a real UTC instant from Drive.
 */
async function findNotesDocByTitle(
  accessToken: string,
  event: CalendarEvent,
  scheduledAtIso: string,
): Promise<{ file: DriveFile; docId: string } | undefined> {
  const scheduledMs = new Date(scheduledAtIso).getTime();
  if (!event.summary || Number.isNaN(scheduledMs)) {
    return undefined;
  }

  const windowMs = 1000 * 60 * 60 * 36;
  const query = [
    `mimeType = '${DOCUMENT_MIME}'`,
    "trashed = false",
    "name contains 'Notes by Gemini'",
    `createdTime > '${new Date(scheduledMs - windowMs).toISOString()}'`,
    `createdTime < '${new Date(scheduledMs + windowMs).toISOString()}'`,
  ].join(" and ");

  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "files(id,name,mimeType,createdTime,owners(emailAddress),shortcutDetails(targetId,targetMimeType))");
  url.searchParams.set("pageSize", "100");
  // A touch hosted by another account manager reaches Francisco's Drive as a shared item or a
  // shortcut, and may sit on a shared drive -- all three have to be in scope for the search.
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("corpora", "allDrives");

  const result = await googleGet(url.toString(), accessToken);
  if (!result.ok) {
    return undefined;
  }

  const wanted = normalizeTitle(event.summary);
  const scored = ((result.payload.files as DriveFile[]) || [])
    .map((file) => {
      const parsed = TITLE_PATTERN.exec(file.name || "");
      if (!parsed) return undefined;
      if (normalizeTitle(parsed[1]) !== wanted) return undefined;
      const createdMs = file.createdTime ? new Date(file.createdTime).getTime() : Number.NaN;
      if (Number.isNaN(createdMs)) return undefined;
      return { file, distance: Math.abs(createdMs - scheduledMs) };
    })
    .filter((entry): entry is { file: DriveFile; distance: number } => Boolean(entry))
    .sort((a, b) => a.distance - b.distance);

  const best = scored[0]?.file;
  const docId = best?.shortcutDetails?.targetId || best?.id;
  return best && docId ? { file: best, docId } : undefined;
}

/**
 * Drive metadata for the resolved Doc, following a shortcut to its target.
 *
 * Artifacts belong to whoever hosted the call, so a touch run by a teammate or by
 * info@mapranking.com lands in Francisco's Drive as a shortcut or a shared file. Resolving the
 * shortcut target is what makes those readable; a 403/404 here is the "hosted elsewhere and
 * never shared" case, which the AM has to fix in Drive rather than in MTOS.
 */
async function describeDoc(
  accessToken: string,
  docId: string,
): Promise<{ ok: true; id: string; title: string } | { ok: false; status: number; message: string }> {
  const url = new URL(`${DRIVE_API}/files/${docId}`);
  url.searchParams.set("fields", "id,name,mimeType,shortcutDetails(targetId,targetMimeType)");
  url.searchParams.set("supportsAllDrives", "true");

  const result = await googleGet(url.toString(), accessToken);
  if (!result.ok) {
    return { ok: false, status: result.status, message: result.message };
  }

  const file = result.payload as DriveFile;
  if (file.mimeType === SHORTCUT_MIME && file.shortcutDetails?.targetId) {
    return describeDoc(accessToken, file.shortcutDetails.targetId);
  }
  return { ok: true, id: file.id || docId, title: file.name || "Notes by Gemini" };
}

interface DocsTab {
  tabProperties?: { title?: string };
  documentTab?: { body?: { content?: unknown[] } };
  childTabs?: DocsTab[];
}

/** Depth-first walk, because Gemini's tabs can be nested under a parent tab. */
function flattenTabs(tabs: DocsTab[] | undefined): DocsTab[] {
  return (tabs || []).flatMap((tab) => [tab, ...flattenTabs(tab.childTabs)]);
}

/** Pull the plain text out of a Docs `body.content` array, one line per paragraph. */
function readStructuralText(content: unknown[] | undefined): string {
  const lines: string[] = [];

  const walk = (elements: unknown[] | undefined) => {
    for (const element of elements || []) {
      const node = element as {
        paragraph?: { elements?: { textRun?: { content?: string } }[] };
        table?: { tableRows?: { tableCells?: { content?: unknown[] }[] }[] };
      };
      if (node.paragraph) {
        const text = (node.paragraph.elements || [])
          .map((run) => run.textRun?.content || "")
          .join("")
          .replace(/\u000b/g, " ")
          .trimEnd();
        lines.push(text);
      }
      for (const row of node.table?.tableRows || []) {
        for (const cell of row.tableCells || []) {
          walk(cell.content);
        }
      }
    }
  };

  walk(content);
  return lines.join("\n");
}

/**
 * The Full notes and Transcript tabs, read through the Docs API.
 *
 * `includeTabsContent=true` is what makes tabs addressable; without it the response carries
 * only the first tab. Selecting by tab title is also why this path is preferred over a flat
 * export: in flattened text the tab headings arrive as `# **<emoji> Transcript*** *`, with the
 * emoji frequently mojibaked, so matching them by string is fragile.
 *
 * Note that link URLs are NOT recoverable here -- the Docs API carries them in
 * `textStyle.link`, not in the text runs, so the `Attachments ...?eid=` link in Full notes
 * flattens to its label alone. That costs nothing: the event's own `attachments[]` is the join
 * key, and the eid was only ever a way to work backwards to it.
 */
async function readTabsViaDocsApi(
  accessToken: string,
  docId: string,
): Promise<
  | { ok: true; fullNotes?: string; transcript?: string }
  | { ok: false; status: number; message: string }
> {
  const url = new URL(`${DOCS_API}/documents/${docId}`);
  url.searchParams.set("includeTabsContent", "true");

  const result = await googleGet(url.toString(), accessToken);
  if (!result.ok) {
    return { ok: false, status: result.status, message: result.message };
  }

  const tabs = flattenTabs(result.payload.tabs as DocsTab[] | undefined);
  const readTab = (matcher: RegExp) => {
    const tab = tabs.find((entry) => matcher.test(entry.tabProperties?.title || ""));
    return tab ? readStructuralText(tab.documentTab?.body?.content) : undefined;
  };

  return {
    ok: true,
    // "Full notes" must not match the "Quick notes" tab, which is an abbreviated duplicate.
    fullNotes: readTab(/full\s*notes/i),
    transcript: readTab(/transcript/i),
  };
}

/**
 * Fallback: export the whole Doc as text and slice the Transcript section out of it.
 *
 * Used when the Docs API is unavailable to us (for example drive.readonly was granted but
 * documents.readonly was not). A plain export concatenates every tab, so the section runs from
 * the Transcript heading to the next top-level heading or the end of the file.
 */
export function sliceTabFromFlatText(text: string, matcher: RegExp): string | undefined {
  const lines = text.split(/\r?\n/);
  // Only TOP-level headings (`# `) delimit tabs; `## <title> - Transcript` is the heading inside
  // the tab and must not be mistaken for its start.
  //
  // Matching is by substring, not equality: the tab emoji frequently arrives mojibaked as `ð`,
  // which is a Latin letter and so survives any "strip non-letters" cleanup, leaving a label of
  // "ð transcript" rather than "transcript".
  const topLevelLabel = (line: string) =>
    /^#\s/.test(line)
      ? line.replace(/^#\s*/, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
      : undefined;

  const startIndex = lines.findIndex((line) => {
    const label = topLevelLabel(line);
    return label !== undefined && matcher.test(label);
  });
  if (startIndex < 0) {
    return undefined;
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^#\s/.test(lines[index])) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex + 1, endIndex).join("\n");
}

/**
 * Gemini's own boilerplate, which carries no meeting content.
 *
 * The survey prompts and "review Gemini's notes" disclaimers would otherwise reach the model as
 * if they were part of the call, and the Invited/Attachments/Meeting records lines flatten to
 * bare link labels once the URLs are dropped.
 */
const NOTES_BOILERPLATE = [
  /^invited\b/i,
  /^attachments\b/i,
  /^meeting records\b/i,
  /you should review gemini's notes/i,
  /get tips and learn how gemini takes notes/i,
  /how is the quality of/i,
  /take a short survey/i,
  /please\s+rate the new quick notes tab/i,
  /^want to see more\?/i,
  /^tip: you can always access/i,
];

/**
 * Trim the Gemini scaffolding off the Full notes tab, leaving Summary / Decisions / Next steps
 * / Details.
 *
 * Only boilerplate is removed -- the section headings stay, because they are what lets the
 * analyzer (and the AM reading the box) tell Gemini's decisions from its narrative detail.
 */
export function trimGeminiFullNotes(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[*_`]/g, "").replace(/\s+$/, ""))
    .filter((line) => !NOTES_BOILERPLATE.some((pattern) => pattern.test(line.trim())))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Trim the Gemini scaffolding off a Transcript tab, leaving the dialogue.
 *
 * Removes the leading date line and `## <title> - Transcript` heading, everything from the
 * `Transcription ended after HH:MM:SS` marker onward (the marker plus Google's
 * "computer generated" disclaimer), and trailing timestamp blocks left with no dialogue under
 * them.
 *
 * What it deliberately does NOT do is strip stray post-call audio. On live calls that bleed
 * arrives appended INSIDE the last speaker's turn -- verified on a real touch, where the
 * closing turn read "Bye. Bye." followed by unrelated television audio in the same line.
 * Nothing structural separates the two, so any rule aggressive enough to cut the bleed would
 * also cut genuine closing dialogue. It is a couple of sentences at the very end of a
 * ~20-minute transcript, so it is left in place rather than guessed at.
 */
export function trimGeminiTranscript(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n");

  // Cut the marker and everything after it. Tolerates the heading markup and bold wrapping the
  // marker carries in a flat export (`### **Transcription ended after 00:20:30**`).
  const endMarker = /^[#*\s]*Transcription ended after\b.*$/im.exec(text);
  if (endMarker?.index !== undefined) {
    text = text.slice(0, endMarker.index);
  }

  const lines = text.split("\n");

  // Drop the tab's own preamble: a bare date line and the `## <title> - Transcript` heading sit
  // above the first timestamp block and carry no dialogue.
  const firstContent = lines.findIndex((line) => /^[#*\s]*\d{1,2}:\d{2}(:\d{2})?[*\s]*$/.test(line));
  const body = firstContent > 0 ? lines.slice(firstContent) : lines;

  // Walk backwards dropping blank lines and any trailing timestamp heading that ended up with
  // nothing under it once the marker was cut.
  const trimmed = [...body];
  while (trimmed.length) {
    const last = trimmed[trimmed.length - 1];
    const isBlank = !last.trim();
    const isBareTimestamp = /^[#*\s]*\d{1,2}:\d{2}(:\d{2})?[*\s]*$/.test(last);
    if (isBlank || isBareTimestamp) {
      trimmed.pop();
      continue;
    }
    break;
  }

  // Collapse the runs of blank/whitespace-only lines Docs leaves between blocks.
  return trimmed
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Resolve a monthly touch to its Gemini transcript.
 *
 * Read-only and never throws for an expected condition: every failure the AM can act on comes
 * back as a status plus a sentence, so the post-meeting step can explain itself and fall back
 * to a manual paste instead of showing a stack trace.
 */
export async function fetchMonthlyTouchTranscript(
  context: TenantContext,
  touchId: string,
): Promise<MeetingTranscriptLookup> {
  const dataSource = getMtosDataSource(context);
  const touch: MonthlyTouchRecord | undefined = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    return { status: "failed", reason: "Monthly touch not found." };
  }

  if (!touch.calendarEventId) {
    return {
      status: "no_calendar_event",
      reason:
        "This touch has no Google Calendar event linked, so there's no Meet recording to pull from. Paste the transcript below -- that's expected for Zoom calls and manual recaps.",
    };
  }

  const token = await resolveAccessToken(context);
  if (!token.ok) {
    return token.lookup;
  }
  const { accessToken } = token;

  try {
    const eventUrl = new URL(`${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(touch.calendarEventId)}`);
    const eventResult = await googleGet(eventUrl.toString(), accessToken);
    if (!eventResult.ok) {
      if (eventResult.status === 404) {
        return {
          status: "no_calendar_event",
          reason:
            "The calendar event for this touch is no longer on your primary calendar, so its Gemini notes can't be located. Paste the transcript below.",
        };
      }
      if (eventResult.status === 403) {
        return {
          status: "needs_reconsent",
          reason: `Google refused the calendar read (${eventResult.message}). Reconnect Google Meet in Settings -> Integrations to re-approve access, then fetch again.`,
        };
      }
      return { status: "failed", reason: `Couldn't read the calendar event: ${eventResult.message}` };
    }

    const event = eventResult.payload as CalendarEvent;
    const scheduledAt = touch.scheduledAt || event.start?.dateTime || event.start?.date || "";

    let matchedBy: MeetingTranscriptLookup["matchedBy"] = "calendar_attachment";
    let docId = pickNotesAttachment(event);
    if (!docId) {
      const fallback = scheduledAt ? await findNotesDocByTitle(accessToken, event, scheduledAt) : undefined;
      if (fallback) {
        docId = fallback.docId;
        matchedBy = "title_and_time";
      }
    }

    if (!docId) {
      return {
        status: "artifact_not_ready",
        reason:
          "Gemini hasn't published the notes Doc for this meeting yet -- it usually appears a few minutes after the call ends. Try again shortly, or paste the transcript below.",
      };
    }

    const described = await describeDoc(accessToken, docId);
    if (!described.ok) {
      if (described.status === 403 || described.status === 404) {
        return {
          status: "doc_unreadable",
          reason:
            "The Gemini notes Doc for this meeting exists but this Google account can't open it -- the call was hosted by someone else and the Doc hasn't been shared. Ask the host to share it, or paste the transcript below.",
          doc: { id: docId, title: "Notes by Gemini", url: docUrl(docId) },
          matchedBy,
        };
      }
      return { status: "failed", reason: `Couldn't read the notes Doc: ${described.message}` };
    }

    const doc = { id: described.id, title: described.title, url: docUrl(described.id) };

    let rawFullNotes: string | undefined;
    let rawTranscript: string | undefined;
    const viaDocs = await readTabsViaDocsApi(accessToken, described.id);
    if (viaDocs.ok) {
      rawFullNotes = viaDocs.fullNotes;
      rawTranscript = viaDocs.transcript;
    } else if (viaDocs.status === 403 || viaDocs.status === 401) {
      // documents.readonly may be missing even though Drive worked -- fall back to the export.
      const exportUrl = new URL(`${DRIVE_API}/files/${described.id}/export`);
      exportUrl.searchParams.set("mimeType", "text/plain");
      const exported = await googleGetText(exportUrl.toString(), accessToken);
      if (exported.ok) {
        rawFullNotes = sliceTabFromFlatText(exported.text, /full\s*notes/);
        rawTranscript = sliceTabFromFlatText(exported.text, /transcript/);
      }
    } else {
      return { status: "failed", reason: `Couldn't read the notes Doc: ${viaDocs.message}`, doc, matchedBy };
    }

    const fullNotes = rawFullNotes ? trimGeminiFullNotes(rawFullNotes) : "";
    const transcript = rawTranscript ? trimGeminiTranscript(rawTranscript) : "";

    // The verbatim dialogue is the thing the analysis has to be grounded in, so no transcript
    // is a dead end even when Gemini's summary came through -- the AM has to decide whether a
    // summary-only analysis is acceptable, and says so by pasting or by editing the box.
    if (transcript.length < 40) {
      return {
        status: "no_transcript",
        reason: fullNotes
          ? "This meeting's Gemini Doc has a summary but no transcript, so transcription wasn't turned on for the call. Loading the summary alone would make the recap and tickets guesswork -- paste the transcript below if you have one."
          : "The Gemini notes Doc for this meeting has no transcript in it, which means transcription wasn't turned on for the call. Paste the transcript below if you have one.",
        doc,
        matchedBy,
        sections: { fullNotes: Boolean(fullNotes), transcript: false },
      };
    }

    const payload = [
      ...(fullNotes ? [FULL_NOTES_MARKER, fullNotes, ""] : []),
      TRANSCRIPT_MARKER,
      transcript,
    ].join("\n");

    const provenance =
      matchedBy === "calendar_attachment"
        ? `Loaded from "${doc.title}", attached to this touch's calendar event.`
        : `Loaded from "${doc.title}", matched by title and meeting time -- check it's the right call before analyzing.`;

    return {
      status: "loaded",
      reason: fullNotes
        ? `${provenance} Gemini's full notes and the verbatim transcript are both below, labelled separately.`
        : `${provenance} Verbatim transcript only -- this Doc has no Gemini summary tab.`,
      transcript: payload,
      doc,
      matchedBy,
      sections: { fullNotes: Boolean(fullNotes), transcript: true },
    };
  } catch (error) {
    return {
      status: "failed",
      reason: `Transcript lookup failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
