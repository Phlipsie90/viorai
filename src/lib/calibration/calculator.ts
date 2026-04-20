import type { CalibrationStatus } from "@/components/planner/types";

export const CSS_PIXELS_PER_CENTIMETER = 37.7952755906;

export interface CalibrationByScaleInput {
  scaleDenominator: number;
  pixelsPerCentimeterOnPlan?: number;
}

export interface CalibrationByReferenceInput {
  pixelDistance: number;
  realDistanceMeters: number;
}

export function calculatePixelsPerMeterFromScale({
  scaleDenominator,
  pixelsPerCentimeterOnPlan = CSS_PIXELS_PER_CENTIMETER,
}: CalibrationByScaleInput): number {
  if (!Number.isFinite(scaleDenominator) || scaleDenominator <= 0) {
    throw new Error("Scale denominator must be greater than zero.");
  }

  if (!Number.isFinite(pixelsPerCentimeterOnPlan) || pixelsPerCentimeterOnPlan <= 0) {
    throw new Error("Pixels per centimeter must be greater than zero.");
  }

  const metersToCentimeters = 100;
  const centimetersOnPlanForOneMeterReal = metersToCentimeters / scaleDenominator;
  return centimetersOnPlanForOneMeterReal * pixelsPerCentimeterOnPlan;
}

export function calculatePixelsPerMeterFromReference({
  pixelDistance,
  realDistanceMeters,
}: CalibrationByReferenceInput): number {
  if (!Number.isFinite(pixelDistance) || pixelDistance <= 0) {
    throw new Error("Pixel distance must be greater than zero.");
  }

  if (!Number.isFinite(realDistanceMeters) || realDistanceMeters <= 0) {
    throw new Error("Real distance must be greater than zero.");
  }

  return pixelDistance / realDistanceMeters;
}

export function calculatePixelDistance(
  start: { x: number; y: number },
  end: { x: number; y: number }
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function getCalibrationStatusLabel(status: CalibrationStatus): string {
  if (status === "scale-set") {
    return "Maßstab gesetzt";
  }

  if (status === "calibrated") {
    return "kalibriert";
  }

  return "nicht kalibriert";
}
