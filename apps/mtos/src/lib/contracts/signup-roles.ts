import type { Role } from "@/src/lib/contracts/mtos";
import { QC_SPECIALIST_TITLE } from "@/src/lib/contracts/qc-access";

/**
 * The roles somebody can choose when creating an account, and what each is called on the form.
 *
 * One list, used by both the sign-up screen and the route that accepts the sign-up. That is the
 * point of the file: before it, the form offered two options and the server's schema listed the
 * same two in a second place, so adding a role meant editing two files and a privilege boundary was
 * described twice. A list of permitted roles should exist once.
 *
 * ## What this list is not
 *
 * It is **not** the set of roles the app has. `Role` has four; `manager` is deliberately absent
 * here (owner's decision, 5 November 2026: the three below are the only ones to offer). Existing
 * manager accounts are untouched and keep working -- this governs sign-up only, not who exists.
 *
 * ## The invite code is the real gate
 *
 * Choosing a role on a form is a request, not an entitlement. The route checks an invite code per
 * role before it writes anything, and `signupCodeEnvVar` below names the variable each role's code
 * comes from so the two cannot drift apart.
 *
 * A role whose variable is unset **cannot be signed up for at all** (owner's decision,
 * 5 November 2026). It used to mean the opposite -- unset was ungated, so anybody who knew the
 * tenant id could self-grant any role, Admin included, and neither variable was set on this
 * deployment. Failing closed is why the list can stay short and still be safe.
 */

export interface SignupRoleOption {
  role: Role;
  /** What the person signing up sees. The job, not the database value. */
  label: string;
  /** One line under the option, so nobody picks a role by guessing at its name. */
  hint: string;
}

/**
 * The three, in the order they appear on the form: least access first.
 *
 * Account Manager leads because it is what almost everybody signing up is, and a list whose first
 * option is the most powerful one invites a careless click on Admin.
 */
export const SIGNUP_ROLES: SignupRoleOption[] = [
  {
    role: "account_manager",
    label: "Account Manager",
    hint: "Runs monthly touches for a book of clients, and sees their own QC scores and coaching.",
  },
  {
    role: "qa_reviewer",
    label: QC_SPECIALIST_TITLE,
    hint: "Scores finished monthly touches against the 17-point rubric and answers appeals.",
  },
  {
    role: "tenant_admin",
    label: "Admin",
    hint: "Full access, including settings, integrations and everybody's QC.",
  },
];

/** The roles the sign-up route accepts, derived from the list above so they cannot disagree. */
export const SIGNUP_ROLE_VALUES = SIGNUP_ROLES.map((option) => option.role) as [
  Role,
  ...Role[],
];

export function isSignupRole(value: string): value is Role {
  return SIGNUP_ROLE_VALUES.includes(value as Role);
}

export function signupRoleLabel(role: Role): string {
  return SIGNUP_ROLES.find((option) => option.role === role)?.label || role;
}

/**
 * Which environment variable holds the invite code for a role.
 *
 * Named here rather than in a `switch` inside the route so that adding a role to the list above
 * cannot quietly produce an ungated one: a role with no entry here returns undefined, and the
 * route treats that as "no code configured" exactly as it already did for a blank variable.
 *
 * The two non-admin roles share the manager code. That is deliberate -- it is the variable this
 * deployment already has for "someone who works here", and giving each role its own would mean
 * three secrets to set before anybody could sign up at all.
 */
export function signupCodeEnvVar(role: Role): "adminSignupCode" | "managerSignupCode" | undefined {
  if (role === "tenant_admin") return "adminSignupCode";
  if (role === "account_manager" || role === "qa_reviewer") return "managerSignupCode";
  return undefined;
}
