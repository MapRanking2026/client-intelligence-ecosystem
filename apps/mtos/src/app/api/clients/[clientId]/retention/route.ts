import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { assembleRetentionFacts, buildInternalBrief } from "@/src/lib/server/services/retention-service";

/** Assemble the internal retention case (facts + brief) for the on-screen "Retention Mode" panel. */
export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;
  try {
    const facts = await assembleRetentionFacts(context, clientId);
    if (!facts) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    return NextResponse.json({ data: { facts, brief: buildInternalBrief(facts) } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't assemble the retention case" },
      { status: 500 },
    );
  }
}
