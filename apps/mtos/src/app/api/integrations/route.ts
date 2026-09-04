import { after, NextResponse } from "next/server";
import { z } from "zod";

import { integrationProviderIds } from "@/src/lib/contracts/integrations";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { syncIntegrationProvider, testIntegrationConnection } from "@/src/lib/server/integration-sync";
import {
  connectIntegration,
  disconnectIntegration,
  isSyncEnabledProvider,
  listIntegrationViews,
  refreshIntegration,
} from "@/src/lib/server/integrations";

// Provider syncs page through hundreds of remote records and write back to Firestore, which runs
// well past Vercel's default function timeout. 300s is the Vercel ceiling.
export const maxDuration = 300;

const providerIdSchema = z.enum(integrationProviderIds);

const integrationActionSchema = z.object({
  action: z.enum(["connect", "disconnect", "refresh", "sync", "test"]),
  providerId: providerIdSchema,
  credentials: z.record(z.string(), z.string()).optional(),
});

export async function GET(request: Request) {
  const context = await resolveTenantContext(request);
  const integrations = await listIntegrationViews(context);

  return NextResponse.json({
    context,
    data: {
      integrations,
    },
  });
}

export async function POST(request: Request) {
  const context = await resolveTenantContext(request);

  try {
    const payload = integrationActionSchema.parse(await request.json());
    const origin = new URL(request.url).origin;

    if (payload.action === "disconnect") {
      await disconnectIntegration(context, payload.providerId);
      return NextResponse.json({
        context,
        data: {
          providerId: payload.providerId,
          disconnected: true,
        },
      });
    }

    if (payload.action === "refresh") {
      const provider = await refreshIntegration(context, payload.providerId, origin);
      return NextResponse.json({
        context,
        data: {
          provider,
        },
      });
    }

    if (payload.action === "sync") {
      const syncResult = await syncIntegrationProvider(context, payload.providerId, origin);
      return NextResponse.json({
        context,
        data: {
          providerId: payload.providerId,
          syncResult,
        },
      });
    }

    if (payload.action === "test") {
      const testResult = await testIntegrationConnection(context, payload.providerId, origin);
      return NextResponse.json({
        context,
        data: {
          providerId: payload.providerId,
          testResult,
        },
      });
    }

    const connection = await connectIntegration(
      context,
      payload.providerId,
      payload.credentials || {},
      origin,
    );

    // OAuth providers return a redirectUrl and finish connecting in the callback (auto-sync happens
    // there). A direct API-key / rotating-token connect saved immediately, so sync it now without
    // making the user click "Sync now".
    const savedDirectly = !("redirectUrl" in connection) && isSyncEnabledProvider(payload.providerId);
    if (savedDirectly) {
      after(async () => {
        try {
          await syncIntegrationProvider(context, payload.providerId, origin);
        } catch (syncError) {
          console.warn(
            `Auto-sync after connecting ${payload.providerId} failed: ${syncError instanceof Error ? syncError.message : "unknown error"}`,
          );
        }
      });
    }

    return NextResponse.json({
      context,
      data: { ...connection, autoSync: savedDirectly },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Integration request failed",
      },
      { status: 400 },
    );
  }
}
