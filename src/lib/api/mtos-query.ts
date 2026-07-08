import type { ApiResponse, TenantContext } from "@/src/lib/contracts/mtos";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";

export async function commandCenterResponse(context: TenantContext): Promise<
  ApiResponse<Awaited<ReturnType<ReturnType<typeof getMtosDataSource>["getCommandCenterSnapshot"]>>>
> {
  const dataSource = getMtosDataSource(context);
  return {
    context,
    data: await dataSource.getCommandCenterSnapshot(),
  };
}

export async function clientsResponse(context: TenantContext) {
  const dataSource = getMtosDataSource(context);
  return {
    context,
    data: await dataSource.getClients(),
  };
}

export async function clientWorkspaceResponse(context: TenantContext, clientId: string) {
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
    data: {
      client,
      touch: touch ?? null,
      commitments,
      opportunities,
    },
  };
}

export async function monthlyTouchesResponse(context: TenantContext) {
  const dataSource = getMtosDataSource(context);
  const touches = await dataSource.getMonthlyTouches();
  return {
    context,
    data: await Promise.all(
      touches.map(async (touch) => ({
      ...touch,
      client: (await dataSource.getClientById(touch.clientId)) ?? null,
      })),
    ),
  };
}

export async function monthlyTouchWorkspaceResponse(context: TenantContext, touchId: string) {
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

  return {
    context,
    data: {
      touch,
      client: client ?? null,
      commitments,
      opportunities,
    },
  };
}

export async function commitmentsResponse(context: TenantContext) {
  const dataSource = getMtosDataSource(context);
  return {
    context,
    data: await dataSource.getCommitments(),
  };
}

export async function opportunitiesResponse(context: TenantContext) {
  const dataSource = getMtosDataSource(context);
  return {
    context,
    data: await dataSource.getOpportunities(),
  };
}
