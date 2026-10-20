import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { SeoUserV1 } from "@/src/lib/domain/user";
import { getServerEnv } from "@/src/lib/server/env";
import { EmailNotConfiguredError, sendEmail } from "@/src/lib/server/email";
import { getUserRepo } from "@/src/lib/server/repositories/user-repo";

const Body = z.object({ email: z.string().email() });

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  const env = getServerEnv();
  const repo = getUserRepo();
  const user = await repo.getByEmail(env.pilotTenantId, parsed.data.email);

  if (!user || user.disabled) {
    return NextResponse.json({ ok: true });
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString();
  const resetUrl = `${env.appUrl || new URL(request.url).origin}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(user.email)}`;

  await repo.save(
    SeoUserV1.parse({
      ...user,
      passwordResetTokenHash: hashToken(token),
      passwordResetExpiresAt: expiresAt,
      updatedAt: new Date().toISOString(),
    }),
  );

  try {
    await sendEmail({
      to: user.email,
      subject: "Reset your SEOOS password",
      html: `<p>Use this secure link to reset your SEOOS password:</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 30 minutes.</p>`,
    });
  } catch (error) {
    await repo.save(
      SeoUserV1.parse({
        ...user,
        passwordResetTokenHash: "",
        passwordResetExpiresAt: "",
        updatedAt: new Date().toISOString(),
      }),
    );
    if (error instanceof EmailNotConfiguredError) {
      return NextResponse.json(
        { error: "Password reset email is not configured. Ask an admin to force reset your account." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Could not send password reset email" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
