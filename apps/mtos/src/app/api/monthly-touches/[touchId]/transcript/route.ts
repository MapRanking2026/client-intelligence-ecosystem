import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { fetchMonthlyTouchTranscript } from "@/src/lib/server/services/meeting-transcript-service";

/**
 * The Gemini transcript for a monthly touch, resolved from its calendar event. Read-only --
 * nothing is persisted here, and the AM stays free to edit or replace what comes back.
 *
 * Expected failures (artifact not published yet, transcription off, Doc hosted elsewhere and
 * not shared, Meet not connected or connected without the Drive/Docs scopes) come back 200
 * with a `status` and a sentence to show, because they are all states the post-meeting step
 * has to explain rather than treat as an error. Only an unexpected fault returns non-2xx.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ touchId: string }> },
) {
  const context = await resolveTenantContext(request);
  const { touchId } = await params;

  try {
    const lookup = await fetchMonthlyTouchTranscript(context, touchId);
    return NextResponse.json({ context, data: lookup });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Transcript lookup failed",
      },
      { status: 500 },
    );
  }
}
