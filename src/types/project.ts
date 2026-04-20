import type { Timestamps, PixelCoord } from "./common";

export type ProjectStatus = "draft" | "active" | "completed" | "cancelled";

export interface Project extends Timestamps {
  id: string;
  tenantId?: string;
  customerId: string;
  name: string;
  location: string;
  siteAddress?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  runtimeLabel?: string;
  status?: ProjectStatus;
  /** ID of the associated SitePlan, if one has been created */
  sitePlanId?: string;
}

// ---------------------------------------------------------------------------
// Site plan – the uploaded map or floor plan for a project
// ---------------------------------------------------------------------------

export type SitePlanSourceType = "image" | "pdf" | "manual";

export interface SitePlan extends Timestamps {
  id: string;
  projectId: string;
  /** Original file name of the uploaded background image */
  fileName: string;
  /** MIME type of the source file, e.g. "image/png" */
  mimeType: string;
  /** Width of the plan canvas in pixels */
  widthPx: number;
  /** Height of the plan canvas in pixels */
  heightPx: number;
  sourceType: SitePlanSourceType;
  calibration: PlanCalibration;
}

// ---------------------------------------------------------------------------
// Calibration – maps pixels to real-world meters
// ---------------------------------------------------------------------------

export interface CalibrationReferencePoint {
  /** Label shown to the user, e.g. "Punkt A" */
  label: string;
  position: PixelCoord;
}

export interface PlanCalibration {
  /** Pixels per real-world meter derived from the reference measurement */
  pixelsPerMeter: number;
  /** Known real-world distance between the two reference points in meters */
  referenceDistanceMeters: number;
  referencePointA: CalibrationReferencePoint;
  referencePointB: CalibrationReferencePoint;
}
