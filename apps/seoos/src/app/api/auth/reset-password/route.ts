import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { SeoUserV1 } from "@/src/lib/domain/user";
import { getServerEnv } from "@/src/lib/server/env";
import { hashPassword } from "@/src/lib/server/password";
import { getUserRepo } from "@/src/lib/server/repositories/user-repo";

const Body = z.object({
  email: z.string().email(),
  token: z.string().min(20),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

function tokenMatches(token: string, expectedHash: string) {
  const actual = Buffer.from(createHash("sha256").update(token).digest("hex"), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const env = getServerEnv();
  const repo = getUserRepo();
  const user = await repo.getByEmail(env.pilotTenantId, parsed.data.email);
  if (!user || !user.passwordResetTokenHash || !user.passwordResetExpiresAt) {
    return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
  }
  if (Date.parse(user.passwordResetExpiresAt) <= Date.now()) {
    return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
  }
  if (!tokenMatches(parsed.data.token, user.passwordResetTokenHash)) {
    return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
  }

  const { salt, hash } = hashPassword(parsed.data.newPassword);
  await repo.save(
    SeoUserV1.parse({
      ...user,
      passwordSalt: salt,
      passwordHash: hash,
      mustResetPassword: false,
      passwordResetTokenHash: "",
      passwordResetExpiresAt: "",
      updatedAt: new Date().toISOString(),
    }),
  );

  return NextResponse.json({ ok: true });
}
