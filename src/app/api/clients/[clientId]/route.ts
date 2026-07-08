import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { clientWorkspaceResponse } from "@/src/lib/api/mtos-query";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;
  const payload = await clientWorkspaceResponse(context, clientId);

  if (!payload) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  return NextResponse.json(payload);
}
