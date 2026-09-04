import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { commitmentsResponse } from "@/src/lib/api/mtos-query";

export async function GET(request: Request) {
  const context = await resolveTenantContext(request);
  return NextResponse.json(await commitmentsResponse(context));
}
