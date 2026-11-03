import type { IntegrationConnectionRecord, IntegrationProviderId } from "@/src/lib/contracts/integrations";

/**
 * The outward things MTOS does, and the permission each one needs to be allowed to do it.
 *
 * This exists because a scope is not a permission an AM can reason about. "calendar.events" tells
 * them nothing; "MTOS can book the next Monthly Touch for you" tells them what they lose. So each
 * entry names the capability, the provider it belongs to, the scope that grants it, what MTOS does
 * instead when it is missing, and where that fallback is visible.
 *
 * Three rules this file is built on:
 *
 *  - **The stored scopes are the truth, and nothing here ever writes them.** A connection records
 *    the scopes it was authorized with (see `completeOAuthCallback`). Widening a provider's
 *    definition does not widen a token already on file, which is why `permissionState` compares
 *    the two instead of trusting the definition. Nothing in this file or its service touches a
 *    token, a scope list or an OAuth flow -- re-consent is the AM's action, on the provider's own
 *    screen.
 *  - **A permission MTOS never asks for is its own state, not "denied".** `calendar.events` is in
 *    no provider's requested scopes, so no AM can grant it by reconnecting: the honest answer is
 *    that MTOS has not asked yet, and that adding the request is a change to the OAuth app. Saying
 *    "not granted" would send an AM to reconnect over and over and nothing would change.
 *  - **Missing never means broken.** Every entry carries its fallback, because every caller
 *    degrades: it skips the step, says why, and leaves a reminder.
 */

export type PermissionStatus =
  /** The connection holds this scope. The capability works. */
  | "granted"
  /** Connected, but authorized before this scope was asked for. Reconnecting fixes it. */
  | "needs_reconsent"
  /** The provider is not connected at all. */
  | "not_connected"
  /** MTOS does not request this scope anywhere, so it cannot be granted from inside the app. */
  | "not_requested";

export interface IntegrationPermission {
  id: string;
  /** What MTOS can do, in the AM's words. Never the scope string. */
  label: string;
  provider: IntegrationProviderId;
  /** The OAuth scope that grants it. Compared against what the connection actually stored. */
  scope: string;
  /** One line on what this is for. */
  purpose: string;
  /** What MTOS does instead when it is missing. Every caller has one. */
  fallback: string;
  /** Where in MTOS the fallback shows up, so the AM can go and look. */
  usedBy: string;
}

export const INTEGRATION_PERMISSIONS: IntegrationPermission[] = [
  {
    id: "calendar-write",
    label: "Book meetings on your calendar",
    provider: "google-meet",
    scope: "https://www.googleapis.com/auth/calendar.events",
    purpose: "Puts the next Monthly Touch on your calendar and the client's when you finish the follow-through.",
    fallback:
      "The booking is skipped and a “Finish post-touch actions” ticket is created, due at the 24-hour deadline, so the booking does not evaporate.",
    usedBy: "Follow-through, step 7",
  },
  {
    id: "calendar-read",
    label: "Read your calendar",
    provider: "google-meet",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    purpose: "Finds the Monthly Touch events, their attendees and the Meet room each call used.",
    fallback: "Touches cannot be matched to calendar events, so a touch has no scheduled time and no attendees.",
    usedBy: "Monthly Touches, the live call, the transcript wait",
  },
  {
    id: "transcript-read",
    label: "Read the meeting notes Gemini writes",
    provider: "google-meet",
    scope: "https://www.googleapis.com/auth/documents.readonly",
    purpose: "Opens the notes document the call produced, which is where the transcript lives.",
    fallback: "The follow-through cannot read the call, so the score and the notes are drafted from the brief alone.",
    usedBy: "Post-call transcript wait, follow-through",
  },
  {
    id: "gmail-send",
    label: "Send email as you from Gmail",
    provider: "gmail",
    scope: "https://www.googleapis.com/auth/gmail.send",
    purpose: "An alternative to Intercom for the agenda and recap emails, sent from your own address.",
    fallback: "Client email goes through Intercom instead, which is how MTOS sends it today.",
    usedBy: "Agenda email, recap email",
  },
  {
    id: "gmail-read",
    label: "Read your client email",
    provider: "gmail",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    purpose: "Checks what was actually sent and answered before the brief says an email went unanswered.",
    fallback: "The brief reports email evidence from Intercom only, and says so.",
    usedBy: "Review brief, section 5",
  },
  {
    id: "drive-read",
    label: "Open the files a meeting produced",
    provider: "google-drive",
    scope: "https://www.googleapis.com/auth/drive.readonly",
    purpose: "Reads the recordings, notes and attachments a client's meetings leave in Drive.",
    fallback: "Those files are not read, and anything drawn from them is missing rather than guessed.",
    usedBy: "Call Intelligence, client attachments",
  },
];

/**
 * What one permission's state is, from the connection record as stored.
 *
 * `requestedScopes` is the provider definition's current list. A scope that is not in it cannot be
 * granted by reconnecting, which is the difference between `not_requested` and `needs_reconsent`
 * -- and the difference between telling an AM to reconnect and telling them the truth.
 */
export function permissionState(
  permission: IntegrationPermission,
  record: IntegrationConnectionRecord | undefined,
  requestedScopes: readonly string[],
): PermissionStatus {
  if (!requestedScopes.includes(permission.scope)) return "not_requested";
  if (!record || record.status !== "connected") return "not_connected";
  return (record.scopes || []).includes(permission.scope) ? "granted" : "needs_reconsent";
}

export interface PermissionView extends IntegrationPermission {
  status: PermissionStatus;
  /** The sentence the AM reads, which says what to do about it or that there is nothing to do. */
  detail: string;
}

/** The one sentence under each permission. The only place this wording is decided. */
export function permissionDetail(permission: IntegrationPermission, status: PermissionStatus): string {
  if (status === "granted") return "Granted. MTOS can do this.";
  if (status === "needs_reconsent") {
    return `Your connection was authorized before MTOS asked for this, so it is not granted yet. Reconnect ${providerLabel(permission.provider)} in Settings → Integrations to grant it. ${permission.fallback}`;
  }
  if (status === "not_connected") {
    return `${providerLabel(permission.provider)} is not connected, so this is not available. ${permission.fallback}`;
  }
  return `MTOS does not ask for this permission yet, so it cannot be granted from here — adding the request is a change to the Google app itself, not something reconnecting will fix. ${permission.fallback}`;
}

function providerLabel(provider: IntegrationProviderId): string {
  if (provider === "google-meet") return "Google Meet";
  if (provider === "google-drive") return "Google Drive";
  if (provider === "gmail") return "Gmail";
  if (provider === "google-calendar") return "Google Calendar";
  return provider;
}

/**
 * How many permissions need the AM to do something.
 *
 * `not_requested` is deliberately NOT counted. The chip exists to tell an AM there is an action
 * waiting for them, and nothing they can do in MTOS changes that state -- counting it would make
 * the chip permanently non-zero, which is the fastest way to teach someone to ignore it.
 */
export function permissionsNeedingAttention(views: PermissionView[]): PermissionView[] {
  return views.filter((view) => view.status === "needs_reconsent" || view.status === "not_connected");
}

/** The line the Settings card shows: what is granted, and what is waiting on the AM. */
export function permissionSummary(views: PermissionView[]): string {
  const granted = views.filter((view) => view.status === "granted").length;
  const attention = permissionsNeedingAttention(views);
  const unavailable = views.filter((view) => view.status === "not_requested").length;

  const parts = [`${granted} of ${views.length} permissions granted`];
  if (attention.length) {
    parts.push(`${attention.length} need${attention.length === 1 ? "s" : ""} attention`);
  }
  if (unavailable) {
    parts.push(`${unavailable} MTOS does not ask for yet`);
  }
  return `${parts.join(" · ")}.`;
}
