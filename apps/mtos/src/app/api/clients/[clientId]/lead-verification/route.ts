import { NextResponse } from "next/server";
import { z } from "zod";

import { SortDirection } from "@cie/contracts";
import { orderByOccurredAt } from "@cie/core";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import {
  addManualLeads,
  applyLeadVerdicts,
  getStoredLeadVerification,
  runLeadVerification,
} from "@/src/lib/server/services/lead-verification-service";

const statusEnum = z.enum(["valid", "flagged", "needs_review", "missed_call"]);
const categoryEnum = z.enum([
  "valid_new_lead",
  "spam",
  "duplicate",
  "existing_customer",
  "wrong_number",
  "sales_solicitation",
  "out_of_area",
  "incomplete",
  "irrelevant",
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

const windowSchema = z.object({
  preset: z.enum(["last_7_days", "last_30_days", "last_90_days", "this_month", "last_month", "custom"]),
  since: z.string().optional(),
  until: z.string().optional(),
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), window: windowSchema.optional() }),
  z.object({ action: z.literal("refresh"), window: windowSchema.optional() }),
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
  const sort = SortDirection.catch("newest_first").parse(
    new URL(request.url).searchParams.get("sort"),
  );
  const review = await getStoredLeadVerification(context, clientId);
  // Canonical Lead & Call ordering (shared with SEOOS): applied server-side,
  // before the client paginates. VerifiedLead's normalized time is receivedAt;
  // missing/invalid times sort last as "Date unavailable".
  const data =
    review == null
      ? review
      : {
          ...review,
          leads: orderByOccurredAt(review.leads, sort, (lead) => ({
            id: lead.id,
            occurredAt: lead.receivedAt ?? null,
          })),
        };
  return NextResponse.json({ context, data, sort });
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
        review = await runLeadVerification(context, clientId, { window: payload.window });
        break;
      case "refresh":
        review = await runLeadVerification(context, clientId, { forceRefresh: true, window: payload.window });
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
