import type { TowerSlotCameraType } from "@/types";

export type PlannerSourceType = "image" | "pdf";
export type DayNightMode = "day" | "night";

export type CalibrationStatus = "not-calibrated" | "scale-set" | "calibrated";

export interface ReferenceLine {
  start: { x: number; y: number };
  end: { x: number; y: number };
  pixelDistance: number;
  realDistanceMeters: number;
}

export interface PlannerCalibration {
  status: CalibrationStatus;
  pixelsPerMeter: number | null;
  referenceLine: ReferenceLine | null;
  scaleDenominator: number | null;
}

export interface PlannerAsset {
  id: string;
  name: string;
  sourceType: PlannerSourceType;
  sourceDataUrl?: string;
  image: HTMLImageElement;
  width: number;
  height: number;
  calibration: PlannerCalibration;
}

export interface PlannerViewState {
  zoomLevel: number;
  position: {
    x: number;
    y: number;
  };
}

export interface PlannerPlacedTowerCameraConfiguration {
  slotId: string;
  cameraType: TowerSlotCameraType;
  active: boolean;
  customRotationDeg?: number;
  fieldOfViewDeg?: number;
  alarmRangeMeters?: number;
  detectionRangeMeters?: number;
  observationRangeMeters?: number;
}

export interface PlannerSelectedCamera {
  towerId: string;
  slotId: string;
}

export interface PlannerPlacedTower {
  id: string;
  sitePlanId: string;
  templateId: string;
  cameraConfigurations: PlannerPlacedTowerCameraConfiguration[];
  label: string;
  displayName: string;
  x: number;
  y: number;
  rotationDeg: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlannerCameraZoneDefaults {
  fieldOfViewDeg: number;
  alarmRangeMeters: number;
  detectionRangeMeters: number;
  observationRangeMeters: number;
}

const CAMERA_ZONE_DEFAULTS: Record<Exclude<TowerSlotCameraType, "none">, PlannerCameraZoneDefaults> = {
  ptz: {
    fieldOfViewDeg: 45,
    alarmRangeMeters: 40,
    detectionRangeMeters: 90,
    observationRangeMeters: 180,
  },
  bullet: {
    fieldOfViewDeg: 75,
    alarmRangeMeters: 25,
    detectionRangeMeters: 60,
    observationRangeMeters: 110,
  },
  thermal: {
    fieldOfViewDeg: 35,
    alarmRangeMeters: 80,
    detectionRangeMeters: 180,
    observationRangeMeters: 320,
  },
  dome: {
    fieldOfViewDeg: 100,
    alarmRangeMeters: 20,
    detectionRangeMeters: 45,
    observationRangeMeters: 80,
  },
};

export function getPlannerCameraZoneDefaults(
  cameraType: TowerSlotCameraType
): PlannerCameraZoneDefaults {
  if (cameraType === "none") {
    return {
      fieldOfViewDeg: 60,
      alarmRangeMeters: 15,
      detectionRangeMeters: 30,
      observationRangeMeters: 50,
    };
  }

  return CAMERA_ZONE_DEFAULTS[cameraType];
}

export function normalizePlannerCameraConfiguration(
  configuration: PlannerPlacedTowerCameraConfiguration
): PlannerPlacedTowerCameraConfiguration {
  const defaults = getPlannerCameraZoneDefaults(configuration.cameraType);
  const alarmRangeMeters = Math.max(0, configuration.alarmRangeMeters ?? defaults.alarmRangeMeters);
  const detectionRangeMeters = Math.max(
    alarmRangeMeters,
    configuration.detectionRangeMeters ?? defaults.detectionRangeMeters
  );
  const observationRangeMeters = Math.max(
    detectionRangeMeters,
    configuration.observationRangeMeters ?? defaults.observationRangeMeters
  );

  return {
    ...configuration,
    customRotationDeg: configuration.customRotationDeg ?? 0,
    fieldOfViewDeg: Math.max(5, configuration.fieldOfViewDeg ?? defaults.fieldOfViewDeg),
    alarmRangeMeters,
    detectionRangeMeters,
    observationRangeMeters,
  };
}
