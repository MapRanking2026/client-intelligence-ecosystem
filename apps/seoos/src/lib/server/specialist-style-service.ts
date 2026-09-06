import { SpecialistStyleV1 } from "@/src/lib/domain/specialist-style";
import { nowIso } from "@/src/lib/ids";
import { getSpecialistStyleRepo } from "@/src/lib/server/repositories/specialist-style-repo";

export async function getStyle(tenantId: string, specialistId: string): Promise<SpecialistStyleV1 | null> {
  return getSpecialistStyleRepo().get(tenantId, specialistId);
}

export async function upsertStyle(
  tenantId: string,
  specialistId: string,
  patch: { summary?: string; rules?: SpecialistStyleV1["rules"] },
): Promise<SpecialistStyleV1> {
  const repo = getSpecialistStyleRepo();
  const existing = await repo.get(tenantId, specialistId);
  const now = nowIso();
  return repo.save(
    SpecialistStyleV1.parse({
      schemaVersion: 1,
      tenantId,
      specialistId,
      summary: patch.summary ?? existing?.summary ?? "",
      rules: patch.rules ?? existing?.rules ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }),
  );
}

/** Record a rule learned from a specialist's correction so the AI never repeats it. */
export async function addCorrectionRule(
  tenantId: string,
  specialistId: string,
  text: string,
): Promise<void> {
  const repo = getSpecialistStyleRepo();
  const existing = await repo.get(tenantId, specialistId);
  const now = nowIso();
  const rule = { text: text.trim(), source: "correction" as const, at: now };
  await repo.save(
    SpecialistStyleV1.parse({
      schemaVersion: 1,
      tenantId,
      specialistId,
      summary: existing?.summary ?? "",
      rules: [...(existing?.rules ?? []), rule].slice(-60),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }),
  );
}

/**
 * The style block appended to EVERY AI call for an account, so the draft matches
 * the account's specialist. Falls back to a neutral learning directive when the
 * specialist has no profile yet (e.g. a brand-new specialist).
 */
export async function buildStyleDirective(
  tenantId: string,
  specialistId: string | undefined,
  specialistName?: string,
): Promise<string> {
  const who = specialistName ? ` (${specialistName})` : "";
  if (!specialistId) {
    return "STYLE: No specialist is assigned to this account yet — write cleanly and neutrally.";
  }
  const style = await getSpecialistStyleRepo().get(tenantId, specialistId);
  if (!style || (!style.summary && style.rules.length === 0)) {
    return [
      `STYLE: You are drafting for the specialist${who}. No learned profile exists yet —`,
      "write cleanly and professionally, and pay close attention to their corrections so you learn their style.",
    ].join(" ");
  }
  const rules = style.rules.map((r) => `- ${r.text}`).join("\n");
  return [
    `STYLE — match this specialist${who} exactly (tone, grammar, structure, techniques). Do not deviate.`,
    style.summary ? `\nHow they work: ${style.summary}` : "",
    rules ? `\nRules learned from their work and corrections:\n${rules}` : "",
  ]
    .filter(Boolean)
    .join("");
}
