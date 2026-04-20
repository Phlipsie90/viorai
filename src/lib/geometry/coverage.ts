/**
 * Calculates the coverage area of a tower given its camera height and viewing angle.
 * Returns the radius in meters.
 */
export function calculateCoverageRadius(
  cameraHeightMeters: number,
  viewingAngleDeg: number
): number {
  const angleRad = (viewingAngleDeg / 2) * (Math.PI / 180);
  return cameraHeightMeters / Math.tan(angleRad);
}

/**
 * Checks if two circular coverage zones overlap.
 */
export function zonesOverlap(
  a: { x: number; y: number; radius: number },
  b: { x: number; y: number; radius: number }
): boolean {
  const distance = Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
  return distance < a.radius + b.radius;
}

/**
 * Converts pixel coordinates to real-world meters given a scale factor.
 */
export function pixelsToMeters(pixels: number, pixelsPerMeter: number): number {
  return pixels / pixelsPerMeter;
}

/**
 * Converts meters to pixel coordinates given a scale factor.
 */
export function metersToPixels(meters: number, pixelsPerMeter: number): number {
  return meters * pixelsPerMeter;
}

export interface CameraSectorGeometryInput {
  origin: { x: number; y: number };
  centerAngleDeg: number;
  fovDeg: number;
  rangeMeters: number;
  pixelsPerMeter: number;
  segments?: number;
}

export interface CameraSectorGeometry {
  points: number[];
  radiusPx: number;
  startAngleDeg: number;
  endAngleDeg: number;
}

/**
 * Creates a true sector polygon (origin + arc points + origin) in canvas coordinates.
 * Angle convention: 0deg points up (north), positive clockwise.
 */
export function getCameraSectorGeometry({
  origin,
  centerAngleDeg,
  fovDeg,
  rangeMeters,
  pixelsPerMeter,
  segments = 28,
}: CameraSectorGeometryInput): CameraSectorGeometry {
  const radiusPx = metersToPixels(rangeMeters, pixelsPerMeter);
  const safeFov = Math.max(1, Math.min(180, fovDeg));
  const startAngleDeg = centerAngleDeg - safeFov / 2;
  const endAngleDeg = centerAngleDeg + safeFov / 2;

  if (radiusPx <= 0 || !Number.isFinite(radiusPx)) {
    return {
      points: [origin.x, origin.y, origin.x, origin.y, origin.x, origin.y],
      radiusPx: 0,
      startAngleDeg,
      endAngleDeg,
    };
  }

  const arcPoints: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const angleDeg = startAngleDeg + (endAngleDeg - startAngleDeg) * t;
    const angleRad = ((angleDeg - 90) * Math.PI) / 180;
    const x = origin.x + Math.cos(angleRad) * radiusPx;
    const y = origin.y + Math.sin(angleRad) * radiusPx;
    arcPoints.push(x, y);
  }

  return {
    points: [origin.x, origin.y, ...arcPoints, origin.x, origin.y],
    radiusPx,
    startAngleDeg,
    endAngleDeg,
  };
}
