import { NextResponse } from "next/server";

import { SIGNUP_ROLES, signupCodeEnvVar } from "@/src/lib/contracts/signup-roles";
import { getServerEnv } from "@/src/lib/server/env";

/**
 * Which roles can actually be signed up for right now.
 *
 * ## Why this exists at all
 *
 * The browser creates the Firebase Auth account **first**, and only then calls the sign-up route
 * to attach a tenant and a role. So anything the server would refuse has to be known to the form
 * before it creates an account: a late refusal strands an auth account with no tenant behind it,
 * and that person can no longer sign in ("User is not assigned to this tenant") or sign up again,
 * because their email is taken.
 *
 * Today nothing is refused -- a role with no configured code needs none -- so every role comes
 * back available, and `requiresCode` is the only field that varies. It still earns its place: it
 * is what lets the form label the invite code as required rather than optional.
 *
 * ## What it does and does not reveal
 *
 * Booleans only. Never a code, never part of one, never its length. It says "Admin needs an
 * invite code" or "Admin cannot be signed up for right now", both of which anyone could learn in
 * one attempt at the form itself, and neither of which helps guess a secret.
 *
 * ## Why it lives under the sign-up path
 *
 * It must be reachable by somebody with no session, and `src/proxy.ts` already treats everything
 * under `/api/auth/firebase-signup` as public. Nesting it here makes it public without touching
 * that file's authentication allowlist, which is not a thing to edit for the sake of a form hint.
 */
export async function GET() {
  const env = getServerEnv();

  const roles = SIGNUP_ROLES.map((option) => {
    const variable = signupCodeEnvVar(option.role);
    const configured = variable ? Boolean(env[variable]) : false;
    return {
      role: option.role,
      label: option.label,
      hint: option.hint,
      /** True when a code is set for this role, so the form can mark the field required. */
      requiresCode: configured,
      /**
       * Whether it can be chosen. Always true: an unconfigured code means the role needs none,
       * which is exactly what the sign-up route does. Kept as a field rather than dropped so the
       * form has somewhere to read a refusal from if that ever changes again.
       */
      available: true,
    };
  });

  return NextResponse.json({
    data: {
      roles,
      /** True when nothing can be signed up for. False today; see `available` above. */
      allClosed: roles.every((role) => !role.available),
    },
  });
}
