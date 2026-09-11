import type { AuthzContextV1 } from "@cie/contracts";
import { canAccessClient } from "@cie/core";

import type { SeoProjectV1 } from "@/src/lib/domain/project";
import { GbpAuditV1 } from "@/src/lib/domain/gbp-audit";
import { nowIso } from "@/src/lib/ids";
import { getGbpAuditRepo } from "@/src/lib/server/repositories/gbp-audit-repo";
import { getProject } from "@/src/lib/server/projects-service";
import { composeAiSystem } from "@/src/lib/server/prompts-service";
import { AiNotConfiguredError, generateText } from "@/src/lib/server/ai/llm";
import { hasAiConfig } from "@/src/lib/server/env";
import { fetchGbpForClient, type GbpResult } from "@/src/lib/server/sync/gbp-adapter";

/** SEO Dashboard fields that inform a GBP audit. */
const GBP_DASHBOARD_KEYS = [
  "Main category",
  "Avg ranking",
  "R.R.S %",
  "Health score",
  "Aug GBP views",
  "Aug check-ins",
  "Jul check-ins",
  "Satisfaction",
];

export async function getGbpAudit(tenantId: string, projectId: string) {
  return getGbpAuditRepo().get(tenantId, projectId);
}

/** Facts-only context for the GBP audit prompt. Missing GBP fields stay as NEEDS INFO. */
function buildContext(project: SeoProjectV1, gbp?: GbpResult): string {
  const lines = [
    "Produce the GBP audit for this client using ONLY the facts below. For any GBP field that is NOT provided here, emit a NEEDS INFO line — never invent categories, description, hours, photos, attributes, or metrics.",
    "",
    `Business name: ${project.businessName}`,
    project.website ? `Website: ${project.website}` : "Website: NEEDS INFO",
    project.niche ? `Niche / vertical: ${project.niche}` : "Niche / vertical: NEEDS INFO",
    project.targetLocations?.length
      ? `Target locations (geo): ${project.targetLocations.join(", ")}`
      : "Target locations (geo): NEEDS INFO",
    project.services?.length ? `Services offered: ${project.services.join(", ")}` : "Services offered: NEEDS INFO",
  ];

  const metrics = project.dashboardMetrics ?? {};
  const dash = GBP_DASHBOARD_KEYS.filter((k) => metrics[k]).map((k) => `- ${k}: ${metrics[k]}`);
  if (dash.length) lines.push("", "From the ClickUp SEO Dashboard:", ...dash);

  if (gbp?.ok) {
    if (gbp.location) lines.push("", `Matched GBP location: ${gbp.location.title}`);
    if (gbp.reviews) {
      lines.push(
        `GBP reviews (live): average ${gbp.reviews.averageRating ?? "?"} across ${gbp.reviews.totalReviewCount} review(s).`,
      );
    }
    if (gbp.performance && Object.keys(gbp.performance).length) {
      lines.push(
        "GBP performance (last 30 days, live):",
        ...Object.entries(gbp.performance).map(([k, v]) => `- ${k}: ${v}`),
      );
    }
  } else {
    lines.push(
      "",
      "Live GBP profile fields (existing categories, description, hours, photos, attributes, service areas, posts, reviews) were NOT available for this run — treat each as NEEDS INFO rather than assuming a value.",
    );
  }
  return lines.filter(Boolean).join("\n");
}

export interface GenerateGbpAuditResult {
  ok: boolean;
  error?: string;
}

/**
 * Generate a GBP audit draft for a client using the editable `gbp.audit` prompt
 * (+ global guardrails). Reads best-effort live GBP; falls back to the client's
 * services/niche/geo + ClickUp dashboard fields, and flags the rest as NEEDS
 * INFO. Staged in SEOOS only — nothing is written to Google.
 */
export async function generateGbpAuditForViewer(
  authz: AuthzContextV1,
  projectId: string,
): Promise<GenerateGbpAuditResult> {
  const project = await getProject(authz.tenantId, projectId);
  if (!project || !canAccessClient(authz.clientVisibility, project.clientId)) {
    return { ok: false, error: "Client not found" };
  }
  if (!hasAiConfig()) {
    return { ok: false, error: "AI is not configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY on SEOOS)." };
  }

  let gbp: GbpResult | undefined;
  try {
    gbp = await fetchGbpForClient(authz.tenantId, project.businessName);
  } catch {
    gbp = undefined;
  }
  const dataNote = gbp?.ok
    ? undefined
    : "Live GBP was unavailable (not connected or the Business Profile API isn't approved yet), so this audit is based on the client's services, niche, geo, and ClickUp SEO Dashboard fields — GBP profile items are flagged NEEDS INFO.";

  const system = await composeAiSystem(authz.tenantId, "gbp.audit", undefined, undefined);
  const user = buildContext(project, gbp);

  try {
    const content = (await generateText(system, user)).trim();
    if (!content) return { ok: false, error: "The audit came back empty — try again." };
    await getGbpAuditRepo().save(
      GbpAuditV1.parse({
        schemaVersion: 1,
        tenantId: authz.tenantId,
        projectId: project.id,
        clientId: project.clientId,
        content,
        dataNote,
        generatedByUserId: authz.userId,
        generatedAt: nowIso(),
      }),
    );
    return { ok: true };
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "gbp_audit_failed" };
  }
}
