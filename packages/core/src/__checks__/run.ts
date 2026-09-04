/**
 * Lightweight runtime checks (no test framework). Run with: npm test -w @cie/core
 * Proves the canonical Lead & Call ordering and idempotency determinism.
 */
import { strict as assert } from "node:assert";
import type { LeadCallRecordV1, SeoRequestIdentityV1 } from "@cie/contracts";
import {
  canAccessClient,
  computePermissions,
  getCapability,
  hasPermission,
  makeSeoRequestIdempotencyKey,
  sortDirectionFromAlias,
  sortLeadCallRecords,
} from "../index";

function rec(id: string, occurredAt: string | null): LeadCallRecordV1 {
  return {
    schemaVersion: 1,
    id,
    tenantId: "t1",
    clientId: "c1",
    channel: "call",
    occurredAt,
    receivedAt: "2026-01-01T00:00:00.000Z",
    verificationStatus: "unverified",
    sourceProvider: "gohighlevel",
    recordingRef: null,
    contact: {},
    audit: [],
  };
}

// --- Lead & Call sorting ---------------------------------------------------
const t1 = "2026-01-01T09:00:00.000Z";
const t2 = "2026-01-02T09:00:00.000Z";
const t3 = "2026-01-03T09:00:00.000Z";

const records: LeadCallRecordV1[] = [
  rec("b", t2),
  rec("a", t2), // same time as "b" → id tie-break
  rec("z", t3),
  rec("m", null), // missing time → always last
  rec("q", t1),
  rec("bad", "not-a-date"), // invalid → treated as missing
];

// Within equal/missing times the secondary sort is canonical id ASC ("bad" < "m").
const newest = sortLeadCallRecords(records, "newest_first").map((r) => r.id);
assert.deepEqual(
  newest,
  ["z", "a", "b", "q", "bad", "m"],
  `newest_first order wrong: ${newest.join(",")}`,
);

const oldest = sortLeadCallRecords(records, "oldest_first").map((r) => r.id);
assert.deepEqual(
  oldest,
  ["q", "a", "b", "z", "bad", "m"],
  `oldest_first order wrong: ${oldest.join(",")}`,
);

// Missing/invalid always sink to the bottom in BOTH directions.
assert.deepEqual(newest.slice(-2).sort(), ["bad", "m"]);
assert.deepEqual(oldest.slice(-2).sort(), ["bad", "m"]);

// Input is not mutated.
assert.equal(records[0].id, "b");

// --- Idempotency determinism ----------------------------------------------
const identity: SeoRequestIdentityV1 = {
  tenantId: "Tenant A",
  clientId: "Client-1",
  monthlyTouchId: undefined,
  capability: "full-monthly-package",
  presetVersion: 4,
  reportingPeriod: {
    start: "2026-08-01T00:00:00.000Z",
    end: "2026-09-01T00:00:00.000Z",
  },
};
const k1 = makeSeoRequestIdempotencyKey(identity);
const k2 = makeSeoRequestIdempotencyKey({ ...identity });
assert.equal(k1, k2, "idempotency key not deterministic");
assert.ok(k1.includes(":none:"), "missing monthlyTouch should collapse to none");
assert.ok(k1.startsWith("seo-req:tenant-a:client-1:"), `key shape: ${k1}`);

// --- Permissions -----------------------------------------------------------
const specialist = computePermissions(["seo_specialist"]);
assert.ok(hasPermission(specialist, "seo.request.fulfill"), "specialist can fulfill");
assert.ok(hasPermission(specialist, "lead_call.verify"), "specialist can verify leads");
assert.ok(!hasPermission(specialist, "settings.manage"), "specialist cannot manage settings");

const admin = computePermissions(["tenant_admin"]);
assert.ok(hasPermission(admin, "settings.manage"), "admin manages settings");
assert.ok(hasPermission(admin, "seo.package.deliver"), "admin delivers packages");

const qa = computePermissions(["seo_qa"]);
assert.ok(hasPermission(qa, "seo.package.qa"), "qa can qa");
assert.ok(!hasPermission(qa, "seo.request.fulfill"), "qa cannot fulfill");

// Extra grants union with role permissions.
const withExtra = computePermissions(["seo_qa"], ["integrations.manage"]);
assert.ok(hasPermission(withExtra, "integrations.manage"), "extra grant applies");

// Client visibility.
assert.ok(canAccessClient("all", "client-x"), "all sees any client");
assert.ok(canAccessClient(["client-a", "client-b"], "client-b"), "listed client visible");
assert.ok(!canAccessClient(["client-a"], "client-z"), "unlisted client hidden");

// --- Capability catalog ----------------------------------------------------
assert.ok(getCapability("full-monthly-package"), "full-monthly-package exists");
assert.equal(getCapability("website-technical-audit")?.requiredApproval, true, "audit needs approval");
assert.equal(getCapability("keyword-ranking-summary")?.requiresNewScan, false, "kw summary is cacheable");

// --- Sort alias mapping ----------------------------------------------------
assert.equal(sortDirectionFromAlias("desc"), "newest_first");
assert.equal(sortDirectionFromAlias("asc"), "oldest_first");

console.log("OK — @cie/core checks passed");
