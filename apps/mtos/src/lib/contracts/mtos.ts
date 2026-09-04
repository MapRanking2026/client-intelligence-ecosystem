export type Role = "account_manager" | "manager" | "qa_reviewer" | "tenant_admin";

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: Role;
}

export interface ApiResponse<T> {
  context: TenantContext;
  data: T;
}
