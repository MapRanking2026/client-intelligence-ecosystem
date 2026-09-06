import { NextResponse } from "next/server";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { getServerEnv } from "@/src/lib/server/env";
import { exchangeCode, verifyState } from "@/src/lib/server/google-oauth";
import { saveOAuthConnection } from "@/src/lib/server/integrations-service";

/** Google OAuth callback: exchange the code and store the connection. */
export async function GET(request: Request) {
  const env = getServerEnv();
  const url = new URL(request.url);
  const base = env.appUrl || url.origin;
  const back = (q: string) => NextResponse.redirect(new URL(`/integrations?${q}`, base));

  const err = url.searchParams.get("error");
  if (err) return back(`error=${encodeURIComponent(err)}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("error=missing_code");

  const verified = verifyState(state);
  if (!verified) return back("error=bad_state");

  const authz = await resolveSeoAuthz(request);
  if (!authz || !authzHas(authz, "integrations.manage")) {
    return NextResponse.redirect(new URL("/sign-in", base));
  }

  try {
    const tokens = await exchangeCode(code);
    await saveOAuthConnection(authz.tenantId, verified.providerId, tokens, authz.userId);
    return back(`connected=${encodeURIComponent(verified.providerId)}`);
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : "oauth_failed")}`);
  }
}
