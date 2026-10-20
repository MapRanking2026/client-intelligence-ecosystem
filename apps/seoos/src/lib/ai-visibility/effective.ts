import type { AivObservationV1, EntityFinding } from "./types";

/**
 * Effective entity findings for an observation: extractor output with manual
 * corrections (audited separately) applied on top. Metrics always use this.
 */
export function effectiveEntities(obs: AivObservationV1): EntityFinding[] {
  const base = obs.analysis?.status === "analyzed" ? obs.analysis.entities : [];
  if (!obs.overrides.length) return base;
  const byKey = new Map(obs.overrides.map((o) => [o.entityKey, o]));
  const out = base.map((e) => {
    const o = byKey.get(e.entityKey);
    if (!o) return e;
    return {
      ...e,
      mentioned: o.mentioned ?? e.mentioned,
      recommended: o.recommended ?? e.recommended,
      sentiment: o.sentiment ?? e.sentiment,
      position: o.position !== undefined ? o.position : e.position,
      confidence: 1,
      notes: [...e.notes, "Manually corrected"],
    };
  });
  // Overrides may add an entity the extractor missed entirely.
  for (const o of obs.overrides) {
    if (out.some((e) => e.entityKey === o.entityKey)) continue;
    out.push({
      entityKey: o.entityKey,
      kind: o.entityKey === "client" ? "client" : o.entityKey.startsWith("discovered:") ? "discovered" : "competitor",
      name: o.entityKey,
      mentioned: o.mentioned ?? false,
      recommended: o.recommended ?? false,
      sentiment: o.sentiment ?? "neutral",
      position: o.position ?? null,
      matchedBy: [],
      spans: [],
      confidence: 1,
      ownedDomainCited: false,
      thirdPartyCitationUrls: [],
      notes: ["Added by manual correction"],
    });
  }
  return out;
}

export function clientFinding(obs: AivObservationV1): EntityFinding | undefined {
  return effectiveEntities(obs).find((e) => e.entityKey === "client");
}

/** A valid collected answer: collected successfully, analyzed, and a real answer (not refusal/empty). */
export type Validity = "valid" | "not_collected" | "refusal" | "no_answer" | "not_analyzed";

export function validity(obs: AivObservationV1): Validity {
  if (obs.collectionStatus === "refusal") return "refusal";
  if (obs.collectionStatus === "no_ai_answer") return "no_answer";
  if (obs.collectionStatus !== "success") return "not_collected";
  if (!obs.analysis || obs.analysis.status !== "analyzed") return "not_analyzed";
  if (obs.analysis.answerClass === "refusal") return "refusal";
  if (obs.analysis.answerClass === "no_answer") return "no_answer";
  return "valid";
}
