import {
  AppMembershipV1,
  LeadCallRecordV1,
  SeoIntelligencePackageV1,
  SeoIntelligenceRequestV1,
} from "@cie/contracts";
import { SeoProjectV1 } from "@/src/lib/domain/project";
import { getServerEnv } from "@/src/lib/server/env";

/**
 * Seed store — module-level, in-memory. Powers seed/dev mode (MTOS_USE_SEED_DATA
 * convention) so the full application is exercisable without live credentials.
 * NEVER used when Firebase Admin config is present (repos switch to Firestore).
 * All records are validated against the real schemas so seed can't drift.
 */
const TENANT = getServerEnv().pilotTenantId;
const T0 = "2026-08-01T00:00:00.000Z";

function iso(day: number, hour = 9): string {
  const d = String(day).padStart(2, "0");
  const h = String(hour).padStart(2, "0");
  return `2026-08-${d}T${h}:00:00.000Z`;
}

interface SeedStore {
  memberships: AppMembershipV1[];
  projects: SeoProjectV1[];
  requests: SeoIntelligenceRequestV1[];
  packages: SeoIntelligencePackageV1[];
  leadCalls: LeadCallRecordV1[];
}

function buildSeed(): SeedStore {
  const memberships: AppMembershipV1[] = [
    AppMembershipV1.parse({
      schemaVersion: 1,
      tenantId: TENANT,
      userId: "seed-admin",
      app: "seoos",
      roles: ["tenant_admin"],
      clientVisibility: "all",
      extraPermissions: [],
      createdAt: T0,
      updatedAt: T0,
    }),
    AppMembershipV1.parse({
      schemaVersion: 1,
      tenantId: TENANT,
      userId: "seed-specialist",
      app: "seoos",
      roles: ["seo_specialist"],
      clientVisibility: ["client-acme"],
      extraPermissions: [],
      createdAt: T0,
      updatedAt: T0,
    }),
  ];

  const projects: SeoProjectV1[] = [
    SeoProjectV1.parse({
      schemaVersion: 1,
      id: "proj-acme",
      tenantId: TENANT,
      clientId: "client-acme",
      businessName: "Acme Plumbing Co.",
      website: "https://acmeplumbing.example",
      stage: "active",
      health: "healthy",
      assignments: { seoSpecialistUserId: "seed-specialist", accountManagerUserId: "seed-am" },
      serviceTier: "Map Pack Dominator",
      priority: "high",
      targetLocations: ["Austin, TX", "Round Rock, TX"],
      goals: ["Grow map-pack coverage", "Rank top-3 for emergency plumbing"],
      startDate: T0,
      setupReadiness: 90,
      nextDeadlineAt: iso(28),
      createdAt: T0,
      updatedAt: iso(20),
    }),
    SeoProjectV1.parse({
      schemaVersion: 1,
      id: "proj-brightsmile",
      tenantId: TENANT,
      clientId: "client-brightsmile",
      businessName: "BrightSmile Dental",
      website: "https://brightsmile.example",
      stage: "intake",
      health: "watch",
      assignments: { accountManagerUserId: "seed-am" },
      serviceTier: "GBP+",
      priority: "normal",
      targetLocations: ["Dallas, TX"],
      goals: ["Complete onboarding", "Baseline grid scan"],
      setupReadiness: 35,
      createdAt: iso(10),
      updatedAt: iso(15),
    }),
  ];

  const requests: SeoIntelligenceRequestV1[] = [
    SeoIntelligenceRequestV1.parse({
      schemaVersion: 1,
      id: "req-acme-monthly",
      tenantId: TENANT,
      clientId: "client-acme",
      capability: "full-monthly-package",
      presetVersion: 1,
      reportingPeriod: { start: T0, end: "2026-09-01T00:00:00.000Z", timezone: "America/Chicago" },
      lineItems: [],
      customQuestions: ["Which keywords drove the most map-pack movement?"],
      intendedAudience: "account_manager",
      priority: "high",
      params: {},
      idempotencyKey: "seed:req-acme-monthly",
      correlationId: "seed-corr-1",
      status: "ready",
      requestedByApp: "mtos",
      requestedByUserId: "seed-am",
      createdAt: iso(25),
      updatedAt: iso(26),
    }),
    SeoIntelligenceRequestV1.parse({
      schemaVersion: 1,
      id: "req-brightsmile-kw",
      tenantId: TENANT,
      clientId: "client-brightsmile",
      capability: "keyword-ranking-summary",
      presetVersion: 1,
      reportingPeriod: { start: T0, end: "2026-09-01T00:00:00.000Z" },
      lineItems: [],
      customQuestions: [],
      intendedAudience: "internal",
      priority: "normal",
      params: {},
      idempotencyKey: "seed:req-brightsmile-kw",
      correlationId: "seed-corr-2",
      status: "submitted",
      requestedByApp: "seoos",
      requestedByUserId: "seed-specialist",
      createdAt: iso(27),
      updatedAt: iso(27),
    }),
  ];

  const packages: SeoIntelligencePackageV1[] = [
    SeoIntelligencePackageV1.parse({
      schemaVersion: 1,
      id: "pkg-acme-1",
      requestId: "req-acme-monthly",
      tenantId: TENANT,
      clientId: "client-acme",
      capability: "full-monthly-package",
      version: 1,
      supersedesVersion: null,
      reportingPeriod: { start: T0, end: "2026-09-01T00:00:00.000Z", timezone: "America/Chicago" },
      sections: [
        {
          key: "ranking-summary",
          title: "Keyword Ranking Summary",
          kind: "ranking",
          data: { averagePosition: 6, positionChange: -2, trackedKeywords: 42 },
          evidence: [
            {
              schemaVersion: 1,
              id: "ev-rank-1",
              sourceProvider: "rank-tracker",
              capability: "full-monthly-package",
              freshness: "cached",
              confidence: "medium",
              redactionLevel: "aggregate",
              lineage: [{ source: "rank-tracker", detail: "August rollup" }],
            },
          ],
          confidence: "medium",
        },
      ],
      dataGaps: [],
      overallConfidence: "medium",
      correlationId: "seed-corr-1",
      idempotencyKey: "seed:req-acme-monthly#pkg-v1",
      producedAt: iso(26),
    }),
  ];

  const leadCalls: LeadCallRecordV1[] = [
    LeadCallRecordV1.parse({
      schemaVersion: 1,
      id: "lc-1",
      tenantId: TENANT,
      clientId: "client-acme",
      channel: "call",
      occurredAt: iso(20, 14),
      receivedAt: iso(20, 14),
      verificationStatus: "verified_good_lead",
      classification: "New customer",
      sourceProvider: "gohighlevel",
      recordingRef: "rec-lc-1",
      contact: { displayName: "J. Rivera", maskedPhone: "(512) •••-4821" },
      audit: [],
    }),
    LeadCallRecordV1.parse({
      schemaVersion: 1,
      id: "lc-2",
      tenantId: TENANT,
      clientId: "client-acme",
      channel: "form",
      occurredAt: iso(22, 10),
      receivedAt: iso(22, 10),
      verificationStatus: "needs_review",
      sourceProvider: "gohighlevel",
      recordingRef: null,
      contact: { displayName: "Web form lead" },
      audit: [],
    }),
    LeadCallRecordV1.parse({
      schemaVersion: 1,
      id: "lc-3",
      tenantId: TENANT,
      clientId: "client-acme",
      channel: "call",
      occurredAt: null,
      receivedAt: iso(18, 9),
      verificationStatus: "unverified",
      sourceProvider: "gohighlevel",
      recordingRef: "rec-lc-3",
      contact: { displayName: "Unknown caller" },
      audit: [],
    }),
  ];

  return { memberships, projects, requests, packages, leadCalls };
}

/** Singleton so writes within a server process persist across requests. */
export const seedStore: SeedStore = buildSeed();
