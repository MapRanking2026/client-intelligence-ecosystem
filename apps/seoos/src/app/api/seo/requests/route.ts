import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { isSeoosRequestsEnabled } from "@/src/lib/flags";
import { resolveSeoAuthz } from "@/src/lib/auth/context";
import {
  CreateSeoRequestInput,
  listRequests,
  submitSeoRequest,
} from "@/src/lib/server/seo-engine";

function authzError(e: unknown) {
  if (e instanceof AuthzError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
  }
  return NextResponse.json(
    { error: e instanceof Error ? e.message : "Request failed" },
    { status: 400 },
  );
}

export async function GET(request: Request) {
  if (!isSeoosRequestsEnabled()) {
    return NextResponse.json({ error: "SEOOS requests are disabled" }, { status: 404 });
  }
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.package.read");
    return NextResponse.json({ tenantId: authz.tenantId, data: await listRequests(authz.tenantId) });
  } catch (e) {
    return authzError(e);
  }
}

export async function POST(request: Request) {
  if (!isSeoosRequestsEnabled()) {
    return NextResponse.json({ error: "SEOOS requests are disabled" }, { status: 404 });
  }
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.request.create");
    const input = CreateSeoRequestInput.parse(await request.json());
    const result = await submitSeoRequest(
      { tenantId: authz.tenantId, userId: authz.userId, app: authz.app },
      input,
    );
    return NextResponse.json(result, { status: result.deduped ? 200 : 201 });
  } catch (e) {
    return authzError(e);
  }
}
