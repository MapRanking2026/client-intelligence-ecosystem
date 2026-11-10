import { namesLikelyMatch, normalizeText, stripBusinessNameNoise } from "@/src/lib/server/name-matching";

export interface CalendarEventLike {
  id: string;
  summary: string;
  startIso: string;
  attendeeEmails?: string[];
}

export interface ClientLike {
  id: string;
  name: string;
}

export type CalendarMatchReason = "title" | "attendee-email";

export interface CalendarMatch {
  eventId: string;
  clientId: string;
  clientName: string;
  startIso: string;
  summary: string;
  reason: CalendarMatchReason;
}

/**
 * Mailbox providers whose domain says nothing about the business, so only the local part of the
 * address is worth comparing against a client name.
 */
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail",
  "googlemail",
  "yahoo",
  "aol",
  "icloud",
  "me",
  "mac",
  "hotmail",
  "outlook",
  "live",
  "msn",
  "comcast",
  "verizon",
  "att",
  "sbcglobal",
  "protonmail",
  "proton",
  "ymail",
]);

/**
 * Role addresses that belong to whoever staffs the inbox, not to a named business. Matching on these
 * pairs a meeting with any client whose name happens to contain the word (a "marketing@" attendee
 * otherwise claims a client called "... Local Marketing").
 */
const GENERIC_EMAIL_LOCAL_PARTS = new Set([
  "info",
  "office",
  "sales",
  "admin",
  "support",
  "marketing",
  "contact",
  "hello",
  "team",
  "billing",
  "accounts",
  "accounting",
  "service",
  "services",
  "help",
  "mail",
  "email",
  "noreply",
  "no-reply",
  "careers",
  "jobs",
  "hr",
]);

/** Words that carry no identifying weight when comparing token sets. */
const TOKEN_STOPWORDS = new Set(["the", "and", "of", "for", "a", "an", "at", "in", "on", "to"]);

/** Collapses a name to bare alphanumerics so "Tourmaline Skin Care" meets "tourmalineskincare1". */
function squash(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function distinctiveTokens(value: string) {
  return normalizeText(stripBusinessNameNoise(value))
    .split(" ")
    .filter((token) => token.length >= 3 && !TOKEN_STOPWORDS.has(token));
}

/**
 * Accepts names that share most of their distinctive words, which covers abbreviations the exact
 * forms miss ("Novus Glass of Northern AZ" vs "Novus Glass Of Northern Arizona"). The shared words
 * must also be substantial in total length, so incidental overlaps on short words ("Go Pro Garage
 * Doors" vs "Go Pro Plumbing") do not qualify.
 */
function tokenSetsOverlap(clientName: string, candidate: string) {
  const clientTokens = distinctiveTokens(clientName);
  const candidateTokens = distinctiveTokens(candidate);
  if (clientTokens.length < 2 || candidateTokens.length < 2) return false;

  const candidateSet = new Set(candidateTokens);
  const shared = clientTokens.filter((token) => candidateSet.has(token));
  if (shared.length < 2) return false;

  const sharedLength = shared.reduce((total, token) => total + token.length, 0);
  if (sharedLength < 8) return false;

  const ratio = shared.length / Math.min(clientTokens.length, candidateTokens.length);
  return ratio >= 0.6;
}

/**
 * Strips the recurring scaffolding out of a meeting title, leaving the part that names the client.
 * Handles the real title shapes on the calendar, including the habitual "Apointment" misspelling
 * and titles where the business comes first ("Novus glass-Monthly Touch").
 */
export function extractTitleCandidate(summary: string) {
  return summary
    .replace(/\bap+ointment\b/gi, " ")
    .replace(/\bmonthly\s*touch(es)?\b/gi, " ")
    .replace(/\bclinic\b/gi, " ")
    .replace(/\bmeeting\b/gi, " ")
    .replace(/\bwith\b/gi, " ")
    .replace(/[-–—:,/|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does this calendar entry look like the AM's own preparation hold rather than the client call?
 *
 * The AM keeps a "Prep: <client> Monthly Touch" block, usually a day or two before the call. It
 * names the client and carries a touch marker, so it matches the client exactly as the real
 * meeting does -- and being earlier, it wins any "soonest upcoming" contest. That is how a
 * confirmation email came to tell a client their meeting was on 4 November when the call itself
 * was the 5th: the touch had been pinned to the prep hold.
 */
export function looksLikePrepBlock(summary: string): boolean {
  return /(^|\W)prep(aration)?\b\s*[:\-]?/i.test(summary) && !/\bap+ointment\b/i.test(summary);
}

/** True when a title carries an explicit monthly-touch / appointment marker. */
export function hasTouchMarker(summary: string) {
  return /\bap+ointment\b|\bmonthly\s*touch(es)?\b/i.test(summary);
}

/** How convincing a name match is. Higher wins; 0 means no match. */
export const MATCH_STRENGTH = { none: 0, tokenOverlap: 1, containment: 2, exact: 3 } as const;

/**
 * Scores a free-text candidate against a client name. Strength matters more than specificity: a
 * loose word overlap against a long client name must never outrank an exact hit on a shorter one,
 * or "Connolly Heating & Air Conditioning" gets handed to "One Hour Heating & Air Conditioning".
 */
export function scoreCandidateAgainstClient(clientName: string, candidate: string): number {
  if (!candidate) return MATCH_STRENGTH.none;

  const client = squash(stripBusinessNameNoise(clientName));
  const other = squash(candidate);
  if (client && client === other) return MATCH_STRENGTH.exact;

  if (namesLikelyMatch(clientName, candidate)) return MATCH_STRENGTH.containment;
  if (client.length >= 6 && other.length >= 6 && (other.includes(client) || client.includes(other))) {
    return MATCH_STRENGTH.containment;
  }

  return tokenSetsOverlap(clientName, candidate) ? MATCH_STRENGTH.tokenOverlap : MATCH_STRENGTH.none;
}

/** True when the address belongs to someone outside the agency. */
export function isExternalEmail(email: string, agencyDomains: string[]) {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = trimmed.slice(at + 1);
  return !agencyDomains.some((agencyDomain) => domain === agencyDomain || domain.endsWith(`.${agencyDomain}`));
}

/** Pulls the parts of an email address that can carry a business name. */
export function emailNameCandidates(email: string, agencyDomains: string[]) {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return [];

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const domainRoot = domain.split(".")[0] || "";
  if (agencyDomains.some((agencyDomain) => domain === agencyDomain || domain.endsWith(`.${agencyDomain}`))) {
    return [];
  }

  const candidates: string[] = [];
  if (!GENERIC_EMAIL_LOCAL_PARTS.has(local.replace(/[._-]/g, ""))) {
    candidates.push(local);
  }
  if (!GENERIC_EMAIL_DOMAINS.has(domainRoot)) {
    candidates.push(domainRoot);
  }
  return candidates.filter(Boolean);
}

/**
 * Resolves the single client a meeting belongs to. Title is the primary signal; attendee addresses
 * are the fallback that rescues person-named titles ("Apointment with Trace Wilson"). When several
 * clients match, the longest (most specific) name wins, and a genuine tie is left unmatched rather
 * than guessed at.
 */
function resolveClientForEvent(
  event: CalendarEventLike,
  clients: ClientLike[],
  agencyDomains: string[],
): { client: ClientLike; reason: CalendarMatchReason } | null {
  const titleCandidate = extractTitleCandidate(event.summary);

  /**
   * Picks a winner from scored clients: strongest match first, then the most specific name. Returns
   * null when two genuinely different names tie at the top, rather than guessing between them.
   */
  const pickBest = (scored: Array<{ client: ClientLike; score: number }>) => {
    const candidates = scored.filter((entry) => entry.score > MATCH_STRENGTH.none);
    if (!candidates.length) return null;

    const topScore = Math.max(...candidates.map((entry) => entry.score));
    const leaders = candidates.filter((entry) => entry.score === topScore);

    const bestLength = Math.max(...leaders.map((entry) => squash(entry.client.name).length));
    const finalists = leaders.filter((entry) => squash(entry.client.name).length === bestLength);

    const distinctNames = new Set(finalists.map((entry) => squash(entry.client.name)));
    if (distinctNames.size > 1) return null;

    return finalists.sort((a, b) => a.client.id.localeCompare(b.client.id))[0].client;
  };

  if (normalizeText(titleCandidate).length >= 4) {
    const byTitle = pickBest(
      clients.map((client) => ({ client, score: scoreCandidateAgainstClient(client.name, titleCandidate) })),
    );
    if (byTitle) return { client: byTitle, reason: "title" };
  }

  const candidates = (event.attendeeEmails || []).flatMap((email) => emailNameCandidates(email, agencyDomains));
  if (candidates.length) {
    const byEmail = pickBest(
      clients.map((client) => ({
        client,
        score: Math.max(...candidates.map((candidate) => scoreCandidateAgainstClient(client.name, candidate))),
      })),
    );
    if (byEmail) return { client: byEmail, reason: "attendee-email" };
  }

  return null;
}

/**
 * Matches calendar events to clients. Only events that look like client meetings are considered:
 * they either carry a monthly-touch/appointment marker or have an outside attendee, which keeps
 * internal standups ("Daily Meeting", "AM Consulting") from claiming a client.
 */
export function matchCalendarEventsToClients(
  events: CalendarEventLike[],
  clients: ClientLike[],
  options: { agencyDomains?: string[] } = {},
): CalendarMatch[] {
  const agencyDomains = (options.agencyDomains || ["mapranking.com"]).map((domain) => domain.toLowerCase());
  const matches: CalendarMatch[] = [];

  for (const event of events) {
    if (!event.id || !event.summary || !event.startIso) continue;

    const hasExternalAttendee = (event.attendeeEmails || []).some((email) => isExternalEmail(email, agencyDomains));
    if (!hasTouchMarker(event.summary) && !hasExternalAttendee) continue;

    const resolved = resolveClientForEvent(event, clients, agencyDomains);
    if (!resolved) continue;

    matches.push({
      eventId: event.id,
      clientId: resolved.client.id,
      clientName: resolved.client.name,
      startIso: event.startIso,
      summary: event.summary,
      reason: resolved.reason,
    });
  }

  return matches;
}

/**
 * Picks the meeting to treat as each client's scheduled touch: the soonest one at or after `nowIso`,
 * falling back to nothing when a client only has past meetings.
 */
export function selectNextTouchPerClient(matches: CalendarMatch[], nowIso: string) {
  const byClient = new Map<string, CalendarMatch>();
  for (const match of matches) {
    if (match.startIso < nowIso) continue;
    if (looksLikePrepBlock(match.summary)) continue;
    const current = byClient.get(match.clientId);
    if (!current || match.startIso < current.startIso) {
      byClient.set(match.clientId, match);
    }
  }
  return byClient;
}

/** Most recent past meeting per client, for "when did we last speak" context. */
export function selectLastTouchPerClient(matches: CalendarMatch[], nowIso: string) {
  const byClient = new Map<string, CalendarMatch>();
  for (const match of matches) {
    if (match.startIso >= nowIso) continue;
    if (looksLikePrepBlock(match.summary)) continue;
    const current = byClient.get(match.clientId);
    if (!current || match.startIso > current.startIso) {
      byClient.set(match.clientId, match);
    }
  }
  return byClient;
}

/**
 * How long after a call it still counts as "the meeting this touch is about".
 *
 * A touch is routinely prepared on the morning of the call and written up the same evening, so
 * the meeting a brief refers to is just as often a few hours behind as a few days ahead.
 */
export const RECENT_MEETING_WINDOW_MS = 1000 * 60 * 60 * 36;

export interface MeetingChoice {
  match: CalendarMatch;
  /** "upcoming" when the call has not happened yet, "just-held" when it is within the window. */
  timing: "upcoming" | "just-held";
}

/**
 * The meeting a touch should quote to the client, chosen from the calendar rather than from
 * whatever was stored the last time a sync ran.
 *
 * The soonest call still ahead wins, because that is the one a confirmation email is about. Only
 * when there is none does the most recently held call qualify, and only inside
 * `RECENT_MEETING_WINDOW_MS` -- a meeting from three weeks ago is history, not this touch, and
 * quoting it to a client reads as though nobody checked. Prep holds never qualify as either.
 *
 * Returns null when the calendar offers nothing that fits, which is a real answer: it means the
 * call is not on the calendar and the AM has to put it there or set the time by hand. That beats
 * presenting a date from a stale record as though it were confirmed.
 */
export function selectMeetingForTouch(
  matches: CalendarMatch[],
  nowIso: string,
  windowMs: number = RECENT_MEETING_WINDOW_MS,
): MeetingChoice | null {
  const callable = matches.filter((match) => match.startIso && !looksLikePrepBlock(match.summary));

  const upcoming = callable
    .filter((match) => match.startIso >= nowIso)
    .sort((left, right) => left.startIso.localeCompare(right.startIso))[0];
  if (upcoming) {
    return { match: upcoming, timing: "upcoming" };
  }

  const floor = new Date(new Date(nowIso).getTime() - windowMs).toISOString();
  const justHeld = callable
    .filter((match) => match.startIso < nowIso && match.startIso >= floor)
    .sort((left, right) => right.startIso.localeCompare(left.startIso))[0];
  return justHeld ? { match: justHeld, timing: "just-held" } : null;
}
