import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getClientMappingView, saveClientMappings } from "@/src/lib/server/services/client-mappings-service";

const saveSchema = z.object({
  mappings: z.object({
    rankTracker: z.array(z.string()).optional(),
    mapCheckins: z.array(z.string()).optional(),
    googleBusinessProfile: z.array(z.string()).optional(),
    gohighlevel: z.array(z.string()).optional(),
    googleAds: z.array(z.string()).optional(),
  }),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;
  const view = await getClientMappingView(context, clientId);

  if (!view) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  return NextResponse.json({ data: view });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;

  try {
    const payload = saveSchema.parse(await request.json());
    const saved = await saveClientMappings(context, clientId, payload.mappings);
    return NextResponse.json({ data: { integrationMappings: saved } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save mappings" },
      { status: 400 },
    );
  }
}
