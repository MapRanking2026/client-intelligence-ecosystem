/**
 * Server-evaluated feature flags. Defaults preserve MTOS: MTOS-side consumption
 * flags default OFF elsewhere. Within the standalone SEOOS app itself, the app
 * and its request→package flow default ON so it is usable; set the env vars to
 * "false" to disable.
 */
function boolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  return raw.toLowerCase() === "true" || raw === "1";
}

export function isSeoosEnabled(): boolean {
  return boolEnv("SEOOS_ENABLED", true);
}

export function isSeoosRequestsEnabled(): boolean {
  return isSeoosEnabled() && boolEnv("SEOOS_REQUESTS_ENABLED", true);
}
