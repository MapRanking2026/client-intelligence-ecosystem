import type { ClientRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { resolveRecipient } from "@/src/lib/server/services/confirmation-email-service";

const valid = (value: string | undefined): value is string => Boolean(value && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim()));

/** Reuse the client address already reviewed for this touch; a person's name is never an address. */
export function resolveRecapRecipient(client: ClientRecord, touch: MonthlyTouchRecord): string {
  const explicit = touch.followThrough?.recap?.recipient;
  if (explicit !== undefined) return valid(explicit) ? explicit.trim() : "";
  if (valid(touch.agendaEmail?.recipient)) return touch.agendaEmail.recipient.trim();
  const resolved = resolveRecipient(client, touch).recipient;
  if (valid(resolved)) return resolved.trim();
  if (valid(client.contact)) return client.contact.trim();
  const attendees = [...new Set((client.googleMeetingEmails || []).map(value => value.trim()).filter(value => valid(value) && !/@(mapranking|maprankings)\./i.test(value)))];
  return attendees.length === 1 ? attendees[0]! : "";
}
