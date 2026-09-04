import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { extractBrandFromDocx } from "@/src/lib/server/reports/brand-extract";

const MAX_DOCX_CHARS = 12_000_000; // ~9 MB base64

/** Seed candidate branding from an uploaded sample .docx. Returns extracted values
 *  for the operator to confirm — does not save anything. */
export async function POST(request: Request) {
  await resolveTenantContext(request);
  const body = (await request.json().catch(() => ({}))) as { dataUrl?: string };

  const dataUrl = body.dataUrl || "";
  if (!/^data:.*base64,/.test(dataUrl)) {
    return NextResponse.json({ error: "Upload a Word (.docx) sample report to seed the brand." }, { status: 400 });
  }
  if (dataUrl.length > MAX_DOCX_CHARS) {
    return NextResponse.json({ error: "That file is too large — keep the sample under ~9 MB." }, { status: 400 });
  }

  try {
    const base64 = dataUrl.split(",").pop() || "";
    const buffer = Buffer.from(base64, "base64");
    const extracted = await extractBrandFromDocx(buffer);
    return NextResponse.json({ data: extracted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't read that sample report" },
      { status: 400 },
    );
  }
}
