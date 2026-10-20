import { z } from "zod";

import { newId, nowIso } from "@/src/lib/ids";
import { checkPrompt, isNearMe } from "@/src/lib/ai-visibility/prompts";
import { AivObservationV1, PromptGroup, type AivProfileV1 } from "@/src/lib/ai-visibility/types";
import { isSafeHttpUrl } from "@/src/lib/ai-visibility/url";
import { mergeCitations } from "./providers/types";
import { analyze } from "./analysis-service";
import { audit } from "./audit";
import { evidenceFiles, observations } from "./store";

/**
 * Channel C — manual observations. An authorized user records what they saw in
 * a consumer surface (ChatGPT app, Google AI Overview, …). These are always
 * labelled "manual" and never merged into official-API metrics.
 */

export const MANUAL_SURFACES = [
  "ChatGPT app (manual)",
  "Google AI Overview (manual)",
  "Google AI Mode (manual)",
  "Gemini app (manual)",
  "Perplexity app (manual)",
  "Claude.ai app (manual)",
  "Microsoft Copilot (manual)",
  "Other AI surface (manual)",
] as const;

export const ManualInput = z.object({
  surface: z.enum(MANUAL_SURFACES),
  promptText: z.string().min(5).max(600),
  group: PromptGroup,
  answerText: z.string().min(1).max(50000),
  citationUrls: z.array(z.string().max(2000)).max(50).default([]),
  serviceId: z.string().optional(),
  locationId: z.string().optional(),
  observedAt: z.string().optional(),
  note: z.string().max(2000).optional(),
  screenshot: z
    .object({ mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]), dataBase64: z.string().max(1_000_000) })
    .optional(),
});
export type ManualInput = z.infer<typeof ManualInput>;

const MAX_IMAGE_BYTES = 700 * 1024;

function sniff(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function createManualObservation(profile: AivProfileV1, raw: ManualInput, actor: string): Promise<AivObservationV1> {
  const input = ManualInput.parse(raw);
  const chk = checkPrompt(input.promptText, input.group, profile);
  if (!chk.ok) throw new Error(`Prompt check failed: ${chk.problems.join(" ")}`);
  let evidenceFileId: string | undefined;
  if (input.screenshot) {
    const buf = Buffer.from(input.screenshot.dataBase64, "base64");
    if (buf.length > MAX_IMAGE_BYTES) throw new Error("Screenshot is larger than 700 KB.");
    const kind = sniff(buf);
    if (!kind || kind !== input.screenshot.mimeType) throw new Error("Screenshot is not a valid PNG, JPEG or WebP image.");
    evidenceFileId = newId("evf");
    await evidenceFiles().set(profile.tenantId, evidenceFileId, {
      schemaVersion: 1,
      id: evidenceFileId,
      tenantId: profile.tenantId,
      projectId: profile.projectId,
      mimeType: kind,
      dataBase64: buf.toString("base64"),
      uploadedBy: actor,
      createdAt: nowIso(),
    });
  }
  const urls = input.citationUrls.map((u) => u.trim()).filter(isSafeHttpUrl);
  const now = nowIso();
  const observedAt = input.observedAt && !Number.isNaN(Date.parse(input.observedAt)) ? new Date(input.observedAt).toISOString() : now;
  const loc = profile.locations.find((l) => l.id === input.locationId);
  let obs = AivObservationV1.parse({
    schemaVersion: 1,
    id: newId("obs_manual"),
    tenantId: profile.tenantId,
    projectId: profile.projectId,
    clientId: profile.clientId,
    channel: "manual",
    surface: input.surface,
    promptGroup: input.group,
    branded: input.group === "branded",
    submittedText: input.promptText.trim(),
    language: profile.language,
    serviceId: input.serviceId,
    locationId: loc?.id,
    locationMode: isNearMe(input.promptText) ? "near_me_ambiguous" : loc ? "explicit_in_text" : "none",
    collectedAt: observedAt,
    searchExecuted: null,
    collectionStatus: "success",
    answerText: input.answerText,
    citations: mergeCitations(urls.map((url) => ({ url }))),
    costUsd: 0,
    costBasis: "manual",
    uploadedBy: actor,
    evidenceFileId,
    manualNote: input.note,
    createdAt: now,
    updatedAt: now,
  });
  obs = analyze(obs, profile);
  await observations().set(profile.tenantId, obs.id, obs);
  await audit(profile.tenantId, actor, "observation.manual_create", { projectId: profile.projectId, target: obs.id, detail: { surface: input.surface, screenshot: Boolean(evidenceFileId) } });
  return obs;
}
