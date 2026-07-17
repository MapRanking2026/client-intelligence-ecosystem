import { after, NextResponse } from "next/server";

import { completeOAuthConnection, isSyncEnabledProvider } from "@/src/lib/server/integrations";
import { syncIntegrationProvider } from "@/src/lib/server/integration-sync";

// The auto-sync kicked off after connecting can page through hundreds of records.
export const maxDuration = 300;

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
    const { providerId, context } = await completeOAuthConnection(callbackUrl, { code, state }, callbackUrl.origin);
    integrationsUrl.searchParams.set("status", "connected");
    integrationsUrl.searchParams.set("provider", providerId);

    // Sync immediately after connecting so the user never has to click "Sync now". Runs in the
    // background after the redirect; a failure here must not affect the connection result.
    if (isSyncEnabledProvider(providerId)) {
      integrationsUrl.searchParams.set("autosync", "1");
      after(async () => {
        try {
          await syncIntegrationProvider(context, providerId, callbackUrl.origin);
        } catch (syncError) {
          console.warn(
            `Auto-sync after connecting ${providerId} failed: ${syncError instanceof Error ? syncError.message : "unknown error"}`,
          );
        }
      });
    }

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
