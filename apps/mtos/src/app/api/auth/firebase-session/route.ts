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

  // Resolve the user's tenant defensively: try their Firebase claim first, then
  // the pilot env, then the canonical "map-ranking". This tolerates env drift
  // (e.g. MTOS_PILOT_TENANT_ID pointing at a different tenant than where the
  // user's record actually lives) so a mismatch can never lock a user out.
  const candidateTenantIds = Array.from(
    new Set(
      [claimedTenantId, env.pilotTenantId, "map-ranking"].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );

  let tenantId: string | null = null;
  let userData: { role?: Role } | undefined;
  for (const candidate of candidateTenantIds) {
    const snapshot = await db.doc(tenantUserPath(candidate, decoded.uid)).get();
    if (snapshot.exists) {
      tenantId = candidate;
      userData = snapshot.data() as { role?: Role } | undefined;
      break;
    }
  }

  if (!tenantId) {
    return NextResponse.json(
      { error: "User is not assigned to this tenant." },
      { status: 403 },
    );
  }

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
