import { NextResponse } from "next/server";

import { SIGNUP_ROLES, signupCodeEnvVar } from "@/src/lib/contracts/signup-roles";
import { getServerEnv } from "@/src/lib/server/env";

/**
 * Which roles can actually be signed up for right now.
 *
 * ## Why this exists at all
 *
 * The browser creates the Firebase Auth account **first**, and only then calls the sign-up route
 * to attach a tenant and a role. So a sign-up the server refuses leaves an auth account with no
 * tenant user document behind it: that person can no longer sign in ("User is not assigned to
 * this tenant") and can no longer sign up either, because their email is taken. Refusing late is
 * therefore not a safe way to say no -- the form has to know before it creates anything.
 *
 * This answers that question, and the form greys out what it cannot offer.
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
       * Whether it can be chosen. A role with no configured code is closed rather than open: the
       * server refuses it, and the form must not let somebody burn an email address finding out.
       */
      available: configured,
    };
  });

  return NextResponse.json({
    data: {
      roles,
      /** True when nothing can be signed up for, so the form can say so once instead of per row. */
      allClosed: roles.every((role) => !role.available),
    },
  });
}
