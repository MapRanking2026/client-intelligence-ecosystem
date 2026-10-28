import type { TenantContext } from "@/src/lib/contracts/mtos";
import {
  MATCH_STRENGTH,
  extractTitleCandidate,
  hasTouchMarker,
  scoreCandidateAgainstClient,
} from "@/src/lib/server/calendar-touch-matching";
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
  matchedBy?: "calendar_attachment" | "calendar_search" | "title_and_time" | "client_and_time";
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
 * The instants worth searching around for this touch's artifacts.
 *
 * `scheduledAt` alone is not good enough, and assuming it was is what produced the worst version
 * of this bug: a touch scheduled for 23 September, run today, searched late September and
 * reported that nothing existed -- while the call's notes sat in Drive with today's date on them.
 * Touches slip by weeks, and the AM presses Fetch transcript minutes after hanging up, so NOW is
 * the better anchor of the two more often than not.
 *
 * Two narrow windows rather than one wide one spanning both: a five-week span would overrun the
 * calendar page size on a busy week and drag in every unrelated client in between.
 */
function searchAnchors(scheduledAtIso: string): number[] {
  const now = Date.now();
  const scheduled = new Date(scheduledAtIso).getTime();
  if (Number.isNaN(scheduled)) {
    return [now];
  }
  // Within a couple of days of each other, one window already covers both.
  return Math.abs(now - scheduled) <= 1000 * 60 * 60 * 48 ? [scheduled] : [scheduled, now];
}

/** Distance to whichever anchor this candidate sits nearest. */
function distanceToNearestAnchor(instantMs: number, anchors: number[]): number {
  return Math.min(...anchors.map((anchor) => Math.abs(instantMs - anchor)));
}

/**
 * Does this calendar entry look like the AM's own preparation hold rather than the client call?
 *
 * This is the single biggest reason the lookup used to come back empty. `syncGoogleCalendar`
 * frequently links a touch to the "Prep: <client> Monthly Touch" block the AM keeps for
 * themselves -- verified against live data, where 8 of 12 recent touches pointed at a prep hold.
 * A solo hold has no Meet conference and so no Gemini artifacts, which means resolving from it
 * can only ever fail -- and that failure used to be reported as "Gemini hasn't published yet".
 */
export function looksLikePrepBlock(summary: string): boolean {
  return /(^|\W)prep(aration)?\b\s*[:\-]?/i.test(summary) && !/\bap+ointment\b/i.test(summary);
}

/**
 * The real client meeting on the AM's calendar, found by client name and date.
 *
 * Used when the linked event is a prep hold, carries no artifacts, or has been deleted outright:
 * go and look at the meeting that actually happened on the signed-in manager's calendar instead
 * of trusting a stored id.
 *
 * Ranking is deliberate. An event already carrying a Gemini attachment beats one that does not,
 * because that attachment is Google's own event -> artifact link; an explicit monthly-touch
 * marker in the title beats a bare name hit; then strength of the name match; then proximity to
 * the scheduled time. Prep holds are excluded outright.
 */
async function findMeetingEventByClient(
  accessToken: string,
  clientName: string,
  scheduledAtIso: string,
): Promise<{ event: CalendarEvent; docId?: string } | undefined> {
  if (!clientName) {
    return undefined;
  }
  const anchors = searchAnchors(scheduledAtIso);

  // Three days either side of each anchor: a touch is routinely moved a day or two off the
  // scheduled slot, and the prep hold often sits on a different day from the call itself.
  const windowMs = 1000 * 60 * 60 * 24 * 3;
  const events = new Map<string, CalendarEvent>();
  for (const anchor of anchors) {
    const url = new URL(`${CALENDAR_API}/calendars/primary/events`);
    url.searchParams.set("timeMin", new Date(anchor - windowMs).toISOString());
    url.searchParams.set("timeMax", new Date(anchor + windowMs).toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");

    const result = await googleGet(url.toString(), accessToken);
    if (!result.ok) {
      continue;
    }
    for (const event of (result.payload.items as CalendarEvent[]) || []) {
      const key = event.id || `${event.summary}|${event.start?.dateTime || event.start?.date}`;
      if (key) events.set(key, event);
    }
  }

  const scored = [...events.values()]
    .map((event) => {
      const summary = event.summary || "";
      if (!summary || looksLikePrepBlock(summary)) return undefined;

      const strength = scoreCandidateAgainstClient(clientName, extractTitleCandidate(summary));
      if (strength < MATCH_STRENGTH.tokenOverlap) return undefined;

      const docId = pickNotesAttachment(event);
      const startedAt = event.start?.dateTime || event.start?.date || "";
      const startMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;

      return {
        event,
        docId,
        rank: (docId ? 100 : 0) + (hasTouchMarker(summary) ? 10 : 0) + strength,
        distance: Number.isNaN(startMs) ? Number.MAX_SAFE_INTEGER : distanceToNearestAnchor(startMs, anchors),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => b.rank - a.rank || a.distance - b.distance);

  const best = scored[0];
  return best ? { event: best.event, docId: best.docId } : undefined;
}

/**
 * Fallback straight off Drive: a "Notes by Gemini" Doc whose title names this client, created
 * near the meeting time.
 *
 * This used to require the Doc title prefix to EQUAL the calendar event summary, which meant it
 * could never fire in the case that needed it most -- the linked event is the prep hold ("Prep:
 * JP Plumbing Monthly Touch") while the Doc is named after the call ("Monthly Touch JP
 * Plumbing"). Scoring against the CLIENT NAME instead, with the same matcher the calendar sync
 * uses, is what closes that gap, and it also rescues touches whose calendar event was deleted,
 * because no event is needed at all.
 *
 * Still conservative about handing the wrong call's dialogue to the analyzer: a bare word overlap
 * counts only when the title also carries a monthly-touch or appointment marker, an exact hit on
 * the event summary outranks everything, and an inexact match is reported as `client_and_time` so
 * the UI tells the AM to check the call before analyzing.
 *
 * Candidates are scored on `createdTime` rather than the timestamp inside the title: the title
 * carries a local abbreviation ("PDT", "CEST") that cannot be resolved to an instant reliably,
 * while createdTime is a real UTC instant from Drive.
 */
async function findNotesDocCandidates(
  accessToken: string,
  clientName: string,
  scheduledAtIso: string,
  eventSummary?: string,
): Promise<{ file: DriveFile; docId: string; exact: boolean }[]> {
  const anchors = searchAnchors(scheduledAtIso);

  // A week either side of each anchor, not 36 hours around the scheduled date. Verified on live
  // data: JP Plumbing's touch was scheduled for 15 Oct and the call happened on the 19th, so the
  // old window excluded the real Doc and admitted only an aborted call from the 16th.
  const windowMs = 1000 * 60 * 60 * 24 * 7;
  const files = new Map<string, DriveFile>();
  for (const anchor of anchors) {
    const query = [
      `mimeType = '${DOCUMENT_MIME}'`,
      "trashed = false",
      "name contains 'Notes by Gemini'",
      `createdTime > '${new Date(anchor - windowMs).toISOString()}'`,
      `createdTime < '${new Date(anchor + windowMs).toISOString()}'`,
    ].join(" and ");

    const url = new URL(`${DRIVE_API}/files`);
    url.searchParams.set("q", query);
    url.searchParams.set(
      "fields",
      "files(id,name,mimeType,createdTime,owners(emailAddress),shortcutDetails(targetId,targetMimeType))",
    );
    url.searchParams.set("pageSize", "100");
    // A touch hosted by another account manager reaches Francisco's Drive as a shared item or a
    // shortcut, and may sit on a shared drive -- all three have to be in scope for the search.
    url.searchParams.set("includeItemsFromAllDrives", "true");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("corpora", "allDrives");

    const result = await googleGet(url.toString(), accessToken);
    if (!result.ok) {
      continue;
    }
    for (const file of (result.payload.files as DriveFile[]) || []) {
      if (file.id) files.set(file.id, file);
    }
  }

  const wantedSummary = eventSummary ? normalizeTitle(eventSummary) : undefined;
  const scored = [...files.values()]
    .map((file) => {
      const parsed = TITLE_PATTERN.exec(file.name || "");
      if (!parsed) return undefined;
      const prefix = parsed[1];

      const exact = Boolean(wantedSummary && normalizeTitle(prefix) === wantedSummary);
      const strength = clientName
        ? scoreCandidateAgainstClient(clientName, extractTitleCandidate(prefix))
        : MATCH_STRENGTH.none;

      // A loose word overlap alone is not enough to hand dialogue to the analyzer; the title has
      // to also look like a client call rather than an internal meeting.
      const named =
        strength >= MATCH_STRENGTH.containment ||
        (strength >= MATCH_STRENGTH.tokenOverlap && hasTouchMarker(prefix));
      if (!exact && !named) return undefined;

      const createdMs = file.createdTime ? new Date(file.createdTime).getTime() : Number.NaN;
      if (Number.isNaN(createdMs)) return undefined;

      return {
        file,
        exact,
        rank: exact ? 100 : strength,
        distance: distanceToNearestAnchor(createdMs, anchors),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => b.rank - a.rank || a.distance - b.distance);

  // Every plausible Doc, best first -- the caller reads them in order and keeps the first that
  // actually contains dialogue. Returning a single pick was the bug: Gemini writes a Doc for
  // every join attempt, so a call the AM dropped and redialled leaves a stub whose Transcript
  // tab holds only "Transcription ended after 00:00:19". Those stubs are frequently closer to
  // the scheduled time than the real call and so used to win outright.
  return scored
    .map((entry) => {
      const docId = entry.file.shortcutDetails?.targetId || entry.file.id;
      return docId ? { file: entry.file, docId, exact: entry.exact } : undefined;
    })
    .filter((entry): entry is { file: DriveFile; docId: string; exact: boolean } => Boolean(entry));
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
 * Read one notes Doc: its Drive metadata, Gemini's Full notes, and the verbatim dialogue.
 *
 * Split out of the lookup because the lookup now tries SEVERAL candidate Docs in turn. Gemini
 * writes a Doc per join attempt, so a call that was dropped and redialled leaves behind stubs
 * whose Transcript tab holds nothing but "Transcription ended after 00:00:19" -- and those stubs
 * are often nearer the scheduled time than the real call. Reading in order and keeping the first
 * Doc with actual dialogue is what makes the right one win.
 */
async function readNotesDoc(
  accessToken: string,
  docId: string,
): Promise<
  | { kind: "ok"; doc: { id: string; title: string; url: string }; fullNotes: string; transcript: string }
  | { kind: "unreadable"; docId: string }
  | { kind: "failed"; message: string; doc?: { id: string; title: string; url: string } }
> {
  const described = await describeDoc(accessToken, docId);
  if (!described.ok) {
    if (described.status === 403 || described.status === 404) {
      return { kind: "unreadable", docId };
    }
    return { kind: "failed", message: described.message };
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
    return { kind: "failed", message: viaDocs.message, doc };
  }

  return {
    kind: "ok",
    doc,
    fullNotes: rawFullNotes ? trimGeminiFullNotes(rawFullNotes) : "",
    transcript: rawTranscript ? trimGeminiTranscript(rawTranscript) : "",
  };
}

/** Below this, a Transcript tab holds only Gemini's "transcription ended" scaffolding. */
const MIN_TRANSCRIPT_CHARS = 40;

/**
 * Long enough that this is unmistakably the call itself, so there is no point reading further
 * candidates. A monthly touch runs 20-40 minutes and lands in the tens of thousands of
 * characters; the redial stubs Gemini leaves behind come in at one to three hundred. 2,000 sits
 * in the empty space between the two, so a genuinely short call is still taken as the best
 * answer -- it just doesn't stop the search early.
 */
const SUBSTANTIAL_TRANSCRIPT_CHARS = 2000;

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

  const token = await resolveAccessToken(context);
  if (!token.ok) {
    return token.lookup;
  }
  const { accessToken } = token;

  // The client's name is the join key for both fallbacks, so it is worth a read even though the
  // happy path never needs it. A missing client is not fatal: the attachment path still works.
  const client = await dataSource.getClientById(touch.clientId).catch(() => undefined);
  const clientName = client?.name || "";

  try {
    let event: CalendarEvent | undefined;
    let eventMissing = false;

    if (touch.calendarEventId) {
      const eventUrl = new URL(
        `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(touch.calendarEventId)}`,
      );
      const eventResult = await googleGet(eventUrl.toString(), accessToken);
      if (eventResult.ok) {
        event = eventResult.payload as CalendarEvent;
      } else if (eventResult.status === 404) {
        // Deleted, or living on a calendar that isn't this manager's. Not a dead end any more:
        // the client name and the date are enough to find the call's notes without it.
        eventMissing = true;
      } else if (eventResult.status === 403) {
        return {
          status: "needs_reconsent",
          reason: `Google refused the calendar read (${eventResult.message}). Reconnect Google Meet in Settings -> Integrations to re-approve access, then fetch again.`,
        };
      } else {
        return { status: "failed", reason: `Couldn't read the calendar event: ${eventResult.message}` };
      }
    }

    const scheduledAt = touch.scheduledAt || event?.start?.dateTime || event?.start?.date || "";
    if (!scheduledAt) {
      return {
        status: "no_calendar_event",
        reason:
          "This touch has neither a scheduled date nor a calendar event, so there's nothing to search a Meet recording against. Paste the transcript below.",
      };
    }

    const linkedWasPrepBlock = Boolean(event?.summary && looksLikePrepBlock(event.summary));

    // Every Doc worth reading, strongest provenance first. The attachment on the linked event is
    // Google's own event -> artifact link; then the attachment on the real client meeting found
    // by name on this manager's calendar; then Docs matched in Drive by client name and date.
    const candidates: { docId: string; matchedBy: NonNullable<MeetingTranscriptLookup["matchedBy"]> }[] = [];
    const seen = new Set<string>();
    const addCandidate = (docId: string | undefined, matchedBy: NonNullable<MeetingTranscriptLookup["matchedBy"]>) => {
      if (!docId || seen.has(docId)) return;
      seen.add(docId);
      candidates.push({ docId, matchedBy });
    };

    let resolvedEvent = event;
    addCandidate(event ? pickNotesAttachment(event) : undefined, "calendar_attachment");

    // The linked event had no artifacts (or there is no linked event). Go and find the meeting
    // that actually happened on this manager's calendar -- the normal case, because the sync
    // routinely links the AM's prep hold rather than the client call.
    if (clientName) {
      const found = await findMeetingEventByClient(accessToken, clientName, scheduledAt);
      if (found) {
        resolvedEvent = found.event;
        addCandidate(found.docId, "calendar_search");
      }
    }

    // And the Docs themselves, by client name and date. Works even when no calendar event
    // survives, and when Google never attached the notes to the event.
    for (const entry of await findNotesDocCandidates(
      accessToken,
      clientName,
      scheduledAt,
      resolvedEvent?.summary,
    )) {
      addCandidate(entry.docId, entry.exact ? "title_and_time" : "client_and_time");
    }

    if (!candidates.length) {
      // Say which path came up empty rather than blaming Gemini's publishing delay, which was
      // wrong for every touch older than an hour and sent the AM away to "try again shortly"
      // for a Doc that had been sitting in Drive the whole time.
      // Name the dates actually searched. The old message quoted only the scheduled date, which
      // read as nonsense when the touch had slipped and the call had happened today.
      const searched = [
        ...new Set(searchAnchors(scheduledAt).map((anchor) => new Date(anchor).toISOString().slice(0, 10))),
      ].join(" or ");
      const tried = clientName
        ? `Nothing on your calendar within a week of ${searched} matches "${clientName}", and no "Notes by Gemini" Doc from around then names this client.`
        : "MTOS can't see this client's record, so it had no name to match a meeting or a notes Doc against.";

      if (eventMissing) {
        return {
          status: "no_calendar_event",
          reason: `The calendar event linked to this touch no longer exists on your calendar. ${tried} Paste the transcript below.`,
        };
      }
      if (linkedWasPrepBlock) {
        return {
          status: "artifact_not_ready",
          reason: `This touch is linked to your prep block ("${event?.summary}"), not the client call -- a solo hold has no Meet recording. ${tried} Paste the transcript below, or check the call is on the Google account you connected.`,
        };
      }
      return {
        status: "artifact_not_ready",
        reason: `No Gemini notes Doc could be found for this meeting. If the call has only just ended, the Doc usually appears a few minutes later. ${tried} Paste the transcript below.`,
      };
    }

    // Read in order, keep the first Doc with real dialogue. Capped so a client with a long
    // history of redials can't turn one fetch into a dozen Docs API round trips.
    const MAX_CANDIDATES = 5;
    let best:
      | { doc: { id: string; title: string; url: string }; fullNotes: string; transcript: string; matchedBy: NonNullable<MeetingTranscriptLookup["matchedBy"]> }
      | undefined;
    let unreadable: string | undefined;
    let failure: { message: string; doc?: { id: string; title: string; url: string } } | undefined;

    for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
      const read = await readNotesDoc(accessToken, candidate.docId);
      if (read.kind === "unreadable") {
        unreadable = unreadable || read.docId;
        continue;
      }
      if (read.kind === "failed") {
        failure = failure || { message: read.message, doc: read.doc };
        continue;
      }
      const candidateIsBetter =
        !best ||
        read.transcript.length > best.transcript.length ||
        (read.transcript.length === best.transcript.length && read.fullNotes.length > best.fullNotes.length);
      if (candidateIsBetter) {
        best = { ...read, matchedBy: candidate.matchedBy };
      }

      // Stop only once a candidate is unmistakably the call. Taking the first Doc over the
      // 40-character floor was still wrong: the redial stubs clear that floor easily (101, 113
      // and 267 characters on three real touches), so the stub won and the 30,000-character
      // transcript sitting two candidates later was never read.
      if (read.transcript.length >= SUBSTANTIAL_TRANSCRIPT_CHARS) {
        break;
      }
    }

    if (!best) {
      if (unreadable) {
        return {
          status: "doc_unreadable",
          reason:
            "The Gemini notes Doc for this meeting exists but this Google account can't open it -- the call was hosted by someone else and the Doc hasn't been shared. Ask the host to share it, or paste the transcript below.",
          doc: { id: unreadable, title: "Notes by Gemini", url: docUrl(unreadable) },
        };
      }
      return {
        status: "failed",
        reason: `Couldn't read the notes Doc: ${failure?.message || "unknown error"}`,
        doc: failure?.doc,
      };
    }

    const { doc, fullNotes, transcript, matchedBy } = best;

    // The verbatim dialogue is the thing the analysis has to be grounded in, so no transcript
    // is a dead end even when Gemini's summary came through -- the AM has to decide whether a
    // summary-only analysis is acceptable, and says so by pasting or by editing the box.
    if (transcript.length < MIN_TRANSCRIPT_CHARS) {
      const checked =
        candidates.length > 1
          ? ` MTOS checked ${Math.min(candidates.length, MAX_CANDIDATES)} notes Docs around this date; none carried dialogue.`
          : "";
      return {
        status: "no_transcript",
        reason: fullNotes
          ? `"${doc.title}" has a summary but no transcript, so transcription wasn't on for the call. Loading the summary alone would make the recap and tickets guesswork -- paste the transcript below if you have one.${checked}`
          : `"${doc.title}" has no transcript in it, which means transcription wasn't on for the call.${checked} Paste the transcript below if you have one.`,
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

    // How it was found is worth saying out loud: the fallbacks are progressively looser, and only
    // the attachment is Google's own event -> artifact link. The rest ask the AM to confirm the
    // call before the dialogue reaches the analyzer.
    const provenance =
      matchedBy === "calendar_attachment"
        ? `Loaded from "${doc.title}", attached to this touch's calendar event.`
        : matchedBy === "calendar_search"
          ? `Loaded from "${doc.title}", attached to "${resolvedEvent?.summary || "the matching meeting"}" on your calendar -- the event linked to this touch had no Meet notes of its own.`
          : matchedBy === "title_and_time"
            ? `Loaded from "${doc.title}", matched by title and meeting time -- check it's the right call before analyzing.`
            : `Loaded from "${doc.title}", matched by client name and meeting time -- check it's the right call before analyzing.`;

    // A transcript this short is almost always a dropped-and-redialled join rather than the
    // meeting, and it is the AM who can tell. Loading it is still right -- it may genuinely be a
    // five-minute call -- but it must not look like a full transcript.
    const thin =
      transcript.length < SUBSTANTIAL_TRANSCRIPT_CHARS
        ? ` Only ${transcript.length} characters of dialogue, which usually means a dropped join rather than the call -- check it before analyzing.`
        : "";

    return {
      status: "loaded",
      reason: fullNotes
        ? `${provenance} Gemini's full notes and the verbatim transcript are both below, labelled separately.${thin}`
        : `${provenance} Verbatim transcript only -- this Doc has no Gemini summary tab.${thin}`,
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
