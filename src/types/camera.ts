import type { Timestamps } from "./common";

// ---------------------------------------------------------------------------
// DORI – EN 62676-4 standard range categories
// Each value is the maximum effective distance in meters.
// ---------------------------------------------------------------------------

/**
 * Detection   – can determine that an object is present in the scene.
 * Observation – can observe the behaviour of a subject.
 * Recognition – can recognise a familiar person.
 * Identification – can identify a person or object with certainty.
 */
export interface DoriRange {
  detectionMeters: number;
  observationMeters: number;
  recognitionMeters: number;
  identificationMeters: number;
}

/** Day and night DORI performance for a specific lens/focal-length configuration */
export interface DoriProfile {
  day: DoriRange;
  night: DoriRange;
}

// ---------------------------------------------------------------------------
// Lens configuration
// ---------------------------------------------------------------------------

export type LensType = "fixed" | "varifocal" | "motorised-zoom";

export interface LensOption {
  id: string;
  label: string;
  type: LensType;
  /** Minimum focal length in mm */
  focalLengthMinMm: number;
  /** Maximum focal length in mm – same as min for fixed lenses */
  focalLengthMaxMm: number;
  /** Horizontal field of view in degrees at minimum focal length */
  hFovAtMinDeg: number;
  /** Horizontal field of view in degrees at maximum focal length */
  hFovAtMaxDeg: number;
  dori: DoriProfile;
}

// ---------------------------------------------------------------------------
// Camera model
// ---------------------------------------------------------------------------

export type SensorType = "CMOS" | "CCD";
export type SensorFormat = "1/4\"" | "1/3\"" | "1/2.8\"" | "1/2\"" | "1/1.8\"" | "1\"";
export type CameraFormFactor = "box" | "bullet" | "dome" | "ptz";

export interface CameraModel extends Timestamps {
  id: string;
  manufacturer: string;
  modelName: string;
  formFactor: CameraFormFactor;
  sensorType: SensorType;
  sensorFormat: SensorFormat;
  resolutionMegapixels: number;
  /** Whether the camera supports IR illumination */
  hasIr: boolean;
  /** Maximum IR range in meters; undefined if hasIr is false */
  irRangeMeters?: number;
  /** Whether the camera has built-in analytics (object detection, loitering, etc.) */
  hasOnboardAnalytics: boolean;
  /** Supported lens configurations with their DORI ranges */
  lensOptions: LensOption[];
}
