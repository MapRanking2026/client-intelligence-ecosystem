import type { NormalizedClientInput } from "@cie/contracts";

import { clientKey, reconcileClients } from "../reconcile";

/** Minimal, dependency-free checks for the reconcile engine. Run: npm test -w @cie/brain */
let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error("✗", msg);
  } else {
    console.log("✓", msg);
  }
}

const now = "2026-09-07T00:00:00.000Z";
const inputs: NormalizedClientInput[] = [
  {
    source: "clickup:seo-dashboard",
    sourceRecordId: "task-1",
    businessName: "Ma Williams Manufactured Homes, Inc.",
    website: "https://mawilliams.com",
    seoSpecialist: "Iris Alfonso",
    locations: [],
    externalIds: {},
    metrics: {},
  },
  {
    // Same client, different source + a website disagreement → one canonical, one conflict.
    source: "clickup:health-tracker",
    sourceRecordId: "task-9",
    businessName: "Ma Williams Manufactured Homes  Inc",
    website: "http://www.mawilliams.com",
    accountManager: "Francisco Quintero",
    locations: [],
    externalIds: {},
    metrics: {},
  },
  {
    source: "clickup:seo-dashboard",
    sourceRecordId: "task-2",
    businessName: "Fixio",
    seoSpecialist: "Angel Gonzalez",
    locations: [],
    externalIds: {},
    metrics: {},
  },
];

const { clients, report } = reconcileClients(inputs, { tenantId: "map-ranking", now });

assert(clients.length === 2, `3 inputs collapse to 2 canonical clients (got ${clients.length})`);
assert(report.merged === 1, `1 record merged as a duplicate (got ${report.merged})`);
assert(report.matchedAcrossSources === 1, `1 client matched across sources (got ${report.matchedAcrossSources})`);
assert(report.singleSource === 1, `1 client single-source (got ${report.singleSource})`);
assert(report.conflicts.length === 1 && report.conflicts[0].field === "website", "website conflict surfaced, not overwritten");

const ma = clients.find((c) => c.id === clientKey("Ma Williams Manufactured Homes, Inc."));
assert(!!ma, "canonical id is a stable name slug");
assert(ma?.seoSpecialist === "Iris Alfonso" && ma?.accountManager === "Francisco Quintero", "fields merged across the two sources");
assert(
  ma?.externalIds["clickup:seo-dashboard:id"] === "task-1" &&
    ma?.externalIds["clickup:health-tracker:id"] === "task-9",
  "each source's record id kept in externalIds",
);
assert((ma?.sources.length ?? 0) === 2, "both sources recorded on the client");

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll brain reconcile checks passed.");
