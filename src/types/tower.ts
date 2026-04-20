import type { Timestamps, PixelCoord } from "./common";

// ---------------------------------------------------------------------------
// Tower platform – the physical mast/chassis
// ---------------------------------------------------------------------------

export type PowerSource = "solar-battery" | "mains" | "generator" | "battery-only";

export interface TowerPlatform extends Timestamps {
  id: string;
  manufacturer: string;
  name: string;
  /** Nominal mast height in meters */
  heightMeters: number;
  /** Maximum total payload for cameras, housing and accessories in kg */
  maxPayloadKg: number;
  powerSource: PowerSource;
  /** Usable battery capacity in Wh; undefined for mains-only platforms */
  batteryCapacityWh?: number;
  /** Peak solar panel output in watts; undefined when no solar panel fitted */
  solarPanelWatts?: number;
  /** Estimated operating autonomy in hours under standard load */
  autonomyHours?: number;
}

// ---------------------------------------------------------------------------
// Tower template – reusable configuration of a platform with camera slots
// ---------------------------------------------------------------------------

export type CameraSlotPosition = "top" | "mid" | "mast-base";
export type TowerSlotCameraType = "ptz" | "bullet" | "thermal" | "dome" | "none";
export type TowerPowerType = "grid" | "battery" | "efoy" | "diesel" | "solar" | "hybrid";
export type TowerConnectivityType = "lte" | "5g" | "wlan" | "satellite" | "lan";
export type TowerStandardComponentType = "led" | "speaker" | "siren";

export interface TowerTemplateComponent {
  name: string;
  isActive: boolean;
  isStandard?: boolean;
}

/** Pan / tilt range for a camera slot, in degrees */
export interface PanTiltRange {
  /** Minimum azimuth (pan) angle in degrees, -180…180 relative to north */
  azimuthMinDeg: number;
  /** Maximum azimuth (pan) angle in degrees, -180…180 relative to north */
  azimuthMaxDeg: number;
  /** Minimum elevation (tilt) angle in degrees; negative = downward */
  elevationMinDeg: number;
  /** Maximum elevation (tilt) angle in degrees; positive = upward */
  elevationMaxDeg: number;
}

export interface CameraSlot {
  /** Unique within the template */
  slotId: string;
  /** Display order in planner and admin */
  slotOrder?: number;
  position: CameraSlotPosition;
  cameraType?: TowerSlotCameraType;
  isActive?: boolean;
  /** Default horizontal rotation for this slot, in degrees (0 = north/up, clockwise) */
  defaultAzimuthDeg: number;
  /** Optional alias for defaultAzimuthDeg used by planner calculations */
  defaultRotationDeg?: number;
  /** Default vertical tilt for this slot, in degrees (negative = downward) */
  defaultElevationDeg: number;
  /** If set, this slot is pre-assigned to a specific camera model */
  defaultCameraModelId?: string;
  /** If set, this slot uses a specific lens option from the camera model */
  defaultLensOptionId?: string;
  panTiltRange: PanTiltRange;
}

export interface TowerMechanics {
  setupTimeMinutes: number;
  maxWindKmh: number;
  payloadKg: number;
}

export interface TowerTemplatePricing {
  monthlyBaseEur: number;
}

export interface PlacedTowerCameraConfiguration {
  slotId: string;
  cameraType: TowerSlotCameraType;
  active: boolean;
  customRotationDeg?: number;
}

export interface TowerTemplate extends Timestamps {
  id: string;
  /** Human-readable configuration name, e.g. "Standard 6 m – 2-Kamera" */
  label: string;
  description?: string;
  platformId: string;
  powerType?: TowerPowerType;
  connectivityTypes?: TowerConnectivityType[];
  components?: TowerTemplateComponent[];

  /** @deprecated Prefer powerType. */
  powerMode?: "autark" | "grid";
  isActive?: boolean;

  /** @deprecated Prefer components and connectivityTypes. */
  optionalComponents?: string[];

  /** @deprecated Prefer powerType. */
  autark?: boolean;
  mastHeightM?: number;
  mechanics?: TowerMechanics;
  pricing?: TowerTemplatePricing;
  cameraSlots: CameraSlot[];
  /** Default approximate coverage radius used for planning visualisation, in meters */
  defaultCoverageRadiusMeters: number;
}

// ---------------------------------------------------------------------------
// Placed tower – an instance of a template positioned on a site plan
// ---------------------------------------------------------------------------

export interface PlacedTower extends Timestamps {
  id: string;
  sitePlanId: string;
  templateId: string;
  cameraConfigurations: PlacedTowerCameraConfiguration[];
  /** Pixel position on the site plan canvas */
  positionPx: PixelCoord;
  /** Rotation of the tower in degrees (0 = north / up), clockwise */
  orientationDeg: number;
  /** Display label shown on the plan, e.g. "T-01" */
  label: string;
  /**
   * Override for the coverage radius used in the visualisation.
   * Falls back to TowerTemplate.defaultCoverageRadiusMeters when undefined.
   */
  coverageRadiusMetersOverride?: number;
}
