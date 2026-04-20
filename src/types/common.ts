/** ISO-8601 date-time string, e.g. "2026-04-09T10:00:00.000Z" */
export type IsoDateTimeString = string;

/** Pixel coordinate on a site plan canvas */
export interface PixelCoord {
  x: number;
  y: number;
}

/** Real-world coordinate in meters relative to plan origin */
export interface WorldCoord {
  xMeters: number;
  yMeters: number;
}

/** Fields shared by every persisted entity */
export interface Timestamps {
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}
