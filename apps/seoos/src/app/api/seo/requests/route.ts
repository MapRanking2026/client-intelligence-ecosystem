import { NextResponse } from "next/server";

import { isSeoosRequestsEnabled } from "@/src/lib/flags";
import { resolveSeoContext } from "@/src/lib/server/context";
import {
  CreateSeoRequestInput,
  listRequests,
  submitSeoRequest,
} from "@/src/lib/server/seo-engine";

function disabled() {
  return NextResponse.json(
    { error: "SEOOS requests are disabled" },
    { status: 404 },
  );
}

export async function GET(request: Request) {
  if (!isSeoosRequestsEnabled()) return disabled();
  const ctx = resolveSeoContext(request);
  return NextResponse.json({ tenantId: ctx.tenantId, data: listRequests(ctx.tenantId) });
}

export async function POST(request: Request) {
  if (!isSeoosRequestsEnabled()) return disabled();
  const ctx = resolveSeoContext(request);
  try {
    const input = CreateSeoRequestInput.parse(await request.json());
    const result = submitSeoRequest(ctx, input);
    return NextResponse.json(result, { status: result.deduped ? 200 : 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to submit request",
      },
      { status: 400 },
    );
  }
}
