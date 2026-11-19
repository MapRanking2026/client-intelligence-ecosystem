/**
 * What a ticket is allowed to say about whose account it is.
 *
 * A ticket is picked up by a specialist who does not know the account. The SEO team is not told
 * which client they are working for, and the business is already a field on the form -- so a
 * description that opens with "This is for the client <business>." spends its first sentence
 * repeating a field, and one that says "Jay is waiting on the credentials" tells somebody a name
 * they were not meant to be given. The work starts the description, and the person on the call is
 * "the client".
 *
 * This is applied to what the model wrote rather than only asked of it. The prompt asks; this is
 * the rule. A single-token name is masked only in its capitalised form, which is the shape a name
 * takes in a sentence -- a contact called Mark can still lose a stray capitalised "Mark the page",
 * and that is the trade the instruction is worth: the name leaking is the failure that matters.
 */

export interface TicketClientIdentity {
  /** The business, which the form already carries in its own field. */
  businessName?: string;
  /** The contact on the account, as the client record spells it. */
  contactName?: string;
}

const THE_CLIENT = "the client";
const TITLES = /^(?:dr|mr|mrs|ms|miss|prof|rev)\.?\s+/i;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The names to take out, longest first.
 *
 * Longest first so "Jay Frias" is replaced as one name rather than leaving "the client the
 * client" behind, and the parts are included because a first name alone identifies the client as
 * surely as the full one does.
 */
export function maskedNames(identity: TicketClientIdentity): string[] {
  const names = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length >= 3) names.add(trimmed);
  };
  if (identity.businessName?.trim()) add(identity.businessName);
  const contact = (identity.contactName || "").trim().replace(TITLES, "");
  if (contact) {
    add(contact);
    const parts = contact.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      add(parts[0]);
      add(parts[parts.length - 1]);
    }
  }
  return [...names].sort((left, right) => right.length - left.length);
}

/** One name wherever it stands as a word, its possessive included. */
function maskName(text: string, name: string): string {
  // A multi-word name is unmistakable, so case does not matter. A single word is matched as
  // written, because lower-casing the test is what turns a surname into every other sentence.
  const flags = /\s/.test(name) ? "gi" : "g";
  return text.replace(new RegExp(`\\b${escape(name)}(?:'s|’s)?\\b`, flags), (match) =>
    /['’]s$/.test(match) ? `${THE_CLIENT}'s` : THE_CLIENT);
}

/** A leading sentence whose only job is to say whose account this is. */
function dropIdentifyingPreamble(text: string, identity: TicketClientIdentity): string {
  const lead = text.match(/^\s*[^.!?]*[.!?]\s+/);
  if (!lead) return text;
  const sentence = lead[0];
  if (!/\b(?:this (?:ticket |task )?is (?:for|about)|for the client|client:)/i.test(sentence)) return text;
  const business = (identity.businessName || "").trim();
  // Only a sentence that names the business, or names no work at all, is the preamble. "This is
  // for the credentials to arrive" is the ticket.
  const namesTheBusiness = business ? sentence.toLowerCase().includes(business.toLowerCase()) : false;
  if (!namesTheBusiness && !/\b(?:the )?client\b/i.test(sentence)) return text;
  return text.slice(sentence.length);
}

/** "the client" is a sentence's subject as often as not, so it is capitalised like one. */
function capitaliseOpenings(text: string): string {
  return text.replace(/(^|[.!?]\s+)(the client)\b/g, (_match, lead: string) => `${lead}The client`);
}

/**
 * A ticket's words with the account taken out of them.
 *
 * Safe on a title as well as a description: a title is a fragment, so the preamble rule simply
 * finds nothing to drop.
 */
export function withoutClientIdentity(text: string, identity: TicketClientIdentity): string {
  let next = dropIdentifyingPreamble(text || "", identity);
  for (const name of maskedNames(identity)) next = maskName(next, name);
  return capitaliseOpenings(
    next
      // Two names in a row leave two of these behind, and a business that was already written
      // with an article in front of it leaves "the the client".
      .replace(/\bthe client,?\s+the client\b/gi, THE_CLIENT)
      .replace(/\bthe\s+the client\b/gi, THE_CLIENT)
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .trim(),
  );
}

/**
 * The same rule, scoped to the notes.
 *
 * The notes themselves are filed in the account's own Client's Book, where naming the client is
 * the point -- the title is the business. Only the fields that leave as tickets are anonymous.
 */
export const ACTION_LINE_ANONYMITY_RULE =
  "The action lines in departments[].actions[].what and the pending items in pending[].missing " +
  "become tickets for specialists who are not told which account they are working on: in those " +
  "fields never name the business and never name the person on the call, write \"the client\". " +
  "The rest of the notes is the account's own record and names them normally.";

/** The one line the prompts carry, so the model is asked for this before it is enforced. */
export const CLIENT_ANONYMITY_RULE =
  "Ticket titles and descriptions are read by specialists who are not told which account they are " +
  "working on. Never name the business and never name the person on the call -- not their first " +
  "name, not their full name. Call them \"the client\". Do not open a description by saying who " +
  "the ticket is for; the business is already a field on the form. Start with the work itself.";
