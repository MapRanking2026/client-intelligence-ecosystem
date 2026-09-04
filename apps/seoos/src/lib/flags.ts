import { getServerEnv } from "@/src/lib/server/env";

/**
 * Server-evaluated feature flags. Env is the initial source of truth; a
 * tenant-aware flag repository can layer on later without changing callers.
 * Defaults preserve MTOS behavior.
 */
export function isSeoosEnabled(): boolean {
  return getServerEnv().seoosEnabled;
}

export function isSeoosRequestsEnabled(): boolean {
  const env = getServerEnv();
  return env.seoosEnabled && env.seoosRequestsEnabled;
}
