import { NextResponse } from "next/server";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import { PROMPT_ENGINE_ADMIN_ONLY, canUsePromptEngine } from "@/src/lib/contracts/prompt-engine-access";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";

/**
 * The admin gate every `/api/prompts/*` route runs before it reads or writes anything.
 *
 * One helper rather than four copies of the same three lines, so the four routes cannot drift apart
 * and so the rule can be checked without a session or a server (see `scripts/check-prompt-engine.ts`).
 * Shaped after `src/app/api/engine/shadow/route.ts`, which is the pattern already in the codebase.
 *
 * Seed mode is not given an escape hatch. `MTOS_USE_SEED_DATA=true` makes
 * `resolveTenantContext` fall back to an `account_manager`, so a local seed-data run reaches the
 * engine only by signing in as an admin -- which is the same rule as production, and better than a
 * bypass that would open the engine outright if that flag ever reached a deploy.
 */
export async function requirePromptEngineAdmin(
  request?: Request,
): Promise<{ ok: true; context: TenantContext } | { ok: false; response: NextResponse }> {
  const context = await resolveTenantContext(request);
  const denial = promptEngineDenial(context.role);
  return denial ? { ok: false, response: denial } : { ok: true, context };
}

/**
 * The 403 a role is refused with, or `null` when it is allowed through. Split out from the context
 * read so the rule itself is a pure function of the role.
 */
export function promptEngineDenial(role: TenantContext["role"]): NextResponse | null {
  if (canUsePromptEngine(role)) return null;
  return NextResponse.json({ error: PROMPT_ENGINE_ADMIN_ONLY }, { status: 403 });
}
