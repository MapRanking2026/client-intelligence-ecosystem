import type { Role } from "@/src/lib/contracts/mtos";

/**
 * Who may read and rewrite the Prompt Engine.
 *
 * Pure and separate from the store on purpose, for the same reason as `qc-access.ts`: a permission
 * rule that can only be exercised by signing in is a rule nobody writes a negative test for.
 *
 * The decision behind this file (owner, 9 November 2026): **only an admin reaches the Prompt
 * Engine.** Account managers and QC specialists keep every other permission they have today; this
 * is about the engine alone.
 *
 * Until this file existed, the four `/api/prompts/*` routes and the `/settings/prompt-engine` screen
 * had no role check at all. They sat behind the sign-in cookie gate in `proxy.ts`, so they were
 * never open to the internet -- but every signed-in account manager and QC reviewer could read and
 * rewrite every prompt in the library. Each prompt is the live instruction a workflow runs on the
 * next request, so one edit in that screen changes what every AM's preparation, client email and
 * post-call notes say, with no deploy and no review. That is an owner's decision, not a front-line
 * one.
 *
 * A `manager` is deliberately NOT admitted, even though managers have oversight of QC and of the
 * team's work. Oversight is reading what happened; this screen rewrites what happens next.
 */
export function canUsePromptEngine(role: Role): boolean {
  return role === "tenant_admin";
}

/** What a non-admin is told, on the screen and in the API's 403 body. */
export const PROMPT_ENGINE_ADMIN_ONLY =
  "The Prompt Engine is limited to administrators. These prompts are the live instructions every MTOS workflow runs on, so only an admin can read or change them.";
