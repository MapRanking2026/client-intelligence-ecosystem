import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { listOriginalReports, readOriginalReport, previewOriginalComparison, approveOriginalComparison, loadRankImage } from "@/src/lib/server/services/original-rank-report-service";
export const runtime = "nodejs";
export const maxDuration = 180;
const id = z.string().regex(/^[a-f0-9]{24}$/i);
const action = z.discriminatedUnion("action", [z.object({ action: z.literal("preview"), reportId: id, heatmapId: id, scanA: id, scanB: id }), z.object({ action: z.literal("approve"), imageId: z.string().regex(/^[a-f0-9]{64}$/) })]);
export async function GET(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  try {
    const context = await resolveTenantContext(request), { touchId } = await params, query = new URL(request.url).searchParams;
    if (query.has("image")) {
      const imageId = z.string().regex(/^[a-f0-9]{64}$/).parse(query.get("image"));
      const result = await loadRankImage(context, { id: imageId, touchId, width: 0, height: 0, mimeType: "image/png" });
      return new NextResponse(new Uint8Array(result.bytes), { headers: { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    }
    if (!query.get("reportId")) return NextResponse.json({ data: await listOriginalReports(context, touchId) });
    const report = await readOriginalReport(context, touchId, id.parse(query.get("reportId")));
    return NextResponse.json({ data: { business: report.business, keywords: report.keywords, approved: report.touch.approvedRankComparisons || [] } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read original Rank Tracker report." }, { status: 400 }); }
}
export async function POST(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  try {
    const context = await resolveTenantContext(request), { touchId } = await params, input = action.parse(await request.json());
    const data = input.action === "preview" ? await previewOriginalComparison(context, touchId, input) : await approveOriginalComparison(context, touchId, input.imageId);
    return NextResponse.json({ data });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare comparison." }, { status: 400 }); }
}
