import {
  ClientFieldConflictV1,
  ClientReconciliationReportV1,
  ClientV1,
  FieldProvenanceV1,
  NormalizedClientInput,
} from "@cie/contracts";

/** Fields we merge + track provenance/conflicts for (scalar string fields). */
const SCALAR_FIELDS = [
  "businessName",
  "website",
  "phone",
  "niche",
  "status",
  "packageName",
  "accountManager",
  "seoSpecialist",
  "pod",
  "healthScore",
] as const;
type ScalarField = (typeof SCALAR_FIELDS)[number];

/** Normalize a business name into a stable join key across sources. */
export function clientKey(businessName: string): string {
  return businessName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

/** Map a source label ("clickup:seo-dashboard") to the field-authority enum. */
function sourceSystem(source: string): FieldProvenanceV1["source"] {
  if (source.startsWith("clickup")) return "clickup";
  if (source.startsWith("mtos")) return "mtos";
  if (source.startsWith("seoos")) return "seoos";
  return "cie";
}

export interface ReconcileOptions {
  tenantId: string;
  /** ISO timestamp for the pass (injected — the contract layer stays date-lib-free). */
  now: string;
}

export interface ReconcileResult {
  clients: ClientV1[];
  report: ClientReconciliationReportV1;
}

/**
 * Merge many normalized source records into canonical clients, keyed by a
 * normalized business name so the same client from different sources collapses
 * into one record. First non-empty value wins per field; every disagreement is
 * recorded as a conflict rather than silently overwritten. Pure + deterministic.
 */
export function reconcileClients(
  inputs: NormalizedClientInput[],
  opts: ReconcileOptions,
): ReconcileResult {
  const groups = new Map<string, NormalizedClientInput[]>();
  for (const raw of inputs) {
    const input = NormalizedClientInput.parse(raw);
    const key = clientKey(input.businessName);
    const arr = groups.get(key) ?? [];
    arr.push(input);
    groups.set(key, arr);
  }

  const clients: ClientV1[] = [];
  const conflicts: ClientFieldConflictV1[] = [];
  let matchedAcrossSources = 0;
  let singleSource = 0;

  // Stable order so runs are reproducible.
  const keys = [...groups.keys()].sort();
  for (const key of keys) {
    const records = groups.get(key)!;
    const primaryName = records[0].businessName;
    const distinctSources = new Set(records.map((r) => r.source));
    if (distinctSources.size > 1) matchedAcrossSources += 1;
    else singleSource += 1;

    const externalIds: Record<string, string> = {};
    const metrics: Record<string, string> = {};
    const provenance: Record<string, FieldProvenanceV1> = {};
    const scalars: Partial<Record<ScalarField, string>> = {};
    const locations = new Set<string>();

    for (const rec of records) {
      const system = sourceSystem(rec.source);
      // Scalars: first non-empty wins; a differing non-empty value is a conflict.
      for (const field of SCALAR_FIELDS) {
        const value = (rec[field] ?? "").toString().trim();
        if (!value) continue;
        const current = scalars[field];
        if (current === undefined) {
          scalars[field] = value;
          provenance[field] = { source: system, updatedAt: opts.now };
        } else if (current !== value && field !== "businessName") {
          // businessName is the join key we already reconciled on — punctuation
          // differences there are expected, not a conflict worth surfacing.
          const existing = conflicts.find((c) => c.clientId === key && c.field === field);
          if (existing) {
            if (!existing.values.some((v) => v.source === rec.source && v.value === value)) {
              existing.values.push({ source: rec.source, value });
            }
          } else {
            // Seed with the already-chosen value + this differing one.
            const firstSource = records.find(
              (r) => (r[field] ?? "").toString().trim() === current,
            )?.source;
            conflicts.push({
              clientId: key,
              businessName: primaryName,
              field,
              values: [
                { source: firstSource ?? "?", value: current },
                { source: rec.source, value },
              ],
            });
          }
        }
      }
      for (const loc of rec.locations ?? []) if (loc.trim()) locations.add(loc.trim());
      for (const [k, v] of Object.entries(rec.externalIds ?? {})) if (v) externalIds[k] = v;
      for (const [k, v] of Object.entries(rec.metrics ?? {})) if (v && !(k in metrics)) metrics[k] = v;
      // Always keep each source's own record id, keyed by source label.
      externalIds[`${rec.source}:id`] = rec.sourceRecordId;
    }

    const stage = records.find((r) => r.stage)?.stage ?? "unknown";

    clients.push(
      ClientV1.parse({
        schemaVersion: 1,
        id: key,
        tenantId: opts.tenantId,
        businessName: scalars.businessName ?? primaryName,
        website: scalars.website,
        phone: scalars.phone,
        niche: scalars.niche,
        locations: [...locations],
        stage,
        status: scalars.status,
        packageName: scalars.packageName,
        accountManager: scalars.accountManager,
        seoSpecialist: scalars.seoSpecialist,
        pod: scalars.pod,
        healthScore: scalars.healthScore,
        externalIds,
        metrics,
        sources: [...distinctSources].sort(),
        provenance,
        createdAt: opts.now,
        updatedAt: opts.now,
      }),
    );
  }

  const sourceCounts = new Map<string, number>();
  for (const i of inputs) sourceCounts.set(i.source, (sourceCounts.get(i.source) ?? 0) + 1);

  const report = ClientReconciliationReportV1.parse({
    schemaVersion: 1,
    tenantId: opts.tenantId,
    generatedAt: opts.now,
    sourcesIngested: [...sourceCounts.entries()]
      .sort()
      .map(([source, records]) => ({ source, records })),
    totalInputs: inputs.length,
    canonicalClients: clients.length,
    merged: inputs.length - clients.length,
    matchedAcrossSources,
    singleSource,
    conflicts,
  });

  return { clients, report };
}
