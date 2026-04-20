import type { Timestamps } from "./common";

export interface CustomerAddress {
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface Customer extends Timestamps {
  id: string;
  tenantId?: string;
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  billingAddress?: string;
  notes?: string;
}
