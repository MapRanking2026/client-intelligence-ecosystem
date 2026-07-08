import { NextResponse } from "next/server";
import { z } from "zod";

import type { Role } from "@/src/lib/contracts/mtos";
import { createSessionToken } from "@/src/lib/auth/session-cookie";
import { getFirebaseAdminAuth, getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantUserPath } from "@/src/lib/server/firebase/collections";
import { getServerEnv } from "@/src/lib/server/env";

const requestSchema = z.object({
  idToken: z.string().min(1),
});

const allowedRoles = new Set<Role>([
  "account_manager",
  "manager",
  "qa_reviewer",
  "tenant_admin",
]);

export async function POST(request: Request) {
  const env = getServerEnv();
  const body = requestSchema.parse(await request.json());

  const auth = getFirebaseAdminAuth();
  const db = getFirebaseAdminDb();
  if (!auth || !db) {
    return NextResponse.json(
      { error: "Firebase admin is not configured on the server." },
      { status: 500 },
    );
  }

  const decoded = await auth.verifyIdToken(body.idToken);
  const claimedTenantId = typeof decoded.tenantId === "string" ? decoded.tenantId : null;
  const tenantId = claimedTenantId || env.pilotTenantId;

  const userSnapshot = await db.doc(tenantUserPath(tenantId, decoded.uid)).get();
  if (!userSnapshot.exists) {
    return NextResponse.json(
      { error: "User is not assigned to this tenant." },
      { status: 403 },
    );
  }

  const userData = userSnapshot.data() as { role?: Role } | undefined;
  const role = userData?.role;
  if (!role || !allowedRoles.has(role)) {
    return NextResponse.json({ error: "User role is not allowed." }, { status: 403 });
  }

  const token = await createSessionToken({
    tenantId,
    userId: decoded.uid,
    role,
  });

  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.appEnv !== "development",
    path: "/",
  };

  const response = NextResponse.json({ ok: true });
  response.cookies.set(env.sessionCookieName, "", {
    ...cookieOptions,
    expires: new Date(0),
    maxAge: 0,
  });
  response.cookies.set(env.sessionCookieName, token, {
    ...cookieOptions,
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
