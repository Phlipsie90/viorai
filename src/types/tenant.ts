import type { Timestamps } from "./common";

export type TenantUserRole = "owner" | "admin" | "user";

export interface Tenant extends Timestamps {
  id: string;
  name: string;
  slug?: string;
}

export interface TenantUser extends Timestamps {
  id: string;
  tenantId: string;
  userId: string;
  email?: string;
  fullName?: string;
  role: TenantUserRole;
  isActive: boolean;
}
