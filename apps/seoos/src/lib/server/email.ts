import { getServerEnv } from "@/src/lib/server/env";

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email is not configured. Set RESEND_API_KEY and EMAIL_FROM on SEOOS.");
    this.name = "EmailNotConfiguredError";
  }
}

/** Send an email via Resend. Sending is always a human-initiated action. */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<{ id?: string }> {
  const env = getServerEnv();
  if (!env.resendApiKey || !env.emailFrom) throw new EmailNotConfiguredError();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.emailFrom,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok) throw new Error(body.message || body.name || `email_failed_${res.status}`);
  return { id: body.id };
}
