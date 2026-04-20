export interface CalibrationProfile {
  id: string;
  label: string;
  pixelsPerMeter: number;
  referenceDistanceMeters: number;
}

const DEFAULT_PIXELS_PER_METER = 10;

export function createCalibrationProfile(
  label: string,
  pixelsPerMeter: number,
  referenceDistanceMeters: number
): CalibrationProfile {
  return {
    id: crypto.randomUUID(),
    label,
    pixelsPerMeter,
    referenceDistanceMeters,
  };
}

export function getDefaultCalibration(): CalibrationProfile {
  return createCalibrationProfile("Standard", DEFAULT_PIXELS_PER_METER, 1);
}
