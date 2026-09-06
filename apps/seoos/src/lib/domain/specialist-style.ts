import { z } from "zod";
import { zIsoTimestamp, zTenantId } from "@cie/contracts";

/**
 * A learned style profile for one SEO specialist. The AI ALWAYS conditions its
 * drafts for an account on the profile of that account's specialist — tone,
 * grammar, structure, techniques — so its output matches how that person works.
 * Learned from their prior work and refined from every correction they make.
 */
export const StyleRule = z.object({
  text: z.string().min(1),
  /** Where it came from: observed from prior work, or a correction they made. */
  source: z.enum(["observed", "correction"]).default("observed"),
  at: zIsoTimestamp,
});
export type StyleRule = z.infer<typeof StyleRule>;

export const SpecialistStyleV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: zTenantId,
  specialistId: z.string().min(1),
  /** A short prose description of how this specialist writes/works. */
  summary: z.string().default(""),
  /** Concrete, enforceable rules the AI must follow for this specialist. */
  rules: z.array(StyleRule).default([]),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type SpecialistStyleV1 = z.infer<typeof SpecialistStyleV1>;
