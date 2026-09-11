import { NextResponse } from "next/server";
import { z } from "zod";

import { tryGetSessionFromRequest } from "@/src/lib/auth/session-cookie";
import { hashPassword } from "@/src/lib/server/password";
import { getUserRepo } from "@/src/lib/server/repositories/user-repo";
import { SeoUserV1 } from "@/src/lib/domain/user";

const Body = z.object({ newPassword: z.string().min(8, "Password must be at least 8 characters") });

/**
 * Set a new password for the currently-authenticated user and clear any forced
 * reset flag. The session (just established at login) identifies the user, so no
 * old password is required here — the user already proved it to log in.
 */
export async function POST(request: Request) {
  const session = await tryGetSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const repo = getUserRepo();
  const user = await repo.getById(session.tenantId, session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const { salt, hash } = hashPassword(parsed.data.newPassword);
  await repo.save(
    SeoUserV1.parse({
      ...user,
      passwordSalt: salt,
      passwordHash: hash,
      mustResetPassword: false,
      updatedAt: new Date().toISOString(),
    }),
  );
  return NextResponse.json({ ok: true });
}
