import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getCommandCenterView } from "@/src/lib/server/services/command-center-service";

export async function GET(request: Request) {
  const context = await resolveTenantContext(request);
  return NextResponse.json(await getCommandCenterView(context));
}
