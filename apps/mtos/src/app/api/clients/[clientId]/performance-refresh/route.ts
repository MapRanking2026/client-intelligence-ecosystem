import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { refreshClientPerformance } from "@/src/lib/server/services/client-performance-service";

/**
 * The Performance tab's refresh button.
 *
 * POST only, and its own route rather than an action on the client route, because that one is a
 * plain GET of the workspace and everything here reaches outside MTOS: it asks Google, GoHighLevel
 * and the rest for this client's numbers again. Nothing happens without the button being pressed.
 *
 * A platform that refuses is reported in the response rather than failing the request -- the other
 * platforms' numbers are still worth having, and the AM needs to be told which one did not answer
 * rather than shown a red box over the lot.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;

  try {
    const data = await refreshClientPerformance(context, clientId);
    return NextResponse.json({ context, data });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The performance refresh could not be completed. Nothing was changed.",
      },
      { status: 500 },
    );
  }
}
