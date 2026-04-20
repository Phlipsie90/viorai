import { getSupabaseClient } from "@/lib/supabase/client";
import { resolveTenantContext } from "@/lib/supabase/tenant-context";
import type {
  TenantTowerTemplate,
  TenantTowerTemplateComponent,
  TenantTowerTemplateComponentDraft,
  TenantTowerTemplateConnectivity,
  TenantTowerTemplateDraft,
  TenantTowerTemplateSlot,
} from "./types";
import type { TowerConnectivityType, TowerPowerType, TowerSlotCameraType } from "@/types";

interface TowerTemplateRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  power_type: TowerPowerType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface TowerTemplateSlotRow {
  id: string;
  tower_template_id: string;
  slot_key: string;
  slot_order: number;
  camera_type: TowerSlotCameraType;
  is_active: boolean;
}

interface TowerTemplateComponentRow {
  id: string;
  tower_template_id: string;
  name: string;
  is_active: boolean;
}

interface TowerTemplateConnectivityRow {
  id: string;
  tower_template_id: string;
  type: TowerConnectivityType;
  is_active: boolean;
}

const TEMPLATE_COLUMNS =
  "id, tenant_id, name, description, power_type, is_active, created_at, updated_at";
const SLOT_COLUMNS = "id, tower_template_id, slot_key, slot_order, camera_type, is_active";
const COMPONENT_COLUMNS = "id, tower_template_id, name, is_active";
const CONNECTIVITY_COLUMNS = "id, tower_template_id, type, is_active";

const POWER_TYPES = new Set<TowerPowerType>([
  "grid",
  "battery",
  "efoy",
  "diesel",
  "solar",
  "hybrid",
]);

const CONNECTIVITY_TYPES = new Set<TowerConnectivityType>([
  "lte",
  "5g",
  "wlan",
  "satellite",
  "lan",
]);

function isSchemaTableMissing(errorMessage?: string): boolean {
  return Boolean(errorMessage?.includes("Could not find the table 'public."));
}

function toSchemaMissingMessage(): string {
  return "Die Turm-Tabellen fehlen in der Supabase-Datenbank (Schema-Cache). Bitte Migrationen anwenden (z. B. supabase/migrations/20260419_tenant_tower_templates.sql und supabase/migrations/20260419_tower_templates_domain_completion.sql).";
}

function normalizePowerType(value: unknown): TowerPowerType {
  if (typeof value !== "string") {
    return "grid";
  }

  const normalized = value.trim().toLowerCase();
  if (POWER_TYPES.has(normalized as TowerPowerType)) {
    return normalized as TowerPowerType;
  }

  if (normalized === "autark") {
    return "hybrid";
  }

  return "grid";
}

function normalizeSlotCameraType(value: unknown): TowerSlotCameraType {
  if (typeof value !== "string") {
    return "none";
  }

  switch (value.toLowerCase()) {
    case "ptz":
    case "bullet":
    case "thermal":
    case "dome":
    case "none":
      return value.toLowerCase() as TowerSlotCameraType;
    default:
      return "none";
  }
}

function normalizeConnectivityType(value: unknown): TowerConnectivityType | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!CONNECTIVITY_TYPES.has(normalized as TowerConnectivityType)) {
    return null;
  }

  return normalized as TowerConnectivityType;
}

function normalizeComponentName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  if (lower === "led") {
    return "led";
  }
  if (lower === "speaker" || lower === "lautsprecher") {
    return "speaker";
  }
  if (lower === "siren" || lower === "sirene") {
    return "siren";
  }

  return normalized;
}

function mapSlotRow(row: TowerTemplateSlotRow): TenantTowerTemplateSlot {
  return {
    id: row.id,
    towerTemplateId: row.tower_template_id,
    slotKey: row.slot_key,
    slotOrder: row.slot_order,
    cameraType: normalizeSlotCameraType(row.camera_type),
    isActive: row.is_active,
  };
}

function mapComponentRow(row: TowerTemplateComponentRow): TenantTowerTemplateComponent {
  return {
    id: row.id,
    towerTemplateId: row.tower_template_id,
    name: normalizeComponentName(row.name),
    isActive: row.is_active,
  };
}

function mapConnectivityRow(row: TowerTemplateConnectivityRow): TenantTowerTemplateConnectivity {
  return {
    id: row.id,
    towerTemplateId: row.tower_template_id,
    type: normalizeConnectivityType(row.type) ?? "lte",
    isActive: row.is_active,
  };
}

function mapTemplateRow(
  row: TowerTemplateRow,
  slots: TenantTowerTemplateSlot[],
  components: TenantTowerTemplateComponent[],
  connectivity: TenantTowerTemplateConnectivity[]
): TenantTowerTemplate {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description ?? undefined,
    powerType: normalizePowerType(row.power_type),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    slots: slots.sort((a, b) => a.slotOrder - b.slotOrder),
    components: components.sort((a, b) => a.name.localeCompare(b.name, "de")),
    connectivity: connectivity.sort((a, b) => a.type.localeCompare(b.type, "de")),
  };
}

function normalizeComponents(input: TenantTowerTemplateComponentDraft[]): TenantTowerTemplateComponentDraft[] {
  const deduplicatedByName = new Map<string, TenantTowerTemplateComponentDraft>();

  for (const component of input) {
    const name = normalizeComponentName(component.name);
    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    if (!deduplicatedByName.has(key)) {
      deduplicatedByName.set(key, {
        ...component,
        name,
        isActive: component.isActive,
      });
    }
  }

  return Array.from(deduplicatedByName.values());
}

function normalizeDraft(input: TenantTowerTemplateDraft): TenantTowerTemplateDraft {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Vorlagenname ist erforderlich.");
  }

  if (input.slots.length === 0) {
    throw new Error("Mindestens ein Slot ist erforderlich.");
  }

  const mappedSlots = input.slots.map((slot, index) => ({
    ...slot,
    slotKey: slot.slotKey.trim() || `slot-${index + 1}`,
    slotOrder: Number.isFinite(slot.slotOrder) ? Math.max(1, Math.floor(slot.slotOrder)) : index + 1,
    cameraType: normalizeSlotCameraType(slot.cameraType),
    isActive: slot.isActive,
  }));

  const uniqueSlotKeys = new Set<string>();
  const uniqueSlotOrders = new Set<number>();
  for (const slot of mappedSlots) {
    const slotKeyKey = slot.slotKey.toLowerCase();
    if (uniqueSlotKeys.has(slotKeyKey)) {
      throw new Error(`Slot-Key \"${slot.slotKey}\" ist mehrfach vorhanden.`);
    }
    uniqueSlotKeys.add(slotKeyKey);

    if (uniqueSlotOrders.has(slot.slotOrder)) {
      throw new Error(`Slot-Reihenfolge ${slot.slotOrder} ist mehrfach vorhanden.`);
    }
    uniqueSlotOrders.add(slot.slotOrder);
  }

  const normalizedSlots = mappedSlots
    .sort((a, b) => a.slotOrder - b.slotOrder)
    .map((slot, index) => ({
      ...slot,
      slotOrder: index + 1,
    }));

  const normalizedComponents = normalizeComponents(input.components);
  const normalizedConnectivity = Array.from(
    new Set(
      input.connectivity
        .map((entry) => normalizeConnectivityType(entry))
        .filter((entry): entry is TowerConnectivityType => entry !== null)
    )
  );

  return {
    ...input,
    name,
    description: input.description.trim(),
    powerType: normalizePowerType(input.powerType),
    slots: normalizedSlots,
    components: normalizedComponents,
    connectivity: normalizedConnectivity,
  };
}

export const towerTemplateRepository = {
  async list(): Promise<TenantTowerTemplate[]> {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);

    const { data: templateRows, error: templateError } = await supabase
      .from("tower_templates")
      .select(TEMPLATE_COLUMNS)
      .eq("tenant_id", tenant.tenantId)
      .order("name", { ascending: true });

    if (templateError) {
      if (isSchemaTableMissing(templateError.message)) {
        throw new Error(toSchemaMissingMessage());
      }
      throw new Error(templateError.message);
    }

    const rows = (templateRows ?? []) as TowerTemplateRow[];
    if (rows.length === 0) {
      return [];
    }

    const templateIds = rows.map((row) => row.id);

    const { data: slotRows, error: slotError } = await supabase
      .from("tower_template_slots")
      .select(SLOT_COLUMNS)
      .in("tower_template_id", templateIds)
      .order("slot_order", { ascending: true });

    if (slotError) {
      if (isSchemaTableMissing(slotError.message)) {
        throw new Error(toSchemaMissingMessage());
      }
      throw new Error(slotError.message);
    }

    const { data: componentRows, error: componentError } = await supabase
      .from("tower_template_components")
      .select(COMPONENT_COLUMNS)
      .in("tower_template_id", templateIds)
      .order("name", { ascending: true });

    if (componentError) {
      if (isSchemaTableMissing(componentError.message)) {
        throw new Error(toSchemaMissingMessage());
      }
      throw new Error(componentError.message);
    }

    const { data: connectivityRows, error: connectivityError } = await supabase
      .from("tower_template_connectivity")
      .select(CONNECTIVITY_COLUMNS)
      .in("tower_template_id", templateIds)
      .order("type", { ascending: true });

    if (connectivityError) {
      if (isSchemaTableMissing(connectivityError.message)) {
        throw new Error(toSchemaMissingMessage());
      }
      throw new Error(connectivityError.message);
    }

    const groupedSlots = new Map<string, TenantTowerTemplateSlot[]>();
    for (const row of (slotRows ?? []) as TowerTemplateSlotRow[]) {
      const current = groupedSlots.get(row.tower_template_id) ?? [];
      current.push(mapSlotRow(row));
      groupedSlots.set(row.tower_template_id, current);
    }

    const groupedComponents = new Map<string, TenantTowerTemplateComponent[]>();
    for (const row of (componentRows ?? []) as TowerTemplateComponentRow[]) {
      const current = groupedComponents.get(row.tower_template_id) ?? [];
      current.push(mapComponentRow(row));
      groupedComponents.set(row.tower_template_id, current);
    }

    const groupedConnectivity = new Map<string, TenantTowerTemplateConnectivity[]>();
    for (const row of (connectivityRows ?? []) as TowerTemplateConnectivityRow[]) {
      const current = groupedConnectivity.get(row.tower_template_id) ?? [];
      current.push(mapConnectivityRow(row));
      groupedConnectivity.set(row.tower_template_id, current);
    }

    return rows.map((row) =>
      mapTemplateRow(
        row,
        groupedSlots.get(row.id) ?? [],
        groupedComponents.get(row.id) ?? [],
        groupedConnectivity.get(row.id) ?? []
      )
    );
  },

  async save(draft: TenantTowerTemplateDraft): Promise<TenantTowerTemplate> {
    const normalized = normalizeDraft(draft);
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);

    const templatePayload = {
      tenant_id: tenant.tenantId,
      name: normalized.name,
      description: normalized.description || null,
      power_type: normalized.powerType,
      is_active: normalized.isActive,
    };

    const { data: savedTemplateRow, error: saveTemplateError } = normalized.id
      ? await supabase
          .from("tower_templates")
          .update(templatePayload)
          .eq("id", normalized.id)
          .eq("tenant_id", tenant.tenantId)
          .select(TEMPLATE_COLUMNS)
          .single()
      : await supabase
          .from("tower_templates")
          .insert(templatePayload)
          .select(TEMPLATE_COLUMNS)
          .single();

    if (saveTemplateError || !savedTemplateRow) {
      if (isSchemaTableMissing(saveTemplateError?.message)) {
        throw new Error(toSchemaMissingMessage());
      }
      throw new Error(saveTemplateError?.message ?? "Turmvorlage konnte nicht gespeichert werden.");
    }

    const templateRow = savedTemplateRow as TowerTemplateRow;

    const { error: deleteSlotsError } = await supabase
      .from("tower_template_slots")
      .delete()
      .eq("tower_template_id", templateRow.id);

    if (deleteSlotsError) {
      throw new Error(deleteSlotsError.message);
    }

    const { error: deleteComponentsError } = await supabase
      .from("tower_template_components")
      .delete()
      .eq("tower_template_id", templateRow.id);

    if (deleteComponentsError) {
      throw new Error(deleteComponentsError.message);
    }

    const { error: deleteConnectivityError } = await supabase
      .from("tower_template_connectivity")
      .delete()
      .eq("tower_template_id", templateRow.id);

    if (deleteConnectivityError) {
      throw new Error(deleteConnectivityError.message);
    }

    if (normalized.slots.length > 0) {
      const slotPayload = normalized.slots.map((slot) => ({
        tower_template_id: templateRow.id,
        tenant_id: tenant.tenantId,
        slot_key: slot.slotKey,
        slot_order: slot.slotOrder,
        camera_type: slot.cameraType,
        is_active: slot.isActive,
      }));

      const { error: insertSlotsError } = await supabase
        .from("tower_template_slots")
        .insert(slotPayload);

      if (insertSlotsError) {
        throw new Error(insertSlotsError.message);
      }
    }

    if (normalized.components.length > 0) {
      const componentPayload = normalized.components.map((component) => ({
        tower_template_id: templateRow.id,
        tenant_id: tenant.tenantId,
        name: component.name,
        is_active: component.isActive,
      }));

      const { error: insertComponentsError } = await supabase
        .from("tower_template_components")
        .insert(componentPayload);

      if (insertComponentsError) {
        throw new Error(insertComponentsError.message);
      }
    }

    if (normalized.connectivity.length > 0) {
      const connectivityPayload = normalized.connectivity.map((type) => ({
        tower_template_id: templateRow.id,
        tenant_id: tenant.tenantId,
        type,
        is_active: true,
      }));

      const { error: insertConnectivityError } = await supabase
        .from("tower_template_connectivity")
        .insert(connectivityPayload);

      if (insertConnectivityError) {
        throw new Error(insertConnectivityError.message);
      }
    }

    const templates = await this.list();
    const found = templates.find((template) => template.id === templateRow.id);

    if (!found) {
      throw new Error("Gespeicherte Turmvorlage konnte nicht geladen werden.");
    }

    return found;
  },

  async remove(templateId: string): Promise<void> {
    const supabase = getSupabaseClient();
    const tenant = await resolveTenantContext(supabase);

    const { error } = await supabase
      .from("tower_templates")
      .delete()
      .eq("id", templateId)
      .eq("tenant_id", tenant.tenantId);

    if (error) {
      if (isSchemaTableMissing(error.message)) {
        throw new Error(toSchemaMissingMessage());
      }
      throw new Error(error.message);
    }
  },
};
