export interface PatrolProfile {
  key: string;
  label: string;
  averageDriveToMinutes: number;
  averageControlMinutes: number;
  averageBetweenMinutes: number;
  averageReturnMinutes: number;
  typicalTimeWindow: string;
}

export interface PatrolInput {
  controlsCount: number;
  controlMinutesPerControl: number;
  driveToMinutes: number;
  betweenObjectsMinutes: number;
  returnMinutes?: number;
  weekdays?: number;
  shiftLabel?: string;
  objectsInTour?: number;
}

export interface PatrolCalculationResult {
  controlsCount: number;
  driveToMinutes: number;
  controlMinutesTotal: number;
  betweenObjectsMinutesTotal: number;
  returnMinutes: number;
  totalMinutes: number;
  totalHours: number;
  objectsInTour: number;
  shiftLabel: string;
}

const DEFAULT_PATROL_PROFILES: PatrolProfile[] = [
  {
    key: "innenstadt_kurz",
    label: "Innenstadt kurz",
    averageDriveToMinutes: 8,
    averageControlMinutes: 10,
    averageBetweenMinutes: 6,
    averageReturnMinutes: 8,
    typicalTimeWindow: "18:00-06:00",
  },
  {
    key: "mischgebiet_mittel",
    label: "Mischgebiet mittel",
    averageDriveToMinutes: 14,
    averageControlMinutes: 12,
    averageBetweenMinutes: 10,
    averageReturnMinutes: 12,
    typicalTimeWindow: "18:00-06:00",
  },
  {
    key: "aussenlage_lang",
    label: "Aussenlage lang",
    averageDriveToMinutes: 22,
    averageControlMinutes: 14,
    averageBetweenMinutes: 16,
    averageReturnMinutes: 18,
    typicalTimeWindow: "20:00-06:00",
  },
];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, minimum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.max(minimum, value);
}

export function listPatrolProfiles(): PatrolProfile[] {
  return DEFAULT_PATROL_PROFILES;
}

export function applyPatrolProfile(profileKey: string): PatrolInput {
  const profile = DEFAULT_PATROL_PROFILES.find((entry) => entry.key === profileKey) ?? DEFAULT_PATROL_PROFILES[1];
  return {
    controlsCount: 2,
    controlMinutesPerControl: profile.averageControlMinutes,
    driveToMinutes: profile.averageDriveToMinutes,
    betweenObjectsMinutes: profile.averageBetweenMinutes,
    returnMinutes: profile.averageReturnMinutes,
    weekdays: 30,
    shiftLabel: profile.typicalTimeWindow,
    objectsInTour: 1,
  };
}

export function calculatePatrolService(input: PatrolInput): PatrolCalculationResult {
  const controlsCount = Math.round(clamp(input.controlsCount, 1));
  const driveToMinutes = clamp(input.driveToMinutes, 0);
  const controlMinutesPerControl = clamp(input.controlMinutesPerControl, 1);
  const betweenObjectsMinutes = clamp(input.betweenObjectsMinutes, 0);
  const returnMinutes = clamp(input.returnMinutes ?? 0, 0);

  const controlMinutesTotal = controlsCount * controlMinutesPerControl;
  const betweenObjectsMinutesTotal = Math.max(0, controlsCount - 1) * betweenObjectsMinutes;
  const totalMinutes = driveToMinutes + controlMinutesTotal + betweenObjectsMinutesTotal + returnMinutes;

  return {
    controlsCount,
    driveToMinutes: round(driveToMinutes),
    controlMinutesTotal: round(controlMinutesTotal),
    betweenObjectsMinutesTotal: round(betweenObjectsMinutesTotal),
    returnMinutes: round(returnMinutes),
    totalMinutes: round(totalMinutes),
    totalHours: round(totalMinutes / 60),
    objectsInTour: Math.round(clamp(input.objectsInTour ?? 1, 1)),
    shiftLabel: input.shiftLabel?.trim() || "Nacht",
  };
}
