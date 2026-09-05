import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getServerEnv } from "@/src/lib/server/env";
import {
  CreateMtosSeoRequestInput,
  createMtosSeoRequest,
  getMtosReceivedPackage,
  listMtosSeoRequests,
} from "@/src/lib/server/seo-intelligence/request-service";

const CREATE_ROLES = new Set(["account_manager", "manager", "tenant_admin"]);

export async function GET(request: Request) {
  const env = getServerEnv();
  if (!env.seoosEnabled) return NextResponse.json({ error: "SEOOS disabled" }, { status: 404 });
  const context = await resolveTenantContext(request);
  const clientId = new URL(request.url).searchParams.get("clientId") ?? undefined;
  const requests = await listMtosSeoRequests(context, clientId);
  // Attach the latest received package freshness per request.
  const data = await Promise.all(
    requests.map(async (r) => ({
      request: r,
      package: await getMtosReceivedPackage(context, r.id),
    })),
  );
  return NextResponse.json({ context, data });
}

export async function POST(request: Request) {
  const env = getServerEnv();
  if (!env.seoosEnabled || !env.seoosRequestsEnabled) {
    return NextResponse.json({ error: "SEOOS requests disabled" }, { status: 404 });
  }
  const context = await resolveTenantContext(request);
  if (!CREATE_ROLES.has(context.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const input = CreateMtosSeoRequestInput.parse(await request.json());
    const result = await createMtosSeoRequest(context, input);
    return NextResponse.json(result, { status: result.deduped ? 200 : 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create request" },
      { status: 400 },
    );
  }
}
