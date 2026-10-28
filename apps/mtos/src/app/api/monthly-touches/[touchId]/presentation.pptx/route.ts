import fs from "fs";
import path from "path";

import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { buildPptx } from "@/src/lib/server/services/pptx-builder";

/**
 * Downloads the stored deck as a real .pptx.
 *
 * Built on demand from the saved Presentation rather than cached as a file: the AM
 * edits the prep and regenerates, and a stale deck sitting in storage is worse than
 * a two-second rebuild. Nothing is written anywhere -- the bytes go straight to the
 * browser.
 */
function safeFileName(value: string): string {
  return (
    value
      .replace(/[^\w\s.-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 80) || "monthly-touch"
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  await resolveTenantContext(request);
  const { touchId } = await params;

  const touch = await getMtosDataSource().getMonthlyTouchById(touchId);
  if (!touch) {
    return NextResponse.json({ error: "Monthly touch not found" }, { status: 404 });
  }

  const presentation = touch.presentation;
  if (!presentation || presentation.status !== "generated" || !presentation.slides?.length) {
    return NextResponse.json(
      { error: "No presentation has been generated for this touch yet." },
      { status: 404 },
    );
  }

  // The logo ships in public/, which is readable at runtime. Missing is survivable:
  // the deck builds without it rather than failing the download.
  let logo: Buffer | null = null;
  try {
    logo = await fs.promises.readFile(path.join(process.cwd(), "public", "brand", "mapranking-mark.png"));
  } catch {
    logo = null;
  }

  const file = await buildPptx(presentation, logo);
  const name = safeFileName(
    [presentation.clientName || "Monthly Touch", presentation.periodLabel].filter(Boolean).join(" "),
  );

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "content-disposition": `attachment; filename="${name}.pptx"`,
      "cache-control": "no-store",
    },
  });
}
