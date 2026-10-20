import { nowIso } from "@/src/lib/ids";
import { safeExtract, type ExtractionSubject } from "@/src/lib/ai-visibility/extract";
import { effectiveEntities } from "@/src/lib/ai-visibility/effective";
import { AivObservationV1, EntityOverride, type AivProfileV1 } from "@/src/lib/ai-visibility/types";
import { audit } from "./audit";
import { observations } from "./store";

/**
 * Analysis step (separate from collection). The client identity is used here —
 * after the answer was collected — and never influences what was asked.
 */
export function subjectFromProfile(p: AivProfileV1): ExtractionSubject {
  const approved = <T extends { status: string }>(xs: T[]) => xs.filter((x) => x.status === "approved");
  return {
    client: {
      key: "client",
      kind: "client",
      name: p.businessName,
      aliases: approved(p.aliases).map((a) => a.value),
      domains: approved(p.ownedDomains).map((d) => d.value),
      cities: approved(p.locations).map((l) => ({ city: l.city, region: l.region })),
      neighborhoods: approved(p.locations).flatMap((l) => l.neighborhoods),
    },
    competitors: p.competitors
      .filter((c) => c.status === "approved")
      .map((c) => ({ key: c.id, kind: "competitor" as const, name: c.name, aliases: c.aliases, domains: c.domains })),
  };
}

export function analyze(obs: AivObservationV1, profile: AivProfileV1): AivObservationV1 {
  if (obs.collectionStatus !== "success" && obs.collectionStatus !== "refusal") return obs;
  return { ...obs, analysis: safeExtract(obs.answerText, obs.citations, subjectFromProfile(profile)), updatedAt: nowIso() };
}

/** Re-run the extractor over stored answers (e.g. after aliases/competitors change). Collected data is unchanged. */
export async function reanalyzeProject(profile: AivProfileV1, actor: string): Promise<{ updated: number }> {
  const rows = await observations().listWhere(profile.tenantId, "projectId", profile.projectId);
  let updated = 0;
  for (const o of rows) {
    if (o.isFixture || (o.collectionStatus !== "success" && o.collectionStatus !== "refusal")) continue;
    await observations().set(profile.tenantId, o.id, analyze(o, profile));
    updated += 1;
  }
  await audit(profile.tenantId, actor, "analysis.rerun", { projectId: profile.projectId, detail: { updated } });
  return { updated };
}

/** Manual correction with an audit trail of before/after effective values. */
export async function applyCorrection(
  tenantId: string,
  projectId: string,
  observationId: string,
  override: EntityOverride,
  reason: string,
  actor: string,
): Promise<AivObservationV1> {
  const parsed = EntityOverride.parse(override);
  if (!reason.trim()) throw new Error("A reason is required for manual corrections.");
  const result = await observations().transact(tenantId, observationId, (cur) => {
    if (!cur || cur.projectId !== projectId) throw new Error("Observation not found");
    const before = effectiveEntities(cur).find((e) => e.entityKey === parsed.entityKey) ?? null;
    const others = cur.overrides.filter((o) => o.entityKey !== parsed.entityKey);
    const next = AivObservationV1.parse({ ...cur, overrides: [...others, parsed], updatedAt: nowIso() });
    const after = effectiveEntities(next).find((e) => e.entityKey === parsed.entityKey) ?? null;
    return { next, result: { next, before, after } };
  });
  const pick = (e: typeof result.before) => (e ? { mentioned: e.mentioned, recommended: e.recommended, sentiment: e.sentiment, position: e.position } : null);
  await audit(tenantId, actor, "observation.correct", {
    projectId,
    target: observationId,
    detail: { entityKey: parsed.entityKey, reason: reason.slice(0, 500), before: pick(result.before), after: pick(result.after) },
  });
  return result.next;
}
