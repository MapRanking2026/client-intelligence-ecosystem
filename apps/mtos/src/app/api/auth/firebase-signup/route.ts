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
 * The invite code this role needs, or "" when none is configured.
 *
 * "" means ungated, which is the behaviour this route already had: a role whose environment
 * variable is blank can be chosen by anybody who knows the tenant id. That is unchanged here on
 * purpose -- tightening it would stop account creation working on a deployment that has never set
 * these variables, which is a decision for whoever runs the deployment rather than for this patch.
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

  const requiredCode = requireCodeForRole(env, body.role as Role);
  if (requiredCode) {
    const provided = body.code || "";
    if (provided !== requiredCode) {
      return NextResponse.json({ error: "Invalid invite code" }, { status: 401 });
    }
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

