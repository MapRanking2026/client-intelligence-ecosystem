import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerEnv } from "@/src/lib/server/env";
import { createSessionToken } from "@/src/lib/auth/session-cookie";
import { verifyPassword } from "@/src/lib/server/password";
import { getUserRepo } from "@/src/lib/server/repositories/user-repo";

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * SEOOS's own credential login. Verifies email + password (scrypt) against the
 * SEOOS user store and issues a SEOOS session cookie. Generic errors only — no
 * user enumeration.
 */
export async function POST(request: Request) {
  const env = getServerEnv();
  if (!env.sessionCookieSecret) {
    return NextResponse.json(
      { error: "Auth is not configured on the server (SESSION_COOKIE_SECRET missing)." },
      { status: 500 },
    );
  }
  const parsed = LoginBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const user = await getUserRepo().getByEmail(env.pilotTenantId, email);
  const ok =
    user != null &&
    !user.disabled &&
    verifyPassword(password, user.passwordSalt, user.passwordHash);
  if (!user || !ok) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const token = await createSessionToken({
    tenantId: user.tenantId,
    userId: user.userId,
    role: user.roles[0] ?? "seo_specialist",
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(env.sessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
