import { clientContentViolations } from "@/src/lib/contracts/client-content";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import { sendGmailMessage, verifyGmailMessageAccepted } from "@/src/lib/server/gmail";

/** One temporary transport policy for every approved client email. */
export async function sendClientEmail(context: TenantContext, options: {
  recipient: string; subject: string; html: string; cc?: string[];
  idempotencyKey: string; clientName?: string; blockedTaskTitles?: string[]; label?: string;
}) {
  const violation = [...clientContentViolations(options.subject, options.blockedTaskTitles, options.clientName), ...clientContentViolations(options.html, options.blockedTaskTitles, options.clientName)][0];
  if (violation) return { sent: false as const, sendItYourself: false, detail: `Keep unfinished task details in internal notes. Review this email text: “${violation.text}”` };
  const outcome = await sendGmailMessage(context, { to: options.recipient, subject: options.subject, html: options.html, cc: options.cc, idempotencyKey: options.idempotencyKey });
  return outcome.sent ? outcome : { ...outcome, sendItYourself: false };
}

export const verifyClientEmailAccepted = verifyGmailMessageAccepted;
