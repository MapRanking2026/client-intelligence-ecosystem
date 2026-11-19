import { z } from "zod";

const optionalText = z.string().nullish().transform(value => value ?? undefined);
const optionalBoolean = z.boolean().nullish().transform(value => value ?? undefined);

const actionSchema = z.object({
  assignee: optionalText,
  what: z.string(),
  team: optionalText,
  due: optionalText,
  carryOver: optionalBoolean,
  crossDepartment: optionalText,
  dependsOn: optionalText,
});

export const draftSchema = z.object({
  summary: optionalText,
  bullets: z.record(z.string(), z.string().nullable().transform(value => value ?? "")).nullish().transform(value => value ?? undefined),
  goalText: optionalText,
  goalStatus: optionalText,
  goalEvidence: optionalText,
  departments: z
    .array(
      z.object({
        department: z.string(),
        clientFeedback: optionalText,
        actions: z.array(actionSchema).nullish().transform(value => value ?? undefined),
      }),
    )
    .nullish().transform(value => value ?? undefined),
  clientActions: z
    .array(
      z.object({
        what: z.string(),
        due: optionalText,
        tentative: optionalBoolean,
        blocks: optionalText,
      }),
    )
    .nullish().transform(value => value ?? undefined),
  pending: z
    .array(
      z.object({
        waitingOn: optionalText,
        missing: z.string(),
        from: optionalText,
        team: optionalText,
        owner: optionalText,
        reminderDate: optionalText,
      }),
    )
    .nullish().transform(value => value ?? undefined),
});


export function parseNotesOutput(value: unknown) {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const nested = candidate?.notes;
  return draftSchema.safeParse(candidate && !("summary" in candidate || "departments" in candidate || "bullets" in candidate) && nested && typeof nested === "object" ? nested : value);
}
