import type {
  CameraSlot,
  TowerConnectivityType,
  TowerPowerType,
  TowerSlotCameraType,
  TowerStandardComponentType,
  TowerTemplate,
  TowerTemplateComponent,
} from "@/types";

const STANDARD_COMPONENTS = new Set<TowerStandardComponentType>(["led", "speaker", "siren"]);

export interface TenantTowerTemplateSlot {
  id: string;
  towerTemplateId: string;
  slotKey: string;
  slotOrder: number;
  cameraType: TowerSlotCameraType;
  isActive: boolean;
}

export interface TenantTowerTemplateComponent {
  id: string;
  towerTemplateId: string;
  name: string;
  isActive: boolean;
}

export interface TenantTowerTemplateConnectivity {
  id: string;
  towerTemplateId: string;
  type: TowerConnectivityType;
  isActive: boolean;
}

export interface TenantTowerTemplate {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  powerType: TowerPowerType;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  slots: TenantTowerTemplateSlot[];
  components: TenantTowerTemplateComponent[];
  connectivity: TenantTowerTemplateConnectivity[];
}

export interface TenantTowerTemplateSlotDraft {
  id?: string;
  slotKey: string;
  slotOrder: number;
  cameraType: TowerSlotCameraType;
  isActive: boolean;
}

export interface TenantTowerTemplateComponentDraft {
  id?: string;
  name: string;
  isActive: boolean;
}

export interface TenantTowerTemplateDraft {
  id?: string;
  name: string;
  description: string;
  powerType: TowerPowerType;
  isActive: boolean;
  slots: TenantTowerTemplateSlotDraft[];
  components: TenantTowerTemplateComponentDraft[];
  connectivity: TowerConnectivityType[];
}

export function toPlannerTowerTemplate(template: TenantTowerTemplate): TowerTemplate {
  const orderedSlots = [...template.slots].sort((a, b) => a.slotOrder - b.slotOrder);
  const slotCount = Math.max(orderedSlots.length, 1);
  const angleStep = 360 / slotCount;

  const cameraSlots: CameraSlot[] = orderedSlots.map((slot, index) => ({
    slotId: slot.slotKey,
    slotOrder: slot.slotOrder,
    position: "top",
    cameraType: slot.cameraType,
    isActive: slot.isActive,
    defaultAzimuthDeg: Math.round(index * angleStep),
    defaultElevationDeg: -8,
    panTiltRange: {
      azimuthMinDeg: -180,
      azimuthMaxDeg: 180,
      elevationMinDeg: -30,
      elevationMaxDeg: 30,
    },
  }));

  const activeConnectivityTypes = template.connectivity
    .filter((entry) => entry.isActive)
    .map((entry) => entry.type);

  const mappedComponents: TowerTemplateComponent[] = template.components.map((component) => {
    const normalizedName = component.name.trim();
    const canonicalName = normalizeStandardComponentName(normalizedName);

    return {
      name: canonicalName ?? normalizedName,
      isActive: component.isActive,
      isStandard: canonicalName ? STANDARD_COMPONENTS.has(canonicalName) : false,
    };
  });

  const isGridPowerType = template.powerType === "grid";

  return {
    id: template.id,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    label: template.name,
    description: template.description,
    platformId: `tenant-template-${template.id}`,
    powerType: template.powerType,
    powerMode: isGridPowerType ? "grid" : "autark",
    autark: !isGridPowerType,
    isActive: template.isActive,
    connectivityTypes: activeConnectivityTypes,
    components: mappedComponents,
    mastHeightM: 8,
    defaultCoverageRadiusMeters: estimateCoverageRadius(cameraSlots),
    cameraSlots,
  };
}

function normalizeStandardComponentName(value: string): TowerStandardComponentType | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "led") {
    return "led";
  }
  if (normalized === "speaker" || normalized === "lautsprecher") {
    return "speaker";
  }
  if (normalized === "siren" || normalized === "sirene") {
    return "siren";
  }
  return null;
}

function estimateCoverageRadius(slots: CameraSlot[]): number {
  const activeSlots = slots.filter((slot) => slot.isActive !== false && slot.cameraType !== "none");
  if (activeSlots.length === 0) {
    return 60;
  }

  const thermalBonus = activeSlots.some((slot) => slot.cameraType === "thermal") ? 20 : 0;
  return Math.min(130, 65 + activeSlots.length * 8 + thermalBonus);
}
