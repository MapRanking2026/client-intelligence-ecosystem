import { htmlToMarkdown, markdownToPlainText } from "@/src/lib/contracts/rich-text";

/** Recaps may communicate agreed follow-ups; generic internal backlog remains private. */
export const RECAP_COMMUNICATION_RULE = "CLIENT RECAP RULE: Include verified performance results, completed work, and only client-facing responsibilities, requests, deadlines and plans actually agreed during this meeting or explicitly approved in the Loom supporting materials. Include anything the AM explicitly promised to put in this email. Do not copy the general task backlog, unapproved/proposed work, internal ticket identifiers, health scores, churn assessments, private team commentary or credential values. Never invent agreement, a date, an answer, a question or a commitment. A ticket's default due date is not a meeting-agreed deadline.";

export function recapCommunicationViolations(text: string): { text: string; reason: string }[] {
  const visible = /<\/?[a-z][^>]*>/i.test(text) ? htmlToMarkdown(text.replace(/<!--[\s\S]*?-->/g, "")) : text;
  return visible.split(/\n+/).map(line => markdownToPlainText(line).trim()).filter(line => /internal[ -]only|team only|do not (?:share|show|present)|\b(?:internal backlog|risk register|churn watch|NPS score|health score|draft tickets?)\b/i.test(line)).map(line => ({ text: line.slice(0, 180), reason: "Internal team information" }));
}
