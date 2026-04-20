import type { Customer, IsoDateTimeString } from "@/types";
import { getSupabaseClient } from "@/lib/supabase/client";
import { resolveTenantContext } from "@/lib/supabase/tenant-context";

export interface CustomerDraft {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  billingAddress: string;
  notes: string;
}

export interface CustomerRepository {
  list(): Promise<Customer[]>;
  get(customerId: string): Promise<Customer | null>;
  create(draft: CustomerDraft): Promise<Customer>;
  update(customerId: string, draft: CustomerDraft): Promise<Customer>;
  getSelectedCustomerId(): Promise<string | null>;
  setSelectedCustomerId(customerId: string | null): Promise<void>;
}

interface CustomerRow {
  id: string;
  tenant_id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  billing_address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const SELECTED_CUSTOMER_KEY = "crm-tool.selected-customer-id";
const CUSTOMER_SELECT_COLUMNS =
  "id, tenant_id, company_name, contact_name, email, phone, address, billing_address, notes, created_at, updated_at";

function nowIsoTimestamp(): IsoDateTimeString {
  return new Date().toISOString();
}

function normalizeOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toInsertPayload(draft: CustomerDraft, tenantId: string) {
  const companyName = draft.companyName.trim();
  if (companyName.length === 0) {
    throw new Error("Firmenname ist erforderlich.");
  }

  return {
    tenant_id: tenantId,
    company_name: companyName,
    contact_name: normalizeOptional(draft.contactName),
    email: normalizeOptional(draft.email),
    phone: normalizeOptional(draft.phone),
    address: normalizeOptional(draft.address),
    billing_address: normalizeOptional(draft.billingAddress),
    notes: normalizeOptional(draft.notes),
  };
}

function mapRowToCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    companyName: row.company_name,
    contactName: row.contact_name ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    address: row.address ?? undefined,
    billingAddress: row.billing_address ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCustomerUpsertPayload(draft: CustomerDraft, tenantId: string) {
  const payload = toInsertPayload(draft, tenantId);

  return {
    tenant_id: payload.tenant_id,
    company_name: payload.company_name,
    contact_name: payload.contact_name,
    email: payload.email,
    phone: payload.phone,
    address: payload.address,
    billing_address: payload.billing_address,
    notes: payload.notes,
  };
}

function sortCustomers(customers: Customer[]): Customer[] {
  return [...customers].sort((a, b) => a.companyName.localeCompare(b.companyName, "de"));
}

export const localCustomerRepository: CustomerRepository = {
  async list() {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const { data, error } = await supabase
      .from("customers")
      .select(CUSTOMER_SELECT_COLUMNS)
      .eq("tenant_id", tenant.tenantId);

    if (error) {
      throw new Error(error.message);
    }

    return sortCustomers((data ?? []).map((entry) => mapRowToCustomer(entry as CustomerRow)));
  },

  async get(customerId) {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const { data, error } = await supabase
      .from("customers")
      .select(CUSTOMER_SELECT_COLUMNS)
      .eq("id", customerId)
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data ? mapRowToCustomer(data as CustomerRow) : null;
  },

  async create(draft) {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const payload = toCustomerUpsertPayload(draft, tenant.tenantId);
    const timestamp = nowIsoTimestamp();

    const { data, error } = await supabase
      .from("customers")
      .insert({
        ...payload,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .select(CUSTOMER_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Kunde konnte nicht erstellt werden.");
    }

    return mapRowToCustomer(data as CustomerRow);
  },

  async update(customerId, draft) {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const payload = toCustomerUpsertPayload(draft, tenant.tenantId);

    const { data, error } = await supabase
      .from("customers")
      .update({
        ...payload,
        updated_at: nowIsoTimestamp(),
      })
      .eq("id", customerId)
      .eq("tenant_id", tenant.tenantId)
      .select(CUSTOMER_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Kunde wurde nicht gefunden.");
    }

    return mapRowToCustomer(data as CustomerRow);
  },

  async getSelectedCustomerId() {
    if (typeof window === "undefined") {
      return null;
    }

    return window.localStorage.getItem(SELECTED_CUSTOMER_KEY);
  },

  async setSelectedCustomerId(customerId) {
    if (typeof window === "undefined") {
      return;
    }

    if (!customerId) {
      window.localStorage.removeItem(SELECTED_CUSTOMER_KEY);
      return;
    }

    window.localStorage.setItem(SELECTED_CUSTOMER_KEY, customerId);
  },
};
