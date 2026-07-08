import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { syncClickUpClients } from "@/src/lib/server/clickup-client-sync";

const clickUpSyncRequestSchema = z.object({
  selectedIds: z.array(z.string()).optional(),
  listId: z.string().optional(),
  managerName: z.string().optional(),
});

export async function POST(request: Request) {
  const context = await resolveTenantContext(request);

  try {
    const payload = clickUpSyncRequestSchema.parse(await request.json().catch(() => ({})));
    const syncResult = await syncClickUpClients(context, payload);
    return NextResponse.json({
      context,
      data: {
        syncResult,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "ClickUp client sync failed",
      },
      { status: 400 },
    );
  }
}
