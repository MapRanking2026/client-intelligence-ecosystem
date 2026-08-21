import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { generateRetentionReport } from "@/src/lib/server/services/retention-service";
import type { ReportLink } from "@/src/lib/server/reports/report-builder";

/** Generate the client-facing branded retention report and return it as a .docx download. */
export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;

  const body = (await request.json().catch(() => ({}))) as {
    links?: { name?: unknown; url?: unknown; note?: unknown }[];
    signerName?: string;
    signerTitle?: string;
  };

  const links: ReportLink[] = Array.isArray(body.links)
    ? body.links
        .filter((l) => l && typeof l.name === "string" && typeof l.url === "string" && /^https?:\/\//i.test(String(l.url)))
        .map((l) => ({
          name: String(l.name).slice(0, 120),
          url: String(l.url),
          note: (typeof l.note === "string" && l.note.trim()) || "New page built and optimized.",
        }))
    : [];

  try {
    const result = await generateRetentionReport(context, clientId, {
      links,
      signerName: body.signerName,
      signerTitle: body.signerTitle,
    });
    if (!result) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    return new Response(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't generate the report" },
      { status: 500 },
    );
  }
}
