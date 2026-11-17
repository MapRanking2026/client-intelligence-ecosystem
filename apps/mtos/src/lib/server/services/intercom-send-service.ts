import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getIntegrationConnection, getIntegrationCredentials } from "@/src/lib/server/integrations";
import { findContactIds, intercomPost } from "@/src/lib/server/services/intercom-service";

// Historical receipt recovery only. All new sends use client-email-service and Gmail.
/** Read-only reconciliation after an ambiguous Loom send; never sends another message. */
export async function verifyLoomEmailAccepted(context: TenantContext, input: { recipient: string; subject: string; url: string; selectedAt: string }) {
  const connection = await getIntegrationConnection(context, "intercom");
  if (!connection || connection.status !== "connected") throw new Error("Connect Intercom to reconcile this email.");
  const token = getIntegrationCredentials(connection).accessToken;
  if (!token) throw new Error("Reconnect Intercom before checking delivery.");
  const contacts = await findContactIds(token, input.recipient);
  if ("error" in contacts || !contacts.ids.length) throw new Error("The recipient could not be verified in Intercom. Check the inbox before taking further action.");
  const result = await intercomPost(token, "/conversations/search", { query: { operator: "AND", value: [
    { field: "contact_ids", operator: "IN", value: contacts.ids },
    { field: "created_at", operator: ">", value: Math.floor(Date.parse(input.selectedAt) / 1000) },
  ] }, pagination: { per_page: 50 } });
  if ("error" in result) throw new Error(result.error);
  const rows = (Array.isArray(result.payload.conversations) ? result.payload.conversations : []) as { id?: string; source?: { body?: string; subject?: string; author?: { type?: string } } }[];
  const matches = rows.filter((row) => row.id && row.source?.subject === input.subject && row.source?.author?.type === "admin" && row.source?.body?.includes(input.url));
  if (matches.length !== 1) throw new Error("Intercom did not return exactly one matching outbound video email. Delivery is still unresolved; check the inbox before retrying.");
  return String(matches[0].id);
}
