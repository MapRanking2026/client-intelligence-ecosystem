import type { ClientRecord } from "@/src/lib/mtos-data";

/** Region-based IANA zones handle daylight saving; EST/PST and numeric offsets do not. */
export function clientZone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const zone = value.trim();
  if (zone !== "UTC" && !zone.includes("/")) return undefined;
  try { return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone; }
  catch { return undefined; }
}

export function resolveClientTimeZone(client: ClientRecord, explicit?: string): { timeZone?: string; source: string } {
  if (explicit !== undefined) {
    const timeZone = clientZone(explicit);
    return { timeZone, source: timeZone ? "Client time zone explicitly set by the account manager." : "Enter a valid client IANA time zone, such as America/Los_Angeles." };
  }
  const saved = clientZone(client.timeZone);
  if (saved) return { timeZone: saved, source: "Client time zone saved on the account." };
  const raw = client.rawPayload || {};
  for (const key of ["timeZone", "timezone", "time_zone", "clientTimeZone", "client_timezone"]) {
    const timeZone = clientZone(raw[key]);
    if (timeZone) return { timeZone, source: `Client time zone from the account's ${key} field.` };
  }
  const fields = Array.isArray(raw.custom_fields) ? raw.custom_fields as Record<string, unknown>[] : [];
  for (const field of fields) {
    if (!/\btime\s*zone\b|timezone/i.test(String(field.name || ""))) continue;
    let value = field.value;
    const config = field.type_config as { options?: { id?: string; name?: string; value?: string; orderindex?: number }[] } | undefined;
    const option = config?.options?.find((item) => item.id === value || item.orderindex === value);
    if (option) value = option.name || option.value;
    const timeZone = clientZone(value);
    if (timeZone) return { timeZone, source: `Client time zone from ClickUp field “${String(field.name)}”.` };
  }
  return { source: "No verified client time zone is recorded. Set the client's time zone before sending." };
}
