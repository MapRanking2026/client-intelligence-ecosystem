import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import {
  addManualLeads,
  applyLeadVerdicts,
  getStoredLeadVerification,
  runLeadVerification,
} from "@/src/lib/server/services/lead-verification-service";

const statusEnum = z.enum(["valid", "flagged", "needs_review"]);
const categoryEnum = z.enum([
  "valid_new_lead",
  "spam",
  "duplicate",
  "existing_customer",
  "wrong_number",
  "sales_solicitation",
  "out_of_area",
  "incomplete",
]);
const channelEnum = z.enum([
  "google_ads",
  "organic_website",
  "meta_ads",
  "gbp_call",
  "direct",
  "referral",
  "unknown",
]);

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify") }),
  z.object({ action: z.literal("refresh") }),
  z.object({
    action: z.literal("set_verdict"),
    verdicts: z.record(
      z.string(),
      z.object({ status: statusEnum.optional(), category: categoryEnum.optional() }),
    ),
  }),
  z.object({
    action: z.literal("add_manual_leads"),
    leads: z
      .array(
        z.object({
          name: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
          receivedAt: z.string().optional(),
          source: z.string().optional(),
          channel: channelEnum.optional(),
          type: z.enum(["call", "form", "chat", "manual"]).optional(),
          status: statusEnum.optional(),
          category: categoryEnum.optional(),
          notes: z.string().optional(),
        }),
      )
      .min(1),
  }),
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;
  const review = await getStoredLeadVerification(context, clientId);
  return NextResponse.json({ context, data: review });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;

  try {
    const payload = requestSchema.parse(await request.json());

    let review;
    switch (payload.action) {
      case "verify":
        review = await runLeadVerification(context, clientId);
        break;
      case "refresh":
        review = await runLeadVerification(context, clientId, { forceRefresh: true });
        break;
      case "set_verdict":
        review = await applyLeadVerdicts(context, clientId, payload.verdicts);
        break;
      case "add_manual_leads":
        review = await addManualLeads(context, clientId, payload.leads);
        break;
    }

    return NextResponse.json({ context, data: review });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lead verification action failed" },
      { status: 400 },
    );
  }
}
