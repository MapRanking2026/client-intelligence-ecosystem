import { NextResponse } from "next/server";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { getServerEnv, hasGoogleOAuth } from "@/src/lib/server/env";
import { buildAuthUrl, isGoogleOAuthProvider } from "@/src/lib/server/google-oauth";

/** Begin Google OAuth for a Google integration (GBP / Search Console). */
export async function GET(request: Request) {
  const env = getServerEnv();
  const base = env.appUrl || new URL(request.url).origin;
  const back = (q: string) => NextResponse.redirect(new URL(`/integrations?${q}`, base));

  const authz = await resolveSeoAuthz(request);
  if (!authz || !authzHas(authz, "integrations.manage")) {
    return NextResponse.redirect(new URL("/sign-in", base));
  }
  const provider = new URL(request.url).searchParams.get("provider") ?? "";
  if (!isGoogleOAuthProvider(provider)) return back("error=unknown_provider");
  if (!hasGoogleOAuth()) return back("error=google_not_configured");

  return NextResponse.redirect(buildAuthUrl(provider));
}
