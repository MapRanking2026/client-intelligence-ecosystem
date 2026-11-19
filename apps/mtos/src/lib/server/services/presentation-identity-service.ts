import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClientRecord, MonthlyTouchRecord, Presentation } from "@/src/lib/mtos-data";
import { resolveConfirmationContact } from "./confirmation-email-service";
import { getAccountManagerProfile, getUserDisplayNames } from "./user-service";

/** Placeholders are internal gaps, never people to print on a client slide. */
export function presentationPerson(value: string | undefined): string | undefined {
  const name = value?.trim();
  return name && !/@|\b(?:unconfirmed|unknown|needed|tbd|not recorded|not available|confirm)\b|^(?:n\/?a|none|account manager|the business owner|-)$/i.test(name) ? name : undefined;
}

export async function presentationIdentity(context: TenantContext, client: ClientRecord, touch: MonthlyTouchRecord, generating = false) {
  const profile = await getAccountManagerProfile(context);
  const owner = presentationPerson(client.accountManager);
  const profileName = presentationPerson(profile.name);
  // Expand a short synced owner name only from that same person's saved profile.
  // A manager/QA viewer must never replace another AM's identity with their own.
  const samePerson = owner && profileName && (owner.toLowerCase() === profileName.toLowerCase() || profileName.toLowerCase().startsWith(owner.toLowerCase() + " "));
  const approverId = touch.approval?.approvedBy;
  const approver = !owner && approverId ? presentationPerson((await getUserDisplayNames(context.tenantId, [approverId]))[approverId]) : undefined;
  return {
    clientName: client.name,
    preparedBy: samePerson ? profileName : owner || approver || (generating && context.role === "account_manager" ? profileName : undefined),
    preparedFor: presentationPerson(resolveConfirmationContact(client)),
  };
}

export function withPresentationIdentity(presentation: Presentation | undefined, identity: Awaited<ReturnType<typeof presentationIdentity>>): Presentation | undefined {
  if (!presentation) return undefined;
  return { ...presentation, clientName: identity.clientName, preparedBy: identity.preparedBy || presentationPerson(presentation.preparedBy), preparedFor: identity.preparedFor || presentationPerson(presentation.preparedFor) };
}
