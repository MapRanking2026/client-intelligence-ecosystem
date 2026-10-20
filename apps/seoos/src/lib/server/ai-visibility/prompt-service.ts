import { newId, nowIso } from "@/src/lib/ids";
import {
  AivPromptV1,
  currentPromptText,
  type AivProfileV1,
  type PromptGroup,
} from "@/src/lib/ai-visibility/types";
import { checkPrompt, generatePromptDrafts, isNearMe, type GenerateOptions } from "@/src/lib/ai-visibility/prompts";
import { normPhrase } from "@/src/lib/ai-visibility/text";
import { audit } from "./audit";
import { prompts } from "./store";

export async function listPrompts(tenantId: string, projectId: string): Promise<AivPromptV1[]> {
  const rows = await prompts().listWhere(tenantId, "projectId", projectId);
  const order: PromptGroup[] = ["unbranded_discovery", "service_intent", "comparison", "bilingual", "branded"];
  return rows.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || (a.createdAt < b.createdAt ? -1 : 1));
}

export class PromptValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(" "));
  }
}

function sameText(a: string, b: string) {
  return normPhrase(a).join(" ") === normPhrase(b).join(" ");
}

export async function generatePrompts(profile: AivProfileV1, opts: GenerateOptions, actor: string) {
  const existing = await listPrompts(profile.tenantId, profile.projectId);
  const drafts = generatePromptDrafts(profile, opts);
  const created: AivPromptV1[] = [];
  const skipped: Array<{ text: string; reason: string }> = [];
  for (const d of drafts) {
    if (existing.some((p) => p.status !== "archived" && sameText(currentPromptText(p), d.text))) {
      skipped.push({ text: d.text, reason: "Already in the library" });
      continue;
    }
    const chk = checkPrompt(d.text, d.group, profile);
    if (!chk.ok) {
      skipped.push({ text: d.text, reason: chk.problems.join(" ") });
      continue;
    }
    const now = nowIso();
    const p = AivPromptV1.parse({
      schemaVersion: 1,
      id: newId("prm"),
      tenantId: profile.tenantId,
      projectId: profile.projectId,
      group: d.group,
      language: d.language,
      serviceId: d.serviceId,
      serviceLabel: d.serviceLabel,
      locationId: d.locationId,
      nearMe: d.nearMe,
      status: "draft",
      currentVersion: 1,
      versions: [{ version: 1, text: d.text, createdAt: now, createdBy: actor, changeNote: `Generated from template ${d.templateKey}` }],
      generatedBy: "template",
      templateKey: d.templateKey,
      createdAt: now,
      updatedAt: now,
    });
    await prompts().set(profile.tenantId, p.id, p);
    created.push(p);
  }
  await audit(profile.tenantId, actor, "prompts.generate", { projectId: profile.projectId, detail: { created: created.length, skipped: skipped.length, groups: opts.groups } });
  return { created, skipped };
}

export async function createPrompt(
  profile: AivProfileV1,
  input: { text: string; group: PromptGroup; serviceId?: string; locationId?: string; language?: string },
  actor: string,
) {
  const chk = checkPrompt(input.text, input.group, profile);
  if (!chk.ok) throw new PromptValidationError(chk.problems);
  const now = nowIso();
  const svc = profile.services.find((s) => s.id === input.serviceId);
  const p = AivPromptV1.parse({
    schemaVersion: 1,
    id: newId("prm"),
    tenantId: profile.tenantId,
    projectId: profile.projectId,
    group: input.group,
    language: input.language || profile.language,
    serviceId: svc?.id,
    serviceLabel: svc?.value,
    locationId: input.locationId,
    nearMe: isNearMe(input.text),
    status: "draft",
    currentVersion: 1,
    versions: [{ version: 1, text: input.text.trim(), createdAt: now, createdBy: actor, changeNote: "Created manually" }],
    generatedBy: "user",
    createdAt: now,
    updatedAt: now,
  });
  await prompts().set(profile.tenantId, p.id, p);
  await audit(profile.tenantId, actor, "prompt.create", { projectId: profile.projectId, target: p.id });
  return p;
}

export async function editPrompt(
  profile: AivProfileV1,
  promptId: string,
  patch: { text?: string; changeNote?: string; status?: "draft" | "approved" | "archived"; locationId?: string; serviceId?: string },
  actor: string,
) {
  const cur = await prompts().get(profile.tenantId, promptId);
  if (!cur || cur.projectId !== profile.projectId) throw new Error("Prompt not found");
  let next: AivPromptV1 = { ...cur, updatedAt: nowIso() };
  if (patch.text !== undefined && patch.text.trim() !== currentPromptText(cur)) {
    const chk = checkPrompt(patch.text, cur.group, profile);
    if (!chk.ok) throw new PromptValidationError(chk.problems);
    const version = Math.max(...cur.versions.map((v) => v.version)) + 1;
    next = {
      ...next,
      currentVersion: version,
      nearMe: isNearMe(patch.text),
      versions: [...cur.versions, { version, text: patch.text.trim(), createdAt: nowIso(), createdBy: actor, changeNote: patch.changeNote?.slice(0, 300) }],
    };
  }
  if (patch.locationId !== undefined) next.locationId = patch.locationId || undefined;
  if (patch.serviceId !== undefined) {
    const svc = profile.services.find((s) => s.id === patch.serviceId);
    next.serviceId = svc?.id;
    next.serviceLabel = svc?.value;
  }
  if (patch.status) {
    if (patch.status === "approved") {
      const chk = checkPrompt(currentPromptText(next), next.group, profile);
      if (!chk.ok) throw new PromptValidationError(chk.problems);
    }
    next.status = patch.status;
  }
  const saved = AivPromptV1.parse(next);
  await prompts().set(profile.tenantId, promptId, saved);
  await audit(profile.tenantId, actor, "prompt.update", {
    projectId: profile.projectId,
    target: promptId,
    detail: { status: patch.status, newVersion: saved.currentVersion !== cur.currentVersion ? saved.currentVersion : undefined },
  });
  return saved;
}
