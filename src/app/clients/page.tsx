import { AppShell } from "@/src/components/mtos/app-shell";
import { ClientRoster } from "@/src/components/mtos/client-roster";
import { DataError } from "@/src/components/mtos/data-error";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getClientsDirectoryView } from "@/src/lib/server/services/clients-service";

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
