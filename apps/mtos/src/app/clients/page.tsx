import { AppShell } from "@/src/components/mtos/app-shell";
import { ClientRoster } from "@/src/components/mtos/client-roster";
import { DataError } from "@/src/components/mtos/data-error";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getClientsDirectoryView } from "@/src/lib/server/services/clients-service";

/**
 * Rendered per request, never prerendered.
 *
 * This page reads one tenant's data behind a session cookie, so a build-time copy of it would
 * be the wrong tenant's page for everyone -- and the build would have to reach Firestore to
 * make it, which is what failed the deploys of 2026-11-02 when the daily read quota ran out.
 * Next cannot infer this on its own here: the session read calls `cookies()` inside a
 * try/catch and skips it entirely when the cookie secret is absent, so on a build without
 * that secret nothing marks the route dynamic and it is prerendered.
 */
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  let clients;
  try {
    ({ clients } = await getClientsDirectoryView(await resolveTenantContext()));
  } catch {
    return (
      <AppShell>
        <DataError title="Couldn't load your client book" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ClientRoster clients={clients} />
    </AppShell>
  );
}
