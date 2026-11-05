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
 * An empty string used to mean "no code required", which meant a role whose variable was unset
 * could be claimed by anybody who knew the tenant id -- including Admin. `requireCodeForRole` now
 * only reports what is configured; the decision about an unset one is made at the call site
 * below, where it fails closed.
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
    The invite code, and what happens when there isn't one.

    Fails closed (owner's decision, 5 November 2026). A role whose code is not configured cannot
    be signed up for at all, rather than being open to anybody who knows the tenant id. Measured
    on this deployment before the change: neither MTOS_MANAGER_SIGNUP_CODE nor
    MTOS_ADMIN_SIGNUP_CODE was set, so every role -- Admin included -- could be self-granted.

    The message names the variable, because the only person who can clear this is whoever runs the
    deployment, and "sign-up is unavailable" with no reason sends them hunting.

    `GET /api/auth/firebase-signup/roles` reports the same state so the form can close the option
    before the browser creates a Firebase Auth account. This check is the guarantee; that one is
    what stops a refusal here stranding an auth account with no tenant behind it.
  */
  const requiredCode = requireCodeForRole(env, body.role as Role);
  if (!requiredCode) {
    const variable =
      signupCodeEnvVar(body.role as Role) === "adminSignupCode"
        ? "MTOS_ADMIN_SIGNUP_CODE"
        : "MTOS_MANAGER_SIGNUP_CODE";
    return NextResponse.json(
      {
        error: `Sign-up for this role is closed: no invite code is configured for it. Set ${variable} on the deployment to open it.`,
      },
      { status: 403 },
    );
  }
  if ((body.code || "") !== requiredCode) {
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

