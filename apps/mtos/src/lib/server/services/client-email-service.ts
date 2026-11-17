import { internalTaskText } from "@/src/lib/contracts/client-content";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import { sendGmailMessage, verifyGmailMessageAccepted } from "@/src/lib/server/gmail";

/** One temporary transport policy for every approved client email. */
export async function sendClientEmail(context: TenantContext, options: {
  recipient: string; subject: string; html: string; cc?: string[];
  idempotencyKey: string; blockedTaskTitles?: string[]; label?: string;
}) {
  if (internalTaskText(`${options.subject} ${options.html}`, options.blockedTaskTitles)) return { sent: false as const, sendItYourself: false, detail: "This client email contains unfinished task details. Keep open/pending tasks in internal team notes and include completed work only." };
  const outcome = await sendGmailMessage(context, { to: options.recipient, subject: options.subject, html: options.html, cc: options.cc, idempotencyKey: options.idempotencyKey });
  return outcome.sent ? outcome : { ...outcome, sendItYourself: false };
}

export const verifyClientEmailAccepted = verifyGmailMessageAccepted;
