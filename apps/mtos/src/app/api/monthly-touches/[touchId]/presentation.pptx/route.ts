import { clientPresentation } from "@/src/lib/contracts/client-content";
import fs from "fs";
import path from "path";

import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { loadRankImage } from "@/src/lib/server/services/original-rank-report-service";
import { buildPptx } from "@/src/lib/server/services/pptx-builder";
import { presentationIdentity, withPresentationIdentity } from "@/src/lib/server/services/presentation-identity-service";

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
  const context = await resolveTenantContext(request);
  const { touchId } = await params;

  const touch = await getMtosDataSource(context).getMonthlyTouchById(touchId);
  if (!touch) {
    return NextResponse.json({ error: "Monthly touch not found" }, { status: 404 });
  }

  const client = await getMtosDataSource(context).getClientById(touch.clientId);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const identity = await presentationIdentity(context, client, touch);
  const presentation = clientPresentation(withPresentationIdentity(touch.noShow?.resolution === "loom" ? touch.noShow.presentation : touch.presentation, identity), touch);
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

  // The approved Report Builder captures for the comparison slides. Loaded here because this is
  // where the tenant context lives; one that cannot be read is skipped rather than failing the
  // download, and its slide then says the screenshot is missing instead of redrawing the map.
  const rankImages = new Map<string, Buffer>();
  const wanted = new Map(
    (presentation.slides || [])
      .flatMap((slide) => (slide.rankComparison?.originalImage ? [slide.rankComparison.originalImage] : []))
      .map((image) => [image.id, image] as const),
  );
  await Promise.all(
    [...wanted.values()].map(async (image) => {
      try {
        const loaded = await loadRankImage(context, image);
        rankImages.set(image.id, loaded.bytes);
      } catch (error) {
        console.warn(`[presentation.pptx] rank image ${image.id} unavailable`, error);
      }
    }),
  );

  const file = await buildPptx(presentation, logo, rankImages);
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
