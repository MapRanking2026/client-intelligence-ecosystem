import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";

export async function getCommandCenterView(context: TenantContext) {
  const dataSource = getMtosDataSource(context);
  const [snapshot, clients, commitments, touches] = await Promise.all([
    dataSource.getCommandCenterSnapshot(),
    dataSource.getClients(),
    dataSource.getCommitments(),
    dataSource.getMonthlyTouches(),
  ]);

  return {
    context,
    snapshot,
    clients,
    commitments,
    touches,
  };
}
