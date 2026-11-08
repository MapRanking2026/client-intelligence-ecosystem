import { NextResponse } from "next/server";
import { z } from "zod";

import type { Role } from "@/src/lib/contracts/mtos";
import { createSessionToken } from "@/src/lib/auth/session-cookie";
import { getFirebaseAdminAuth, getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantPath, tenantUserPath } from "@/src/lib/server/firebase/collections";
import { getServerEnv } from "@/src/lib/server/env";
import { SIGNUP_ROLE_VALUES, signupCodeEnvVar } from "@/src/lib/contracts/signup-roles";

/**
 * The roles this route accepts, taken from the one list the form also reads.
 *
 * `manager` is no longer offered (owner's decision, 5 November 2026) and is therefore no longer
 * accepted here either: a role the form cannot show is not a role this route should take from a
 * hand-written request. Existing manager accounts are untouched -- this is the account-creation
 * path, not an authorisation check, and nothing here reads or rewrites an account that exists.
 */
const requestSchema = z.object({
  idToken: z.string().min(1),
  tenantId: z.string().min(1),
  role: z.enum(SIGNUP_ROLE_VALUES),
  code: z.string().optional(),
});

/**
 * The invite code this role needs, or "" when the deployment has not configured one.
 *
 * "" means no code is required, which is the long-standing behaviour of this route and the
 * behaviour the owner asked for (7 November 2026). A role whose variable is unset is open to
 * anyone who knows the tenant id; setting the variable is what gates it.
 */
function requireCodeForRole(env: ReturnType<typeof getServerEnv>, role: Role) {
  const variable = signupCodeEnvVar(role);
  return variable ? env[variable] : "";
}

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
  const uid = decoded.uid;

  /*
    The invite code, when one is configured.

    An unset code means the role needs none, which is how this route has always worked. It was
    briefly changed to refuse such a role outright and changed back at the owner's request
    (7 November 2026): while nobody is using the app, a sign-up form that cannot create an account
    is the bigger problem.

    Worth knowing rather than hidden: with neither MTOS_MANAGER_SIGNUP_CODE nor
    MTOS_ADMIN_SIGNUP_CODE set, anybody who knows the tenant id can create an account in any role,
    Admin included. Setting either variable gates its roles immediately, with no code change.
  */
  const requiredCode = requireCodeForRole(env, body.role as Role);
  if (requiredCode && (body.code || "") !== requiredCode) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 401 });
  }

  const tenantId = body.tenantId.trim();
  const tenantSnapshot = await db.doc(tenantPath(tenantId)).get();
  if (!tenantSnapshot.exists) {
    return NextResponse.json({ error: "Tenant does not exist" }, { status: 404 });
  }

  const userRecord = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { tenantId, role: body.role });

  await db.doc(tenantUserPath(tenantId, uid)).set(
    {
      id: uid,
      email: userRecord.email || "",
      role: body.role,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  const token = await createSessionToken({
    tenantId,
    userId: uid,
    role: body.role,
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

