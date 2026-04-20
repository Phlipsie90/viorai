import type { IsoDateTimeString, Project } from "@/types";
import { getSupabaseClient } from "@/lib/supabase/client";
import { resolveTenantContext } from "@/lib/supabase/tenant-context";

export interface ProjectDraft {
  customerId: string;
  name: string;
  location: string;
  siteAddress: string;
  description: string;
  startDate: string;
  endDate: string;
  runtimeLabel: string;
}

export interface ProjectRepository {
  list(): Promise<Project[]>;
  create(draft: ProjectDraft): Promise<Project>;
  update(projectId: string, draft: ProjectDraft): Promise<Project>;
  getSelectedProjectId(): Promise<string | null>;
  setSelectedProjectId(projectId: string | null): Promise<void>;
}

interface ProjectRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  name: string;
  location: string;
  site_address: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  runtime_label: string | null;
  created_at: string;
  updated_at: string;
}

const SELECTED_PROJECT_KEY = "crm-tool.selected-project-id";
const PROJECT_SELECT_COLUMNS =
  "id, tenant_id, customer_id, name, location, site_address, description, start_date, end_date, runtime_label, created_at, updated_at";

function nowIsoTimestamp(): IsoDateTimeString {
  return new Date().toISOString();
}

function normalizeOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toProjectDbPayload(draft: ProjectDraft, tenantId: string) {
  const customerId = draft.customerId.trim();
  const name = draft.name.trim();
  const siteAddress = draft.siteAddress.trim();
  const location = draft.location.trim() || siteAddress;

  if (customerId.length === 0) {
    throw new Error("Kunde muss ausgewählt sein.");
  }

  if (name.length === 0) {
    throw new Error("Projektname ist ein Pflichtfeld.");
  }

  if (siteAddress.length === 0) {
    throw new Error("Baustellenadresse ist ein Pflichtfeld.");
  }

  return {
    tenant_id: tenantId,
    customer_id: customerId,
    name,
    location,
    site_address: siteAddress,
    description: normalizeOptional(draft.description),
    start_date: normalizeOptional(draft.startDate),
    end_date: normalizeOptional(draft.endDate),
    runtime_label: normalizeOptional(draft.runtimeLabel),
  };
}

function mapRowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    name: row.name,
    location: row.location,
    siteAddress: row.site_address ?? undefined,
    description: row.description ?? undefined,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    runtimeLabel: row.runtime_label ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const localProjectRepository: ProjectRepository = {
  async list() {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_SELECT_COLUMNS)
      .eq("tenant_id", tenant.tenantId);

    if (error) {
      throw new Error(error.message);
    }

    return sortProjects((data ?? []).map((entry) => mapRowToProject(entry as ProjectRow)));
  },

  async create(draft) {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const timestamp = nowIsoTimestamp();
    const payload = toProjectDbPayload(draft, tenant.tenantId);

    const { data, error } = await supabase
      .from("projects")
      .insert({
        ...payload,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .select(PROJECT_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Projekt konnte nicht erstellt werden.");
    }

    return mapRowToProject(data as ProjectRow);
  },

  async update(projectId, draft) {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);
    const payload = toProjectDbPayload(draft, tenant.tenantId);
    const { data, error } = await supabase
      .from("projects")
      .update({
        ...payload,
        updated_at: nowIsoTimestamp(),
      })
      .eq("id", projectId)
      .eq("tenant_id", tenant.tenantId)
      .select(PROJECT_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Projekt wurde nicht gefunden.");
    }

    return mapRowToProject(data as ProjectRow);
  },

  async getSelectedProjectId() {
    if (typeof window === "undefined") {
      return null;
    }

    return window.localStorage.getItem(SELECTED_PROJECT_KEY);
  },

  async setSelectedProjectId(projectId) {
    if (typeof window === "undefined") {
      return;
    }

    if (!projectId) {
      window.localStorage.removeItem(SELECTED_PROJECT_KEY);
      return;
    }

    window.localStorage.setItem(SELECTED_PROJECT_KEY, projectId);
  },
};
