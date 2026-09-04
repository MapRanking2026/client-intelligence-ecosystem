import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";

export async function getClientsDirectoryView(context: TenantContext) {
  const dataSource = getMtosDataSource(context);
  const clients = await dataSource.getClients();

  return {
    context,
    clients,
  };
}

export async function getClientWorkspaceView(context: TenantContext, clientId: string) {
  const dataSource = getMtosDataSource(context);
  const client = await dataSource.getClientById(clientId);

  if (!client) {
    return null;
  }

  const [touch, commitments, opportunities] = await Promise.all([
    dataSource.getMonthlyTouchById(client.touchId),
    dataSource.getCommitments(client.id),
    dataSource.getOpportunities(client.id),
  ]);

  return {
    context,
    client,
    touch: touch ?? null,
    commitments,
    opportunities,
  };
}
