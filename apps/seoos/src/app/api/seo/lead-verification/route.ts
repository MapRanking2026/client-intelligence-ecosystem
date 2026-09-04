import { NextResponse } from "next/server";
import { LeadCallListQueryV1 } from "@cie/contracts";
import { AuthzError, requirePermission, sortDirectionFromAlias } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getLeadCallRepo } from "@/src/lib/server/repositories/lead-call-repo";

/** Shared canonical Lead & Call list — server-side sort before pagination. */
export async function GET(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "lead_call.read");
    const url = new URL(request.url);
    const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
    const query = LeadCallListQueryV1.parse({
      sort: sortDirectionFromAlias(dir),
      limit: Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50,
      cursor: url.searchParams.get("cursor") ?? undefined,
      filter: {
        clientId: url.searchParams.get("clientId") ?? undefined,
      },
    });
    const page = await getLeadCallRepo().list(authz.tenantId, query);
    return NextResponse.json({ data: page });
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list" },
      { status: 400 },
    );
  }
}
