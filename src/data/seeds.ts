import type { CameraModel, TowerTemplate } from "@/types";

const SEED_TIMESTAMP = "2026-04-09T00:00:00.000Z";

const CAMERA_ID_PTZ = "camera.ptz";
const CAMERA_ID_DOME = "camera.dome";

const LENS_ID_PTZ_25X = "lens.ptz.optical-25x";
const LENS_ID_DOME_28 = "lens.dome.fixed-2.8mm";

const PLATFORM_ID_AUTARK_4PTZ = "platform.autark-4ptz";
const PLATFORM_ID_POWERED_4PTZ = "platform.powered-4ptz";
const PLATFORM_ID_POWERED_2PTZ_2DOME = "platform.powered-2ptz-2dome";

export const cameraModels: CameraModel[] = [
  {
    id: CAMERA_ID_PTZ,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    manufacturer: "SecureVision",
    modelName: "PTZ 25x",
    formFactor: "ptz",
    sensorType: "CMOS",
    sensorFormat: "1/2.8\"",
    resolutionMegapixels: 4,
    hasIr: true,
    irRangeMeters: 150,
    hasOnboardAnalytics: true,
    lensOptions: [
      {
        id: LENS_ID_PTZ_25X,
        label: "Motorzoom 25x (4.8-120 mm)",
        type: "motorised-zoom",
        focalLengthMinMm: 4.8,
        focalLengthMaxMm: 120,
        hFovAtMinDeg: 60,
        hFovAtMaxDeg: 2.4,
        dori: {
          day: {
            detectionMeters: 250,
            observationMeters: 130,
            recognitionMeters: 90,
            identificationMeters: 60,
          },
          night: {
            detectionMeters: 120,
            observationMeters: 80,
            recognitionMeters: 55,
            identificationMeters: 40,
          },
        },
      },
    ],
  },
  {
    id: CAMERA_ID_DOME,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    manufacturer: "SecureVision",
    modelName: "Dome 110°",
    formFactor: "dome",
    sensorType: "CMOS",
    sensorFormat: "1/2.8\"",
    resolutionMegapixels: 4,
    hasIr: true,
    irRangeMeters: 60,
    hasOnboardAnalytics: true,
    lensOptions: [
      {
        id: LENS_ID_DOME_28,
        label: "Fixed 2.8 mm (110°)",
        type: "fixed",
        focalLengthMinMm: 2.8,
        focalLengthMaxMm: 2.8,
        hFovAtMinDeg: 110,
        hFovAtMaxDeg: 110,
        dori: {
          day: {
            detectionMeters: 70,
            observationMeters: 40,
            recognitionMeters: 30,
            identificationMeters: 20,
          },
          night: {
            detectionMeters: 50,
            observationMeters: 30,
            recognitionMeters: 22,
            identificationMeters: 15,
          },
        },
      },
    ],
  },
];

export const towerTemplates: TowerTemplate[] = [
  {
    id: "tower-autark-4ptz",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    label: "Autarke Einheit (4 PTZ)",
    platformId: PLATFORM_ID_AUTARK_4PTZ,
    autark: true,
    mastHeightM: 8,
    mechanics: {
      setupTimeMinutes: 120,
      maxWindKmh: 90,
      payloadKg: 55,
    },
    pricing: {
      monthlyBaseEur: 2890,
    },
    defaultCoverageRadiusMeters: 95,
    cameraSlots: [
      {
        slotId: "autark-4ptz.slot-1",
        position: "top",
        defaultAzimuthDeg: 45,
        defaultElevationDeg: -8,
        defaultCameraModelId: CAMERA_ID_PTZ,
        defaultLensOptionId: LENS_ID_PTZ_25X,
        panTiltRange: {
          azimuthMinDeg: -180,
          azimuthMaxDeg: 180,
          elevationMinDeg: -25,
          elevationMaxDeg: 20,
        },
      },
      {
        slotId: "autark-4ptz.slot-2",
        position: "top",
        defaultAzimuthDeg: 135,
        defaultElevationDeg: -8,
        defaultCameraModelId: CAMERA_ID_PTZ,
        defaultLensOptionId: LENS_ID_PTZ_25X,
        panTiltRange: {
          azimuthMinDeg: -180,
          azimuthMaxDeg: 180,
          elevationMinDeg: -25,
          elevationMaxDeg: 20,
        },
      },
      {
        slotId: "autark-4ptz.slot-3",
        position: "top",
        defaultAzimuthDeg: 225,
        defaultElevationDeg: -8,
        defaultCameraModelId: CAMERA_ID_PTZ,
        defaultLensOptionId: LENS_ID_PTZ_25X,
        panTiltRange: {
          azimuthMinDeg: -180,
          azimuthMaxDeg: 180,
          elevationMinDeg: -25,
          elevationMaxDeg: 20,
        },
      },
      {
        slotId: "autark-4ptz.slot-4",
        position: "top",
        defaultAzimuthDeg: 315,
        defaultElevationDeg: -8,
        defaultCameraModelId: CAMERA_ID_PTZ,
        defaultLensOptionId: LENS_ID_PTZ_25X,
        panTiltRange: {
          azimuthMinDeg: -180,
          azimuthMaxDeg: 180,
          elevationMinDeg: -25,
          elevationMaxDeg: 20,
        },
      },
    ],
  },
  {
    id: "tower-powered-4ptz",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    label: "Netzgebundene Einheit (4 PTZ)",
    platformId: PLATFORM_ID_POWERED_4PTZ,
    autark: false,
    mastHeightM: 8,
    mechanics: {
      setupTimeMinutes: 90,
      maxWindKmh: 95,
      payloadKg: 60,
    },
    pricing: {
      monthlyBaseEur: 2450,
    },
    defaultCoverageRadiusMeters: 90,
    cameraSlots: [
      {
        slotId: "powered-4ptz.slot-1",
        position: "top",
        defaultAzimuthDeg: 45,
        defaultElevationDeg: -6,
        defaultCameraModelId: CAMERA_ID_PTZ,
        defaultLensOptionId: LENS_ID_PTZ_25X,
        panTiltRange: {
          azimuthMinDeg: -180,
          azimuthMaxDeg: 180,
          elevationMinDeg: -20,
          elevationMaxDeg: 25,
        },
      },
      {
        slotId: "powered-4ptz.slot-2",
        position: "top",
        defaultAzimuthDeg: 135,
        defaultElevationDeg: -6,
        defaultCameraModelId: CAMERA_ID_PTZ,
        defaultLensOptionId: LENS_ID_PTZ_25X,
        panTiltRange: {
          azimuthMinDeg: -180,
          azimuthMaxDeg: 180,
          elevationMinDeg: -20,
          elevationMaxDeg: 25,
        },
      },
      {
        slotId: "powered-4ptz.slot-3",
        position: "top",
        defaultAzimuthDeg: 225,
        defaultElevationDeg: -6,
        defaultCameraModelId: CAMERA_ID_PTZ,
        defaultLensOptionId: LENS_ID_PTZ_25X,
        panTiltRange: {
          azimuthMinDeg: -180,
          azimuthMaxDeg: 180,
          elevationMinDeg: -20,
          elevationMaxDeg: 25,
        },
      },
      {
        slotId: "powered-4ptz.slot-4",
        position: "top",
        defaultAzimuthDeg: 315,
        defaultElevationDeg: -6,
        defaultCameraModelId: CAMERA_ID_PTZ,
        defaultLensOptionId: LENS_ID_PTZ_25X,
        panTiltRange: {
          azimuthMinDeg: -180,
          azimuthMaxDeg: 180,
          elevationMinDeg: -20,
          elevationMaxDeg: 25,
        },
      },
    ],
  },
  {
    id: "tower-powered-2ptz-2dome",
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    label: "Netzgebundene Einheit (2 PTZ + 2 Dome)",
    platformId: PLATFORM_ID_POWERED_2PTZ_2DOME,
    autark: false,
    mastHeightM: 8,
    mechanics: {
      setupTimeMinutes: 90,
      maxWindKmh: 90,
      payloadKg: 58,
    },
    pricing: {
      monthlyBaseEur: 2150,
    },
    defaultCoverageRadiusMeters: 78,
    cameraSlots: [
      {
        slotId: "powered-2ptz-2dome.slot-ptz-1",
        position: "top",
        defaultAzimuthDeg: 45,
        defaultElevationDeg: -8,
        defaultCameraModelId: CAMERA_ID_PTZ,
        defaultLensOptionId: LENS_ID_PTZ_25X,
        panTiltRange: {
          azimuthMinDeg: -180,
          azimuthMaxDeg: 180,
          elevationMinDeg: -25,
          elevationMaxDeg: 20,
        },
      },
      {
        slotId: "powered-2ptz-2dome.slot-dome-1",
        position: "mid",
        defaultAzimuthDeg: 135,
        defaultElevationDeg: -8,
        defaultCameraModelId: CAMERA_ID_DOME,
        defaultLensOptionId: LENS_ID_DOME_28,
        panTiltRange: {
          azimuthMinDeg: 90,
          azimuthMaxDeg: 180,
          elevationMinDeg: -25,
          elevationMaxDeg: 10,
        },
      },
      {
        slotId: "powered-2ptz-2dome.slot-ptz-2",
        position: "top",
        defaultAzimuthDeg: 225,
        defaultElevationDeg: -8,
        defaultCameraModelId: CAMERA_ID_PTZ,
        defaultLensOptionId: LENS_ID_PTZ_25X,
        panTiltRange: {
          azimuthMinDeg: -180,
          azimuthMaxDeg: 180,
          elevationMinDeg: -25,
          elevationMaxDeg: 20,
        },
      },
      {
        slotId: "powered-2ptz-2dome.slot-dome-2",
        position: "mid",
        defaultAzimuthDeg: 315,
        defaultElevationDeg: -10,
        defaultCameraModelId: CAMERA_ID_DOME,
        defaultLensOptionId: LENS_ID_DOME_28,
        panTiltRange: {
          azimuthMinDeg: -180,
          azimuthMaxDeg: -90,
          elevationMinDeg: -25,
          elevationMaxDeg: 10,
        },
      },
    ],
  },
];
