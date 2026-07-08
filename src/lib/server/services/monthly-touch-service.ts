import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";

export async function getMonthlyTouchQueueView(context: TenantContext) {
  const dataSource = getMtosDataSource(context);
  const touches = await dataSource.getMonthlyTouches();

  const queue = await Promise.all(
    touches.map(async (touch) => ({
      touch,
      client: (await dataSource.getClientById(touch.clientId)) ?? null,
    })),
  );

  return {
    context,
    queue,
  };
}

export async function getMonthlyTouchWorkspaceView(context: TenantContext, touchId: string) {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);

  if (!touch) {
    return null;
  }

  const [client, commitments, opportunities] = await Promise.all([
    dataSource.getClientById(touch.clientId),
    dataSource.getCommitments(touch.clientId),
    dataSource.getOpportunities(touch.clientId),
  ]);

  if (!client) {
    return null;
  }

  return {
    context,
    touch,
    client,
    commitments,
    opportunities,
  };
}
