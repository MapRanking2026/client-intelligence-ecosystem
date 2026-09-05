import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerEnv } from "@/src/lib/server/env";
import { createSessionToken } from "@/src/lib/auth/session-cookie";
import { hashPassword } from "@/src/lib/server/password";
import { getUserRepo } from "@/src/lib/server/repositories/user-repo";
import { SeoUserV1 } from "@/src/lib/domain/user";

const SignupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().max(120).optional(),
  code: z.string().optional(),
});

function sanitizeId(email: string): string {
  return email.split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "user";
}

/**
 * Self-service sign-up. The FIRST user in a tenant becomes tenant_admin (so the
 * team can bootstrap without the CLI); later users are seo_specialist. When
 * SEOOS_SIGNUP_CODE is set, sign-up requires it. Passwords are stored hashed.
 */
export async function POST(request: Request) {
  const env = getServerEnv();
  if (!env.sessionCookieSecret) {
    return NextResponse.json(
      { error: "Auth is not configured on the server (SESSION_COOKIE_SECRET missing)." },
      { status: 500 },
    );
  }

  const parsed = SignupBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { email, password, displayName, code } = parsed.data;

  const repo = getUserRepo();
  const tenantId = env.pilotTenantId;

  const existing = await repo.getByEmail(tenantId, email);
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const isFirstUser = !(await repo.anyExists(tenantId));
  if (!isFirstUser && env.signupCode && code !== env.signupCode) {
    return NextResponse.json({ error: "A valid sign-up code is required." }, { status: 403 });
  }

  const role = isFirstUser ? "tenant_admin" : "seo_specialist";
  let userId = sanitizeId(email);
  if (await repo.getById(tenantId, userId)) userId = `${userId}_${Date.now().toString(36).slice(-4)}`;

  const { salt, hash } = hashPassword(password);
  const now = new Date().toISOString();
  const user = SeoUserV1.parse({
    schemaVersion: 1,
    tenantId,
    userId,
    email: email.trim().toLowerCase(),
    displayName: displayName || email.split("@")[0],
    passwordSalt: salt,
    passwordHash: hash,
    roles: [role],
    clientVisibility: "all",
    disabled: false,
    createdAt: now,
    updatedAt: now,
  });
  await repo.save(user);

  const token = await createSessionToken({ tenantId, userId, role });
  const res = NextResponse.json({ ok: true, role, firstUser: isFirstUser });
  res.cookies.set(env.sessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
