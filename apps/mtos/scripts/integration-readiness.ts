/**
 * Which integrations are ready, which are not, and what exactly is missing.
 *
 * Written after an hour spent working out, from the source, that the Intercom step was dark
 * because two environment variables had never been set. Nothing in the app says that out loud: the
 * Settings card says "not configured in the environment yet" without naming the variable, and the
 * notification run can only report that it could not look. This names them.
 *
 * Read-only in the strictest sense: it reads provider definitions, the environment and the stored
 * connection records, and writes nothing anywhere. It prints environment variable NAMES and
 * whether each resolves, never a value -- a readiness report that leaked a client secret would be
 * a worse problem than the one it solves.
 *
 * Three things have to line up before an AM can connect an OAuth provider, and each is reported
 * separately because each has a different owner: the app registered with the provider (whoever
 * holds that account), the credentials in the environment (whoever holds Vercel), and the click in
 * Settings (every AM, for anything not shared).
 *
 *   Everything:            npx tsx scripts/integration-readiness.ts
 *   One provider:          npx tsx scripts/integration-readiness.ts --provider intercom
 *   Skip the per-AM pass:  npx tsx scripts/integration-readiness.ts --env-only
 */
import { loadEnvConfig } from "@next/env";

import {
  describeOAuthSetup,
  getIntegrationProviderIds,
  getIntegrationDefinition,
  isSharedIntegrationProvider,
  listIntegrationViews,
} from "@/src/lib/server/integrations";
import type { IntegrationProviderId } from "@/src/lib/contracts/integrations";
import {
  listActiveTenantIds,
  listTenantUserContexts,
} from "@/src/lib/server/services/daily-sync-service";
import { getAccountManagerProfile } from "@/src/lib/server/services/user-service";

function flagValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  loadEnvConfig(process.cwd());

  const envOnly = process.argv.includes("--env-only");
  const only = flagValue("--provider");
  const ids = (only ? [only] : getIntegrationProviderIds()) as IntegrationProviderId[];

  // ---------------------------------------------------------------------
  // What the environment holds. The same for every AM, so it is said once.
  // ---------------------------------------------------------------------
  console.log("ENVIRONMENT — the same for everybody\n");

  const blocked: string[] = [];
  for (const id of ids) {
    const provider = getIntegrationDefinition(id);
    const setup = describeOAuthSetup(id);
    const scope = isSharedIntegrationProvider(id) ? "shared by the team" : "one per account manager";

    if (!setup) {
      // An API-key provider needs no app and no environment credentials: the AM pastes a key into
      // Settings, so there is nothing here that can be missing.
      console.log(`  ${provider.name} · ${provider.authMode} · ${scope}`);
      console.log(`      ready to configure in Settings — credentials are entered there, not here`);
      continue;
    }

    const missing = [
      ...(setup.clientIdSet ? [] : [setup.clientIdEnv]),
      ...(setup.clientSecretSet ? [] : [setup.clientSecretEnv]),
    ];
    console.log(`  ${provider.name} · oauth · ${scope}`);
    if (missing.length) {
      blocked.push(provider.name);
      console.log(`      NOT READY — set ${missing.join(" and ")}, then redeploy`);
    } else {
      console.log(`      credentials present (${setup.clientIdEnv}, ${setup.clientSecretEnv})`);
    }
    console.log(
      `      redirect URI to register with ${provider.name}: ${setup.redirectUri || "UNKNOWN — set NEXT_PUBLIC_APP_URL"}`,
    );
    if (setup.scopes.length) {
      console.log(`      scopes requested: ${setup.scopes.join(" ")}`);
    } else {
      console.log(`      no scopes in the authorize URL — permissions are granted on the app itself`);
    }
  }

  if (blocked.length) {
    console.log(`\n  Blocked until someone sets the variables above: ${blocked.join(", ")}`);
  }

  if (envOnly) return;

  // ---------------------------------------------------------------------
  // Who has actually connected what.
  // ---------------------------------------------------------------------
  for (const tenantId of await listActiveTenantIds()) {
    console.log(`\n\nCONNECTIONS — ${tenantId}`);
    for (const context of await listTenantUserContexts(tenantId)) {
      const [profile, views] = await Promise.all([
        getAccountManagerProfile(context),
        listIntegrationViews(context),
      ]);
      const shown = views.filter((view) => ids.includes(view.id));
      const connected = shown.filter((view) => view.isConnected);
      console.log(`\n  ${profile.name} · ${connected.length}/${shown.length} connected`);

      for (const view of shown) {
        if (view.isConnected && !view.needsReconsent) continue;
        // Only what is not simply working, so the list stays the length of the problem.
        const label = view.isConnected
          ? `needs reconsent — missing ${(view.missingScopes || []).join(" ")}`
          : view.isConfigured
            ? "not connected — nothing is stopping them clicking Connect"
            : "cannot connect yet — the environment is missing credentials";
        console.log(`      ${view.name}: ${label}`);
      }
      if (shown.every((view) => view.isConnected && !view.needsReconsent)) {
        console.log("      everything they need is connected");
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
