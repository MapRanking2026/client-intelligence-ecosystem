import { NextResponse } from "next/server";

import { completeOAuthConnection } from "@/src/lib/server/integrations";

export async function GET(request: Request) {
  const callbackUrl = new URL(request.url);
  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  const error =
    callbackUrl.searchParams.get("error") ||
    callbackUrl.searchParams.get("errorMessage") ||
    callbackUrl.searchParams.get("error_message") ||
    callbackUrl.searchParams.get("message") ||
    callbackUrl.searchParams.get("reason");
  const errorDescription =
    callbackUrl.searchParams.get("error_description") ||
    callbackUrl.searchParams.get("errorDescription") ||
    callbackUrl.searchParams.get("error_description_message");

  const integrationsUrl = new URL("/settings/integrations", callbackUrl.origin);

  if (error) {
    integrationsUrl.searchParams.set("status", "error");
    integrationsUrl.searchParams.set("message", errorDescription || error);
    return NextResponse.redirect(integrationsUrl);
  }

  if (!code || !state) {
    integrationsUrl.searchParams.set("status", "error");
    integrationsUrl.searchParams.set("message", "OAuth callback is missing a code or state value.");
    return NextResponse.redirect(integrationsUrl);
  }

  try {
    const providerId = await completeOAuthConnection(callbackUrl, { code, state }, callbackUrl.origin);
    integrationsUrl.searchParams.set("status", "connected");
    integrationsUrl.searchParams.set("provider", providerId);
    return NextResponse.redirect(integrationsUrl);
  } catch (caught) {
    integrationsUrl.searchParams.set("status", "error");
    integrationsUrl.searchParams.set(
      "message",
      caught instanceof Error ? caught.message : "OAuth connection failed",
    );
    return NextResponse.redirect(integrationsUrl);
  }
}
