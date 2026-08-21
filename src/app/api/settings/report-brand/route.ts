import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getReportBrand, saveReportBrand, type ReportBrand } from "@/src/lib/server/services/report-brand-service";
import { deriveBrandColors } from "@/src/lib/server/reports/brand-extract";

const HEX = /^#?[0-9a-fA-F]{6}$/;
const MAX_LOGO_CHARS = 400_000; // ~300 KB logo, plenty for a report mark

export async function GET(request: Request) {
  const context = await resolveTenantContext(request);
  const brand = await getReportBrand(context);
  return NextResponse.json({ data: brand });
}

export async function PUT(request: Request) {
  const context = await resolveTenantContext(request);
  const body = (await request.json().catch(() => ({}))) as Partial<ReportBrand> & { primaryColor?: string };

  const patch: Partial<ReportBrand> = {};
  if (typeof body.companyName === "string") patch.companyName = body.companyName.trim().slice(0, 80);
  if (typeof body.reportTypeLabelDefault === "string") patch.reportTypeLabelDefault = body.reportTypeLabelDefault.trim().slice(0, 80);
  if (typeof body.footerText === "string") patch.footerText = body.footerText.trim().slice(0, 120);
  if (typeof body.font === "string" && body.font.trim()) patch.font = body.font.trim().slice(0, 60);
  if (typeof body.primaryColor === "string" && HEX.test(body.primaryColor)) {
    const primary = body.primaryColor.replace(/^#/, "").toLowerCase();
    patch.primaryColor = primary;
    patch.colors = deriveBrandColors(primary);
  }
  if (typeof body.logoDataUrl === "string") {
    if (body.logoDataUrl === "") {
      patch.logoDataUrl = ""; // explicit clear → falls back to default logo at render
    } else if (/^data:image\/(png|jpe?g);base64,/.test(body.logoDataUrl)) {
      if (body.logoDataUrl.length > MAX_LOGO_CHARS) {
        return NextResponse.json({ error: "Logo is too large — use a PNG under ~300 KB." }, { status: 400 });
      }
      patch.logoDataUrl = body.logoDataUrl;
    }
  }

  try {
    const saved = await saveReportBrand(context, patch);
    return NextResponse.json({ data: saved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't save the brand" },
      { status: 500 },
    );
  }
}
