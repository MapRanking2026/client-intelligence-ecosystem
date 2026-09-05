import { z } from "zod";
import {
  ReportingPeriodV1,
  SeoCapabilityId,
  SeoIntelligencePackageV1,
  SeoIntelligenceRequestV1,
  zClientId,
} from "@cie/contracts";
import { makeSeoRequestIdempotencyKey } from "@cie/core";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";

/**
 * MTOS-side SEO Intelligence requests. MTOS "orders from the menu" by writing a
 * versioned request to the SHARED tenant-scoped request store using the shared
 * contract; SEOOS reads it from its Request Inbox and fulfills it. Submission is
 * idempotency-keyed so duplicate Monthly-Touch prep never double-orders.
 *
 * Requires Firestore (the shared transport). Without it, calls degrade to empty
 * results — MTOS's existing prep path is unaffected.
 */
export const CreateMtosSeoRequestInput = z.object({
  clientId: zClientId,
  capability: SeoCapabilityId.default("full-monthly-package"),
  reportingPeriod: ReportingPeriodV1,
  monthlyTouchId: z.string().trim().min(1).optional(),
  customQuestions: z.array(z.string().min(1)).default([]),
  intendedAudience: z
    .enum(["internal", "account_manager", "client_ready"])
    .default("account_manager"),
  priority: z.enum(["normal", "high", "urgent"]).default("normal"),
});
export type CreateMtosSeoRequestInput = z.infer<typeof CreateMtosSeoRequestInput>;

type Request = z.infer<typeof SeoIntelligenceRequestV1>;
type Package = z.infer<typeof SeoIntelligencePackageV1>;

function requestsCol(tenantId: string) {
  const db = getFirebaseAdminDb();
  return db ? db.collection("tenants").doc(tenantId).collection("seoRequests") : null;
}

function nowIso() {
  return new Date().toISOString();
}

export interface CreateResult {
  request: Request;
  deduped: boolean;
  persisted: boolean;
}

export async function createMtosSeoRequest(
  context: TenantContext,
  input: CreateMtosSeoRequestInput,
): Promise<CreateResult> {
  const parsed = CreateMtosSeoRequestInput.parse(input);
  const idempotencyKey = makeSeoRequestIdempotencyKey({
    tenantId: context.tenantId,
    clientId: parsed.clientId,
    monthlyTouchId: parsed.monthlyTouchId,
    capability: parsed.capability,
    presetVersion: 1,
    reportingPeriod: parsed.reportingPeriod,
  });

  const col = requestsCol(context.tenantId);
  const now = nowIso();
  const request = SeoIntelligenceRequestV1.parse({
    schemaVersion: 1,
    id: `req_${idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200)}`,
    tenantId: context.tenantId,
    clientId: parsed.clientId,
    monthlyTouchId: parsed.monthlyTouchId,
    capability: parsed.capability,
    presetVersion: 1,
    reportingPeriod: parsed.reportingPeriod,
    lineItems: [],
    customQuestions: parsed.customQuestions,
    intendedAudience: parsed.intendedAudience,
    priority: parsed.priority,
    params: {},
    idempotencyKey,
    correlationId: `corr_${idempotencyKey.slice(0, 40)}`,
    status: "submitted",
    requestedByApp: "mtos",
    requestedByUserId: context.userId,
    createdAt: now,
    updatedAt: now,
  });

  if (!col) return { request, deduped: false, persisted: false };

  // Idempotent: request id is derived from the idempotency key, so a duplicate
  // submission resolves to the same document.
  const ref = col.doc(request.id);
  const existing = await ref.get();
  if (existing.exists) {
    const prev = SeoIntelligenceRequestV1.safeParse(existing.data());
    return { request: prev.success ? prev.data : request, deduped: true, persisted: true };
  }
  await ref.set(request);
  return { request, deduped: false, persisted: true };
}

export async function listMtosSeoRequests(
  context: TenantContext,
  clientId?: string,
): Promise<Request[]> {
  const col = requestsCol(context.tenantId);
  if (!col) return [];
  const snap = clientId
    ? await col.where("clientId", "==", clientId).get()
    : await col.get();
  return snap.docs
    .map((d) => SeoIntelligenceRequestV1.safeParse(d.data()))
    .filter((r) => r.success)
    .map((r) => r.data)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Latest immutable package for a request, read from the shared store. */
export async function getMtosReceivedPackage(
  context: TenantContext,
  requestId: string,
): Promise<Package | null> {
  const db = getFirebaseAdminDb();
  if (!db) return null;
  const snap = await db
    .collection("tenants")
    .doc(context.tenantId)
    .collection("seoPackages")
    .where("requestId", "==", requestId)
    .get();
  const packages = snap.docs
    .map((d) => SeoIntelligencePackageV1.safeParse(d.data()))
    .filter((r) => r.success)
    .map((r) => r.data)
    .sort((a, b) => a.version - b.version);
  return packages.length ? packages[packages.length - 1] : null;
}
