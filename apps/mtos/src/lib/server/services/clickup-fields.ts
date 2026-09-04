/**
 * Shared, read-only helpers for mapping values onto a ClickUp list's custom
 * fields BY NAME. Nothing here modifies field definitions -- it only reads a
 * list's fields and builds the `custom_fields` payload for creating a task, so it
 * works against whatever list is configured without hardcoding field ids.
 */

export interface ClickUpFieldOption {
  id: string;
  name: string;
}

export interface ClickUpCustomField {
  id: string;
  name: string;
  type: string;
  options: ClickUpFieldOption[];
}

export interface ClickUpMember {
  id: number;
  name: string;
}

const fieldCache = new Map<string, { at: number; fields: ClickUpCustomField[] }>();
const memberCache = new Map<string, { at: number; members: ClickUpMember[] }>();
const TTL_MS = 60_000;

/** Fetch a list's custom-field definitions (with dropdown/label options). Never throws. */
export async function getListCustomFields(listId: string, authHeader: string): Promise<ClickUpCustomField[]> {
  const cached = fieldCache.get(listId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.fields;
  try {
    const response = await fetch(`https://api.clickup.com/api/v2/list/${listId}/field`, {
      headers: { authorization: authHeader },
    });
    if (!response.ok) return cached?.fields ?? [];
    const payload = (await response.json().catch(() => ({}))) as {
      fields?: Array<{
        id?: string;
        name?: string;
        type?: string;
        type_config?: { options?: Array<{ id?: string; name?: string; label?: string }> };
      }>;
    };
    const fields: ClickUpCustomField[] = (payload.fields || [])
      .filter((field): field is { id: string; name: string; type: string; type_config?: { options?: Array<{ id?: string; name?: string; label?: string }> } } =>
        Boolean(field.id && field.name && field.type),
      )
      .map((field) => ({
        id: field.id,
        name: field.name,
        type: field.type,
        options: (field.type_config?.options || [])
          .filter((option): option is { id: string; name?: string; label?: string } => Boolean(option.id))
          .map((option) => ({ id: option.id, name: (option.name || option.label || "").trim() })),
      }));
    fieldCache.set(listId, { at: Date.now(), fields });
    return fields;
  } catch {
    return cached?.fields ?? [];
  }
}

/** Fetch the members who can be assigned tasks in a list. Never throws. */
export async function getListMembers(listId: string, authHeader: string): Promise<ClickUpMember[]> {
  const cached = memberCache.get(listId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.members;
  try {
    const response = await fetch(`https://api.clickup.com/api/v2/list/${listId}/member`, {
      headers: { authorization: authHeader },
    });
    if (!response.ok) return cached?.members ?? [];
    const payload = (await response.json().catch(() => ({}))) as {
      members?: Array<{ id?: number; username?: string; email?: string }>;
    };
    const members: ClickUpMember[] = (payload.members || [])
      .filter((member): member is { id: number; username?: string; email?: string } => typeof member.id === "number")
      .map((member) => ({ id: member.id, name: member.username || member.email || `Member ${member.id}` }));
    memberCache.set(listId, { at: Date.now(), members });
    return members;
  } catch {
    return cached?.members ?? [];
  }
}

/** Normalize a field/option/name for loose matching (drop emoji/punctuation, lowercase). */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Resolve a value to one of a dropdown/label field's options -- confident, unambiguous matches only. */
export function matchOption(options: ClickUpFieldOption[], value: string): ClickUpFieldOption | undefined {
  const candidates = options.filter((option) => option.name);
  const rawTarget = value.trim().toLowerCase();
  const target = normalizeName(value);
  if (!target) return undefined;
  const unique = (matches: ClickUpFieldOption[]) => (matches.length === 1 ? matches[0] : undefined);

  const rawExact = candidates.find((option) => option.name.toLowerCase() === rawTarget);
  if (rawExact) return rawExact;
  const normExact = candidates.filter((option) => normalizeName(option.name) === target);
  if (normExact.length) return normExact[0];
  const prefix = unique(
    candidates.filter((option) => {
      const name = normalizeName(option.name);
      return name.startsWith(target) || target.startsWith(name);
    }),
  );
  if (prefix) return prefix;
  if (target.length >= 4) {
    const contains = unique(
      candidates.filter((option) => {
        const name = normalizeName(option.name);
        return name.includes(target) || target.includes(name);
      }),
    );
    if (contains) return contains;
  }
  return undefined;
}

/** Find a field by (normalized) name, trying each candidate name in order. */
export function findField(fields: ClickUpCustomField[], names: string[]): ClickUpCustomField | undefined {
  for (const name of names) {
    const needle = normalizeName(name);
    const exact = fields.find((field) => normalizeName(field.name) === needle);
    if (exact) return exact;
  }
  for (const name of names) {
    const needle = normalizeName(name);
    const partial = fields.find((field) => normalizeName(field.name).includes(needle));
    if (partial) return partial;
  }
  return undefined;
}

/** One field write, tagged so the update path can encode it correctly per ClickUp's API. */
export type FieldWrite = { id: string; value: unknown; kind: "simple" | "labels" | "users" };

/**
 * A builder that accumulates field writes by field NAME, choosing the right
 * encoding for the field's type. Unknown fields / unmatched options are skipped
 * silently so a write never fails on a field mismatch.
 */
export class CustomFieldBuilder {
  private readonly out: FieldWrite[] = [];

  constructor(private readonly fields: ClickUpCustomField[]) {}

  /** Text/textarea/short_text fields. */
  text(names: string[], value?: string) {
    if (!value?.trim()) return this;
    const field = findField(this.fields, names);
    if (field && field.type !== "drop_down" && field.type !== "labels") {
      this.out.push({ id: field.id, value: value.trim(), kind: "simple" });
    }
    return this;
  }

  /** Single-select dropdown fields (set to the matching option id). */
  dropdown(names: string[], value?: string) {
    if (!value?.trim()) return this;
    const field = findField(this.fields, names);
    if (field?.type === "drop_down") {
      const option = matchOption(field.options, value);
      if (option) this.out.push({ id: field.id, value: option.id, kind: "simple" });
    }
    return this;
  }

  /** Multi-select label fields (set to the matching option ids). */
  labels(names: string[], values?: string[]) {
    if (!values?.length) return this;
    const field = findField(this.fields, names);
    if (field?.type === "labels") {
      const ids = values
        .map((value) => matchOption(field.options, value)?.id)
        .filter((id): id is string => Boolean(id));
      if (ids.length) this.out.push({ id: field.id, value: ids, kind: "labels" });
    }
    return this;
  }

  /** Date fields (value is ms; accepts a YYYY-MM-DD string). */
  date(names: string[], dateInput?: string) {
    if (!dateInput?.trim()) return this;
    const parsed = new Date(`${dateInput.trim()}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return this;
    const field = findField(this.fields, names);
    if (field?.type === "date") this.out.push({ id: field.id, value: parsed.getTime(), kind: "simple" });
    return this;
  }

  /** "Users" fields (value is an array of member ids). */
  users(names: string[], memberId?: number) {
    if (typeof memberId !== "number") return this;
    const field = findField(this.fields, names);
    if (field?.type === "users") this.out.push({ id: field.id, value: [memberId], kind: "users" });
    return this;
  }

  build(): FieldWrite[] {
    return this.out;
  }
}

/** Set custom fields on an EXISTING task (one POST per field). Returns the first error, if any. */
export async function applyFieldWritesToTask(
  taskId: string,
  writes: FieldWrite[],
  authHeader: string,
): Promise<{ ok: boolean; reason?: string }> {
  for (const write of writes) {
    const body =
      write.kind === "labels" || write.kind === "users"
        ? { value: { add: write.value } }
        : { value: write.value };
    try {
      const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/field/${write.id}`, {
        method: "POST",
        headers: { authorization: authHeader, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { err?: string };
        return { ok: false, reason: payload.err || `Setting a field failed with status ${response.status}.` };
      }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Setting a field failed." };
    }
  }
  return { ok: true };
}

/** Update an existing task's native assignee / due date. Best-effort; never throws. */
export async function updateTaskNative(
  taskId: string,
  authHeader: string,
  opts: { assigneeId?: number; dueDateMs?: number },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (typeof opts.assigneeId === "number") body.assignees = { add: [opts.assigneeId] };
  if (opts.dueDateMs) body.due_date = opts.dueDateMs;
  if (!Object.keys(body).length) return;
  try {
    await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
      method: "PUT",
      headers: { authorization: authHeader, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* best-effort */
  }
}

/** Read a task's current custom-field values, keyed by field id. Never throws. */
export async function getTaskFieldValues(taskId: string, authHeader: string): Promise<Map<string, unknown>> {
  try {
    const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
      headers: { authorization: authHeader },
    });
    if (!response.ok) return new Map();
    const payload = (await response.json().catch(() => ({}))) as {
      custom_fields?: Array<{ id?: string; value?: unknown }>;
    };
    const map = new Map<string, unknown>();
    for (const field of payload.custom_fields || []) {
      if (field.id !== undefined) map.set(field.id, field.value);
    }
    return map;
  } catch {
    return new Map();
  }
}
