import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { searchEverything } from "@/src/lib/server/services/global-search-service";

/**
 * The endpoint behind ⌘K.
 *
 * A GET with the query in the URL, because the result depends on nothing but the query and the
 * signed-in AM, and because the palette fires one of these per keystroke pause -- a GET is what
 * the browser can abort cleanly when the next one supersedes it.
 *
 * `touchId` is optional context, not a filter: when the AM has a touch open, brief-section results
 * link into that touch rather than to the list of touches.
 */
export async function GET(request: Request) {
  const context = await resolveTenantContext(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const touchId = url.searchParams.get("touchId") || "";

  try {
    const result = await searchEverything(context, query, touchId ? { touchId } : {});
    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The search did not run." },
      { status: 500 },
    );
  }
}
