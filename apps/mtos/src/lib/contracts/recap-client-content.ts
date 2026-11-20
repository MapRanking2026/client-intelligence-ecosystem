import { htmlToMarkdown, markdownToPlainText } from "@/src/lib/contracts/rich-text";

/** Recaps may communicate agreed follow-ups; generic internal backlog remains private. */
export const RECAP_COMMUNICATION_RULE = "CLIENT RECAP RULE: Include verified performance results, completed work, and only client-facing responsibilities, requests, deadlines and plans actually agreed during this meeting or explicitly approved in the Loom supporting materials. Include anything the AM explicitly promised to put in this email. Do not copy the general task backlog, unapproved/proposed work, internal ticket identifiers, health scores, churn assessments, private team commentary or credential values. Never invent agreement, a date, an answer, a question or a commitment. A ticket's default due date is not a meeting-agreed deadline.";

/**
 * The voice the recap is written in, stated to the model as a rule of its own.
 *
 * The outline was already right and the email still read wrong, because the body was being filled
 * with the internal meeting synopsis: "Vivian Song took the call from the front desk with many
 * interruptions. Francisco Quintero shared strong ranking gains." Both sentences are true and
 * neither belongs in a letter -- the first talks about the reader to nobody, the second has the
 * account manager writing about himself in the third person. A client reading that is reading
 * somebody else's notes about their own meeting.
 */
export const RECAP_LETTER_VOICE_RULE =
  "LETTER VOICE: This is an email written BY the account manager TO the client, not a report about the meeting. Address the reader as you. Refer to the account manager and the agency as I and we. Never write the reader, their staff or the account manager in the third person by name or as he, she or they, and never narrate the call itself (who dialled in, how it went, what the room was like). Every paragraph must read as a sentence one person would write to another.";

/**
 * Why a paragraph is not a letter to this client, or undefined when it reads as one.
 *
 * Deliberately narrow. It looks for the two names that can never appear in the third person in
 * this particular email -- the person it is addressed to and the person signing it -- plus the
 * third-person openers that give a synopsis away. Anybody else may legitimately be written about
 * ("Maria will send the logins over"), so no general third-person rule is applied.
 */
export function notWrittenToTheClient(
  text: string,
  names: { contactName?: string; accountManagerName?: string },
): string | undefined {
  const line = markdownToPlainText(text || "").trim();
  if (!line) return undefined;
  const haystack = ` ${line.toLowerCase()} `;

  for (const [who, full] of [
    ["the reader", names.contactName],
    ["you", names.accountManagerName],
  ] as const) {
    const whole = (full || "").trim().toLowerCase();
    // A bare first name is too common to judge on: "Dan" could be anyone, and a false reject
    // throws away a paragraph the AM would have been happy to send.
    if (whole.split(/\s+/).filter(Boolean).length < 2) continue;
    if (haystack.includes(whole)) {
      return `This is written about ${who} rather than to them: "${line.slice(0, 120)}"`;
    }
  }

  // "She had seen no change in SEMrush" -- a sentence reporting on the reader, not writing to them.
  if (/^(?:he|she|they)\s+\w+/i.test(line)) {
    return `This reports on somebody rather than addressing the reader: "${line.slice(0, 120)}"`;
  }

  // Narration of the meeting itself. Who dialled in, from where, and how noisy it was are
  // observations for the internal notes; writing them back to the client describes them to
  // themselves, and the second kind ("many interruptions") reads as a complaint about them.
  if (
    /\b(?:took|joined|hopped on|dial(?:l)?ed in(?:to)?|sat in on|was on|were on)\b[^.!?]*\bcall\b/i.test(line) ||
    /\b(?:background noise|many interruptions|kept being interrupted|poor connection|dropped off the call)\b/i.test(line)
  ) {
    return `This narrates the call rather than writing to the client: "${line.slice(0, 120)}"`;
  }
  return undefined;
}

export function recapCommunicationViolations(text: string): { text: string; reason: string }[] {
  const visible = /<\/?[a-z][^>]*>/i.test(text) ? htmlToMarkdown(text.replace(/<!--[\s\S]*?-->/g, "")) : text;
  return visible.split(/\n+/).map(line => markdownToPlainText(line).trim()).filter(line => /internal[ -]only|team only|do not (?:share|show|present)|\b(?:internal backlog|risk register|churn watch|NPS score|health score|draft tickets?)\b/i.test(line)).map(line => ({ text: line.slice(0, 180), reason: "Internal team information" }));
}
