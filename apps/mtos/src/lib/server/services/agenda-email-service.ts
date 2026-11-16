import { callLengthMinutes } from "@/src/lib/contracts/live-call";
import { isTimeZone } from "@/src/lib/contracts/user-preferences";
import { readAgendaMeeting } from "@/src/lib/server/services/google-meet-service";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import {
  agendaEmailHasBody,
  buildAgendaEmailDraft,
  isAgendaRecipient,
  sanitizeAgendaEmailHtml,
  type AgendaEmailDraft,
} from "@/src/lib/contracts/agenda-email";
import type { ClientRecord, MonthlyTouchRecord, TouchAgendaEmailState } from "@/src/lib/mtos-data";
import { getServerEnv } from "@/src/lib/server/env";
import { resolveConfirmationContact, resolveRecipient } from "@/src/lib/server/services/confirmation-email-service";
import { getNowIso } from "@/src/lib/server/services/mtos-ai";
import {
  getAccountManagerPreferences,
  getAccountManagerProfile,
  type AccountManagerPreferences,
} from "@/src/lib/server/services/user-service";

/**
 * The agenda email as the review step shows it, built from records rather than from a model.
 *
 * The preparation already wrote the wording -- subject, the items, the one ask, the sign-off -- and
 * that wording is what goes out. Everything this adds is a fact the application holds and the model
 * must not restate: who it goes to, who is copied, when the call is, in which zone, on which link.
 * Restating those through a model is how an email ends up telling a client the wrong hour.
 *
 * The draft is rebuilt on every read until it has been sent, so a touch that gets a meeting link
 * after the brief was written picks the link up without the AM regenerating anything. Once it is
 * sent, the stored HTML is returned verbatim: what the client received never changes afterwards.
 */

function isInternal(address: string): boolean {
  return /@(mapranking|maprankings)\./i.test(address);
}

/**
 * The other client-side people on the calendar event.
 *
 * Taken from the attendee addresses the AM pinned for calendar matching, which are real addresses
 * from a real event -- never a second contact guessed from the business. Our own addresses and the
 * primary recipient are dropped.
 */
export function officeContacts(client: ClientRecord, recipient: string): string[] {
  const primary = recipient.trim().toLowerCase();
  return (client.googleMeetingEmails || [])
    .map((address) => address.trim())
    .filter((address) => address && !isInternal(address) && address.toLowerCase() !== primary);
}

export interface AgendaEmailView {
  /** What the card renders and what the send uses. */
  state: TouchAgendaEmailState;
  freshTemplateHtml?: string;
  /** True when the stored HTML is what the client already received. */
  sent: boolean;
  /** The addresses the preference would copy, whether or not the preference is on. */
  availableCc: string[];
  ccEnabled: boolean;
}

/**
 * The draft for this touch, merged with whatever the AM has edited.
 *
 * Edits win over the regenerated draft, because the AM edited it on purpose; the regenerated facts
 * fill in only what they have not touched. A declined email keeps its text so undoing the decline
 * does not lose it.
 */
export async function readAgendaEmail(
  context: TenantContext,
  touch: MonthlyTouchRecord,
  client: ClientRecord,
): Promise<AgendaEmailView> {
  const stored = touch.agendaEmail;
  const eventId = touch.googleMeeting?.calendarEventId || touch.calendarEventId;
  const [profile, preferences, meeting] = await Promise.all([
    getAccountManagerProfile(context),
    getAccountManagerPreferences(context),
    !stored?.sentAt && eventId ? readAgendaMeeting(context, eventId).catch(() => undefined) : undefined,
  ]);

  const resolved = resolveRecipient(client, touch);
  const recipient = stored?.recipient?.trim() || resolved.recipient;
  const recipientSource = stored?.recipient?.trim()
    ? "Entered by you on this touch."
    : resolved.recipientSource;
  const availableCc = officeContacts(client, recipient);
  const ccEnabled = preferences.ccOfficeContact === true;

  if (stored?.sentAt) {
    return {
      state: stored,
      sent: true,
      availableCc,
      ccEnabled,
    };
  }

  const draft = draftFor(touch, client, profile.timeZone, preferences, profile.name, meeting);
  const html = stored?.html?.trim() || draft.html;
  const gaps = stored?.html?.trim()
    ? agendaEmailHasBody(html) ? [] : ["Write the email body before sending."]
    : [...draft.blockingGaps];
  if (!isAgendaRecipient(recipient)) {
    gaps.push(
      recipient ? "Enter a valid email address in To." : "Enter the client's email address in To.",
    );
  }

  return {
    state: {
      subject: stored?.subject?.trim() || draft.subject,
      html,
      recipient,
      recipientSource,
      ...(ccEnabled && availableCc.length ? { cc: availableCc.join(", ") } : {}),
      blockingGaps: gaps,
      ...(stored?.declined !== undefined ? { declined: stored.declined } : {}),
      ...(stored?.savedAt ? { savedAt: stored.savedAt } : {}),
    },
    sent: false,
    freshTemplateHtml: draft.html,
    availableCc,
    ccEnabled,
  };
}

function draftFor(
  touch: MonthlyTouchRecord,
  client: ClientRecord,
  timeZone: string,
  preferences: AccountManagerPreferences,
  accountManagerName: string,
  meeting: Awaited<ReturnType<typeof readAgendaMeeting>>,
): AgendaEmailDraft {
  const env = getServerEnv();
  const name = accountManagerName || client.accountManager || "";
  const title = preferences.jobTitle?.trim();
  const signature = preferences.emailSignoff?.trim() || (name && title ? `Best regards,\n${name}\n${title} | Map Ranking` : "");
  const meetingZone = meeting?.timeZone;
  return buildAgendaEmailDraft(touch.prepBrief?.clientAgendaEmail, {
    businessName: client.name,
    contactName: resolveConfirmationContact(client),
    scheduledAt: meeting?.scheduledAt || touch.scheduledAt || touch.prepPack?.schedule.scheduledAt,
    timeZone: isTimeZone(meetingZone) ? meetingZone : timeZone,
    timeZoneIsClients: false,
    meetingUrl: meeting?.meetingUrl || touch.googleMeeting?.meetingUrl,
    lengthMinutes: meeting?.lengthMinutes || callLengthMinutes(preferences.callLengthMinutes),
    signoff: signature,
    accountManagerName: name,
    appUrl: env.appUrl,
  });
}

/** What the AM typed, cleaned and stamped, ready for `saveTouchDraft`. */
export function agendaEmailPatch(input: {
  subject?: string;
  html?: string;
  declined?: boolean;
  recipient?: string;
}): Partial<TouchAgendaEmailState> {
  return {
    ...(input.subject !== undefined ? { subject: input.subject.trim().slice(0, 300) } : {}),
    ...(input.html !== undefined ? { html: sanitizeAgendaEmailHtml(input.html) } : {}),
    ...(input.declined !== undefined ? { declined: input.declined } : {}),
    ...(input.recipient !== undefined ? { recipient: input.recipient.trim() } : {}),
    savedAt: getNowIso(),
  };
}
