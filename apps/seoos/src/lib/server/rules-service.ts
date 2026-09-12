import { RULE_CATALOG, RuleV1, getRuleDef } from "@/src/lib/domain/rule";
import { nowIso } from "@/src/lib/ids";
import { getRuleRepo } from "@/src/lib/server/repositories/rule-repo";

export interface RuleView {
  key: string;
  category: string;
  name: string;
  description: string;
  value: string;
  defaultValue: string;
  unit?: string;
  alternatives?: string[];
  sources?: string[];
  isCustom: boolean;
  updatedAt?: string;
}

/** Full catalog: default rules with any admin override merged in. */
export async function listRuleCatalog(tenantId: string): Promise<RuleView[]> {
  const overrides = new Map((await getRuleRepo().list(tenantId)).map((r) => [r.key, r]));
  return RULE_CATALOG.map((def) => {
    const o = overrides.get(def.key);
    return {
      key: def.key,
      category: def.category,
      name: def.name,
      description: def.description,
      value: o?.value ?? def.defaultValue,
      defaultValue: def.defaultValue,
      unit: def.unit,
      alternatives: def.alternatives,
      sources: def.sources,
      isCustom: Boolean(o),
      updatedAt: o?.updatedAt,
    };
  });
}

/** The value governing an automation right now — override, else catalog default. */
export async function getRuleValue(tenantId: string, key: string): Promise<string | undefined> {
  const o = await getRuleRepo().get(tenantId, key);
  if (o?.value) return o.value;
  return getRuleDef(key)?.defaultValue;
}

/**
 * Render a "governing thresholds" block for an AI action, using the tenant's
 * effective (override-or-default) values. Pass the rule keys relevant to the
 * action; unknown keys are skipped. This is how the Rule Library actually
 * governs AI drafts — the numbers the model must follow come from here, live.
 * Returns "" when no keys resolve (so callers can concatenate unconditionally).
 */
export async function renderRuleGuidance(tenantId: string, keys: string[]): Promise<string> {
  const overrides = new Map((await getRuleRepo().list(tenantId)).map((r) => [r.key, r]));
  const lines: string[] = [];
  for (const key of keys) {
    const def = getRuleDef(key);
    if (!def) continue;
    const value = overrides.get(key)?.value ?? def.defaultValue;
    lines.push(`- ${def.name}: ${value}${def.unit ? ` ${def.unit}` : ""}`);
  }
  if (!lines.length) return "";
  return [
    "GOVERNING THRESHOLDS (these are the current rules — follow these exact values, do not substitute your own):",
    ...lines,
  ].join("\n");
}

/**
 * A rule as a number, for consumers that need one (e.g. a threshold).
 * Parses the leading number out of the value ("5-20" → 5, "700-750" → 700,
 * "9x9" → 9). Falls back to `fallback` when the rule is unknown/unparseable.
 */
export async function getRuleNumber(tenantId: string, key: string, fallback: number): Promise<number> {
  const raw = await getRuleValue(tenantId, key);
  const n = parseLeadingNumber(raw);
  return n ?? fallback;
}

function parseLeadingNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/-?\d+(\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

/** Admin: save an override; takes effect immediately. */
export async function upsertRule(
  tenantId: string,
  key: string,
  value: string,
  userId: string,
): Promise<RuleV1> {
  if (!getRuleDef(key)) throw new Error(`Unknown rule key: ${key}`);
  if (!value.trim()) throw new Error("Rule value cannot be empty.");
  return getRuleRepo().save(
    RuleV1.parse({
      schemaVersion: 1,
      tenantId,
      key,
      value: value.trim(),
      updatedAt: nowIso(),
      updatedByUserId: userId,
    }),
  );
}

/** Admin: drop the override, reverting to the built-in default. */
export async function resetRule(tenantId: string, key: string): Promise<void> {
  await getRuleRepo().remove(tenantId, key);
}
