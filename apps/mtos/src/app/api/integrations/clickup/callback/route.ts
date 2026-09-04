import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const legacyCallbackUrl = new URL(request.url);
  const oauthCallbackUrl = new URL("/api/integrations/oauth/callback", legacyCallbackUrl.origin);

  for (const [key, value] of legacyCallbackUrl.searchParams.entries()) {
    oauthCallbackUrl.searchParams.set(key, value);
  }

  oauthCallbackUrl.searchParams.set("provider", "clickup");

  return NextResponse.redirect(oauthCallbackUrl);
}
