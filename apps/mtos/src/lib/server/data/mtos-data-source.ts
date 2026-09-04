import type {
  ClientRecord,
  CommitmentRecord,
  MonthlyTouchRecord,
  OpportunityRecord,
} from "@/src/lib/mtos-data";

export interface CommandCenterSnapshot {
  focusDate: string;
  priorities: string[];
  alerts: Array<{
    label: string;
    tone: "warning" | "danger" | "positive";
  }>;
}

export interface MtosDataSource {
  getCommandCenterSnapshot(): Promise<CommandCenterSnapshot>;
  getClients(): Promise<ClientRecord[]>;
  getClientById(clientId: string): Promise<ClientRecord | undefined>;
  getMonthlyTouches(): Promise<MonthlyTouchRecord[]>;
  getMonthlyTouchById(touchId: string): Promise<MonthlyTouchRecord | undefined>;
  getCommitments(clientId?: string): Promise<CommitmentRecord[]>;
  getOpportunities(clientId?: string): Promise<OpportunityRecord[]>;
}
