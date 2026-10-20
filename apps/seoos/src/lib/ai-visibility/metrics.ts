import type { AivObservationV1, MeasurementChannel, PromptGroup, ProviderId } from "./types";
import { effectiveEntities, validity, type Validity } from "./effective";

/**
 * Visibility metrics. Every rate keeps its numerator, denominator and the ids of
 * the observations behind it so the UI can link each number to evidence.
 * Formulas are published in METRIC_DEFINITIONS (rendered in the UI and docs).
 */

export interface Rate {
  num: number;
  den: number;
  /** null when the denominator is 0 (never shown as 0%). */
  value: number | null;
  /** Wilson 95% interval, null when den = 0. */
  ci: [number, number] | null;
  obsIds: string[];
}

export function wilson(num: number, den: number, z = 1.96): [number, number] | null {
  if (den <= 0) return null;
  const p = num / den;
  const z2 = z * z;
  const center = (p + z2 / (2 * den)) / (1 + z2 / den);
  const half = (z * Math.sqrt((p * (1 - p)) / den + z2 / (4 * den * den))) / (1 + z2 / den);
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function rate(numIds: string[], den: number): Rate {
  return { num: numIds.length, den, value: den > 0 ? numIds.length / den : null, ci: wilson(numIds.length, den), obsIds: numIds };
}

export interface MetricFilter {
  channel: MeasurementChannel;
  /** Branded and unbranded are never mixed. */
  branded: boolean;
  providerId?: ProviderId;
  model?: string;
  serviceId?: string;
  locationId?: string;
  promptId?: string;
  promptGroup?: PromptGroup;
  scanId?: string;
  from?: string;
  to?: string;
}

export function applyFilter(obs: AivObservationV1[], f: MetricFilter): AivObservationV1[] {
  return obs.filter(
    (o) =>
      !o.isFixture &&
      o.channel === f.channel &&
      o.branded === f.branded &&
      (!f.providerId || o.providerId === f.providerId) &&
      (!f.model || o.model === f.model) &&
      (!f.serviceId || o.serviceId === f.serviceId) &&
      (!f.locationId || o.locationId === f.locationId) &&
      (!f.promptId || o.promptId === f.promptId) &&
      (!f.promptGroup || o.promptGroup === f.promptGroup) &&
      (!f.scanId || o.scanId === f.scanId) &&
      (!f.from || o.collectedAt >= f.from) &&
      (!f.to || o.collectedAt <= f.to),
  );
}

export interface ShareRow {
  entityKey: string;
  name: string;
  kind: "client" | "competitor" | "discovered";
  answers: number;
  recommendedAnswers: number;
  share: number;
  obsIds: string[];
}

export interface CoverageRow {
  key: string;
  attempted: number;
  collected: number;
  valid: number;
  mentioned: number;
  recommended: number;
}

export interface MetricsResult {
  sample: Record<Validity | "total", number>;
  excludedIds: Record<Exclude<Validity, "valid">, string[]>;
  mentionRate: Rate;
  recommendationRate: Rate;
  ownedCitationRate: Rate;
  top3: Rate;
  positionDistribution: Array<{ position: number; count: number; obsIds: string[] }>;
  shareOfMentions: ShareRow[];
  collectionSuccessRate: Rate;
  analysisCoverage: Rate;
  coverage: {
    provider: CoverageRow[];
    service: CoverageRow[];
    location: CoverageRow[];
    prompt: CoverageRow[];
  };
  composite: { value: number | null; components: { recommendation: number | null; mention: number | null; ownedCitation: number | null } };
  smallSample: boolean;
}

export const COMPOSITE_WEIGHTS = { recommendation: 0.5, mention: 0.3, ownedCitation: 0.2 } as const;

function coverageBy(obs: AivObservationV1[], keyOf: (o: AivObservationV1) => string | undefined): CoverageRow[] {
  const rows = new Map<string, CoverageRow>();
  for (const o of obs) {
    const key = keyOf(o) ?? "(none)";
    const r = rows.get(key) ?? { key, attempted: 0, collected: 0, valid: 0, mentioned: 0, recommended: 0 };
    r.attempted += 1;
    if (o.collectionStatus === "success") r.collected += 1;
    if (validity(o) === "valid") {
      r.valid += 1;
      const c = effectiveEntities(o).find((e) => e.entityKey === "client");
      if (c?.mentioned) r.mentioned += 1;
      if (c?.recommended) r.recommended += 1;
    }
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.attempted - a.attempted);
}

export function computeMetrics(all: AivObservationV1[], filter: MetricFilter): MetricsResult {
  const obs = applyFilter(all, filter);
  const sample = { total: obs.length, valid: 0, not_collected: 0, refusal: 0, no_answer: 0, not_analyzed: 0 };
  const excludedIds = { not_collected: [] as string[], refusal: [] as string[], no_answer: [] as string[], not_analyzed: [] as string[] };
  const valid: AivObservationV1[] = [];
  for (const o of obs) {
    const v = validity(o);
    sample[v] += 1;
    if (v === "valid") valid.push(o);
    else excludedIds[v].push(o.id);
  }

  const mentioned: string[] = [];
  const recommended: string[] = [];
  const ownedCited: string[] = [];
  const orderedValid: string[] = [];
  const top3: string[] = [];
  const positions = new Map<number, string[]>();
  const share = new Map<string, ShareRow>();

  for (const o of valid) {
    const ents = effectiveEntities(o);
    const c = ents.find((e) => e.entityKey === "client");
    if (c?.mentioned) mentioned.push(o.id);
    if (c?.recommended) recommended.push(o.id);
    if (c?.ownedDomainCited) ownedCited.push(o.id);
    if (o.analysis?.orderedList) {
      orderedValid.push(o.id);
      if (c?.mentioned && c.position !== null && c.position <= 3) top3.push(o.id);
      if (c?.mentioned && c.position !== null) {
        const arr = positions.get(c.position) ?? [];
        arr.push(o.id);
        positions.set(c.position, arr);
      }
    }
    // Share of mentions: each business counted at most once per answer.
    const seen = new Set<string>();
    for (const e of ents) {
      if (!e.mentioned || seen.has(e.entityKey)) continue;
      seen.add(e.entityKey);
      const row = share.get(e.entityKey) ?? { entityKey: e.entityKey, name: e.name, kind: e.kind, answers: 0, recommendedAnswers: 0, share: 0, obsIds: [] };
      row.answers += 1;
      if (e.recommended) row.recommendedAnswers += 1;
      row.obsIds.push(o.id);
      share.set(e.entityKey, row);
    }
  }
  const totalBusinessMentions = [...share.values()].reduce((s, r) => s + r.answers, 0);
  const shareRows = [...share.values()]
    .map((r) => ({ ...r, share: totalBusinessMentions ? r.answers / totalBusinessMentions : 0 }))
    .sort((a, b) => b.answers - a.answers);

  const attempted = obs.filter((o) => o.collectionStatus !== "budget_blocked");
  const succeeded = attempted.filter((o) => o.collectionStatus === "success" || o.collectionStatus === "refusal" || o.collectionStatus === "no_ai_answer");
  const successful = obs.filter((o) => o.collectionStatus === "success");
  const analyzed = successful.filter((o) => o.analysis?.status === "analyzed");

  const mentionRate = rate(mentioned, valid.length);
  const recommendationRate = rate(recommended, valid.length);
  const ownedCitationRate = rate(ownedCited, valid.length);
  const comps = {
    recommendation: recommendationRate.value,
    mention: mentionRate.value,
    ownedCitation: ownedCitationRate.value,
  };
  const composite =
    comps.recommendation === null || comps.mention === null || comps.ownedCitation === null
      ? null
      : 100 *
        (COMPOSITE_WEIGHTS.recommendation * comps.recommendation +
          COMPOSITE_WEIGHTS.mention * comps.mention +
          COMPOSITE_WEIGHTS.ownedCitation * comps.ownedCitation);

  return {
    sample,
    excludedIds,
    mentionRate,
    recommendationRate,
    ownedCitationRate,
    top3: rate(top3, orderedValid.length),
    positionDistribution: [...positions.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([position, ids]) => ({ position, count: ids.length, obsIds: ids })),
    shareOfMentions: shareRows,
    collectionSuccessRate: rate(succeeded.map((o) => o.id), attempted.length),
    analysisCoverage: rate(analyzed.map((o) => o.id), successful.length),
    coverage: {
      provider: coverageBy(obs, (o) => (o.providerId ? `${o.providerId} · ${o.model ?? "?"}` : o.surface)),
      service: coverageBy(obs, (o) => o.serviceId),
      location: coverageBy(obs, (o) => o.locationId),
      prompt: coverageBy(obs, (o) => (o.promptId ? `${o.promptId}@v${o.promptVersion}` : undefined)),
    },
    composite: { value: composite, components: comps },
    smallSample: valid.length < 30,
  };
}

export interface TrendPoint {
  scanId: string;
  at: string;
  fingerprint: string;
  valid: number;
  mentionRate: number | null;
  recommendationRate: number | null;
  ownedCitationRate: number | null;
  comparableToPrevious: boolean | null;
  changeNote?: string;
}

/** One point per scan. Points are flagged when configuration (prompts/models/settings) changed. */
export function computeTrend(
  all: AivObservationV1[],
  filter: Omit<MetricFilter, "scanId">,
  scans: Array<{ id: string; createdAt: string; configFingerprint: string; providerModels: string[] }>,
): TrendPoint[] {
  const sorted = [...scans].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const points: TrendPoint[] = [];
  for (const s of sorted) {
    const m = computeMetrics(all, { ...filter, scanId: s.id });
    if (m.sample.total === 0) continue;
    const prev = points[points.length - 1];
    const prevScan = prev ? sorted.find((x) => x.id === prev.scanId) : undefined;
    let changeNote: string | undefined;
    if (prevScan && prevScan.configFingerprint !== s.configFingerprint) {
      const modelChanged = prevScan.providerModels.join(",") !== s.providerModels.join(",");
      changeNote = modelChanged
        ? `Model/provider changed (${prevScan.providerModels.join(", ")} → ${s.providerModels.join(", ")})`
        : "Prompt set or settings changed";
    }
    points.push({
      scanId: s.id,
      at: s.createdAt,
      fingerprint: s.configFingerprint,
      valid: m.sample.valid,
      mentionRate: m.mentionRate.value,
      recommendationRate: m.recommendationRate.value,
      ownedCitationRate: m.ownedCitationRate.value,
      comparableToPrevious: prev ? prevScan?.configFingerprint === s.configFingerprint : null,
      changeNote,
    });
  }
  return points;
}

export const METRIC_DEFINITIONS: Array<{ key: string; name: string; formula: string; notes: string }> = [
  {
    key: "valid",
    name: "Valid collected answer",
    formula: "collection status = success AND analysis succeeded AND answer is not a refusal or empty",
    notes: "Failures, timeouts, rate limits, refusals, empty answers and unanalyzed answers are excluded and shown separately — never counted as zero visibility.",
  },
  {
    key: "mention",
    name: "Mention rate",
    formula: "valid answers mentioning the client ÷ valid collected answers",
    notes: "A valid answer that does not mention the client counts as 0. Name matches placed in another state are not counted.",
  },
  {
    key: "recommendation",
    name: "Recommendation rate",
    formula: "valid answers affirmatively recommending the client ÷ valid collected answers",
    notes: "Recommended = listed as a provider option or described with a recommending cue, with no negative or hedged qualifier.",
  },
  {
    key: "owned_citation",
    name: "Owned-domain citation rate",
    formula: "valid answers citing an approved client domain ÷ valid collected answers",
    notes: "Uses citations returned by the provider. Citation order is not a ranking.",
  },
  {
    key: "top3",
    name: "Top-three inclusion",
    formula: "answers with an explicitly ordered list placing the client at position 1–3 ÷ valid answers containing an explicitly ordered list",
    notes: "Prose and bulleted answers have no position and are outside this denominator.",
  },
  {
    key: "share",
    name: "Competitor share of mentions",
    formula: "answers mentioning business X (max once per answer) ÷ total business-answer mentions across all businesses",
    notes: "Includes the client, configured competitors and businesses discovered in answers. This is NOT market share.",
  },
  {
    key: "collection",
    name: "Collection success rate",
    formula: "observations that returned a provider answer (incl. refusals/empty) ÷ attempted observations",
    notes: "Slots stopped by a budget cap before any call are excluded from attempted.",
  },
  {
    key: "analysis",
    name: "Analysis coverage",
    formula: "successfully collected answers with a completed analysis ÷ successfully collected answers",
    notes: "Collected-but-unanalyzed answers stay visible in evidence and are excluded from visibility rates.",
  },
  {
    key: "composite",
    name: "Composite visibility score (optional)",
    formula: "100 × (0.5 × recommendation rate + 0.3 × mention rate + 0.2 × owned-domain citation rate)",
    notes: "Shown only with its component rates. Not comparable across different prompt sets, providers or models.",
  },
  {
    key: "uncertainty",
    name: "Uncertainty",
    formula: "Wilson score 95% interval on each rate; samples under 30 valid answers are flagged as small",
    notes: "Answers vary with time, model, search behavior, location support and personalization. Differences between small samples are not statistically meaningful.",
  },
];
