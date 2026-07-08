import {
  getClientById,
  getClients,
  getCommandCenterSnapshot,
  getCommitments,
  getMonthlyTouchById,
  getMonthlyTouches,
  getOpportunities,
} from "@/src/lib/mtos-data";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { CommandCenterSnapshot, MtosDataSource } from "@/src/lib/server/data/mtos-data-source";
import { getServerEnv, hasFirebaseAdminConfig } from "@/src/lib/server/env";
import { FirestoreMtosDataSource } from "@/src/lib/server/data/firestore-mtos-data-source";

export class SeedMtosDataSource implements MtosDataSource {
  async getCommandCenterSnapshot(): Promise<CommandCenterSnapshot> {
    return getCommandCenterSnapshot() as CommandCenterSnapshot;
  }

  async getClients() {
    return getClients();
  }

  async getClientById(clientId: string) {
    return getClientById(clientId);
  }

  async getMonthlyTouches() {
    return getMonthlyTouches();
  }

  async getMonthlyTouchById(touchId: string) {
    return getMonthlyTouchById(touchId);
  }

  async getCommitments(clientId?: string) {
    return getCommitments(clientId);
  }

  async getOpportunities(clientId?: string) {
    return getOpportunities(clientId);
  }
}

const seedMtosDataSource = new SeedMtosDataSource();

export function getMtosDataSource(context?: TenantContext): MtosDataSource {
  const env = getServerEnv();
  if (!env.useSeedData && hasFirebaseAdminConfig()) {
    return new FirestoreMtosDataSource(
      context || {
        tenantId: env.pilotTenantId,
        userId: "unknown",
        role: "account_manager",
      },
    );
  }
  return seedMtosDataSource;
}
