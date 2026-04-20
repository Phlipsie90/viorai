"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Group, Image as KonvaImage, Rect, Text, Line, Circle } from "react-konva";
import type { TowerSlotCameraType, TowerTemplate } from "@/types";
import { getCameraSectorGeometry } from "@/lib/geometry/coverage";
import type {
  DayNightMode,
  PlannerAsset,
  PlannerPlacedTowerCameraConfiguration,
  PlannerPlacedTower,
  PlannerSelectedCamera,
  PlannerViewState,
} from "./types";
import { normalizePlannerCameraConfiguration } from "./types";

interface PlannerCanvasProps {
  currentPlan: PlannerAsset | null;
  viewState: PlannerViewState;
  onViewStateChange: (nextState: PlannerViewState) => void;
  isMeasuring: boolean;
  measurePoints: Array<{ x: number; y: number }>;
  onMeasurePoint: (point: { x: number; y: number }) => void;
  selectedTowerTemplate: TowerTemplate | null;
  isPlacementModeActive: boolean;
  towerTemplates: TowerTemplate[];
  placedTowers: PlannerPlacedTower[];
  dayNightMode: DayNightMode;
  selectedTowerId: string | null;
  selectedCamera: PlannerSelectedCamera | null;
  onPlaceTower: (point: { x: number; y: number }) => void;
  onMoveTower: (towerId: string, x: number, y: number) => void;
  onRotateTower: (towerId: string, rotationDeg: number) => void;
  onSelectCamera: (selectedCamera: PlannerSelectedCamera | null) => void;
  updateTowerCameraRotation: (towerId: string, slotId: string, customRotationDeg: number) => void;
  onUpdateTowerCameraConfiguration: (
    towerId: string,
    slotId: string,
    patch: Partial<PlannerPlacedTowerCameraConfiguration>
  ) => void;
  onSelectTower: (towerId: string) => void;
  onClearTowerSelection: () => void;
  snapshotRequestId: number;
  onSnapshotCaptured: (dataUrl: string | null) => void;
  resetCounter: number;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const SCALE_FACTOR = 1.05;
const MANUAL_RANGE_SCALE = 2.4;

export default function PlannerCanvas({
  currentPlan,
  viewState,
  onViewStateChange,
  isMeasuring,
  measurePoints,
  onMeasurePoint,
  selectedTowerTemplate,
  isPlacementModeActive,
  towerTemplates,
  placedTowers,
  dayNightMode,
  selectedTowerId,
  selectedCamera,
  onPlaceTower,
  onMoveTower,
  onRotateTower,
  onSelectCamera,
  updateTowerCameraRotation,
  onUpdateTowerCameraConfiguration,
  onSelectTower,
  onClearTowerSelection,
  snapshotRequestId,
  onSnapshotCaptured,
  resetCounter,
}: PlannerCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<import("konva/lib/Stage").Stage | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 500 });
  const [draggingCamera, setDraggingCamera] = useState<PlannerSelectedCamera | null>(null);
  const [draggingRangeHandle, setDraggingRangeHandle] = useState<{
    towerId: string;
    slotId: string;
    rangeKey: "alarmRangeMeters" | "detectionRangeMeters" | "observationRangeMeters";
  } | null>(null);

  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      setStageSize({
        width: containerEl.clientWidth,
        height: containerEl.clientHeight,
      });
    });

    resizeObserver.observe(containerEl);
    setStageSize({
      width: containerEl.clientWidth,
      height: containerEl.clientHeight,
    });

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!currentPlan) {
      return;
    }

    const fittedScale = Math.min(
      stageSize.width / currentPlan.width,
      stageSize.height / currentPlan.height,
      1
    );

    const centerX = (stageSize.width - currentPlan.width * fittedScale) / 2;
    const centerY = (stageSize.height - currentPlan.height * fittedScale) / 2;

    onViewStateChange({
      zoomLevel: Number(fittedScale.toFixed(3)),
      position: { x: centerX, y: centerY },
    });
  }, [currentPlan, resetCounter, stageSize.height, stageSize.width, onViewStateChange]);

  const handleWheel = (event: { evt: WheelEvent; target: { getStage: () => import("konva/lib/Stage").Stage | null } }) => {
    event.evt.preventDefault();

    const stage = event.target.getStage();
    if (!stage) {
      return;
    }

    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return;
    }

    const oldScale = viewState.zoomLevel;
    const mousePointTo = {
      x: (pointer.x - viewState.position.x) / oldScale,
      y: (pointer.y - viewState.position.y) / oldScale,
    };

    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const nextScale = direction > 0 ? oldScale * SCALE_FACTOR : oldScale / SCALE_FACTOR;
    const clampedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));

    const nextPosition = {
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    };

    onViewStateChange({
      zoomLevel: Number(clampedScale.toFixed(3)),
      position: nextPosition,
    });
  };

  const handleStageDragEnd = (event: { target: { x: () => number; y: () => number } }) => {
    onViewStateChange({
      zoomLevel: viewState.zoomLevel,
      position: {
        x: event.target.x(),
        y: event.target.y(),
      },
    });
  };

  const handleStageClick = (event: { target: PlannerNodeTarget }) => {
    const stage = event.target.getStage();
    if (!stage) {
      return;
    }

    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return;
    }

    if (hasCameraTarget(event.target) || hasTowerTarget(event.target)) {
      return;
    }

    onSelectCamera(null);
    onClearTowerSelection();

    const localX = (pointer.x - viewState.position.x) / viewState.zoomLevel;
    const localY = (pointer.y - viewState.position.y) / viewState.zoomLevel;

    const nextPoint = currentPlan
      ? {
          x: Math.min(Math.max(localX, 0), currentPlan.width),
          y: Math.min(Math.max(localY, 0), currentPlan.height),
        }
      : {
          x: localX,
          y: localY,
        };

    if (isMeasuring) {
      onMeasurePoint(nextPoint);
      return;
    }

    if (!isPlacementModeActive) {
      return;
    }

    if (selectedTowerTemplate) {
      onPlaceTower(nextPoint);
    }
  };

  const templateById = useMemo(() => {
    return new Map(towerTemplates.map((template) => [template.id, template]));
  }, [towerTemplates]);

  const handleStageMouseMove = useCallback(() => {
    const effectivePixelsPerMeter = currentPlan?.calibration.pixelsPerMeter ?? MANUAL_RANGE_SCALE;

    if (draggingRangeHandle) {
      const stage = stageRef.current;
      if (!stage) {
        return;
      }

      const pointer = stage.getPointerPosition();
      if (!pointer) {
        return;
      }

      const localPointer = {
        x: (pointer.x - viewState.position.x) / viewState.zoomLevel,
        y: (pointer.y - viewState.position.y) / viewState.zoomLevel,
      };

      const tower = placedTowers.find((entry) => entry.id === draggingRangeHandle.towerId);
      if (!tower) {
        return;
      }

      const distancePx = Math.hypot(localPointer.x - tower.x, localPointer.y - tower.y);
      const nextRangeMeters = Math.max(1, Number((distancePx / effectivePixelsPerMeter).toFixed(1)));

      onUpdateTowerCameraConfiguration(tower.id, draggingRangeHandle.slotId, {
        [draggingRangeHandle.rangeKey]: nextRangeMeters,
      });
      return;
    }

    if (!draggingCamera) {
      return;
    }

    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return;
    }

    const localPointer = {
      x: (pointer.x - viewState.position.x) / viewState.zoomLevel,
      y: (pointer.y - viewState.position.y) / viewState.zoomLevel,
    };

    const tower = placedTowers.find((entry) => entry.id === draggingCamera.towerId);
    if (!tower) {
      return;
    }

    const template = templateById.get(tower.templateId);
    if (!template) {
      return;
    }

    const slot = template.cameraSlots.find((entry) => entry.slotId === draggingCamera.slotId);
    if (!slot) {
      return;
    }

    const angle = Math.atan2(localPointer.y - tower.y, localPointer.x - tower.x);
    const deg = normalizeAngle(angle * (180 / Math.PI) + 90);
    const slotDefaultRotationDeg = getSlotDefaultRotationDeg(slot);
    const customRotationDeg = normalizeSignedDeg(
      deg - (tower.rotationDeg + slotDefaultRotationDeg)
    );

    updateTowerCameraRotation(tower.id, slot.slotId, customRotationDeg);
  }, [
    currentPlan?.calibration.pixelsPerMeter,
    draggingCamera,
    draggingRangeHandle,
    onUpdateTowerCameraConfiguration,
    placedTowers,
    templateById,
    updateTowerCameraRotation,
    viewState.position.x,
    viewState.position.y,
    viewState.zoomLevel,
  ]);

  const handleStageMouseUp = useCallback(() => {
    if (draggingCamera) {
      setDraggingCamera(null);
    }
    if (draggingRangeHandle) {
      setDraggingRangeHandle(null);
    }
  }, [draggingCamera, draggingRangeHandle]);

  useEffect(() => {
    if (snapshotRequestId === 0) {
      return;
    }

    const stage = stageRef.current;
    if (!stage) {
      onSnapshotCaptured(null);
      return;
    }

    try {
      const dataUrl = stage.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
      onSnapshotCaptured(dataUrl);
    } catch {
      onSnapshotCaptured(null);
    }
  }, [snapshotRequestId, onSnapshotCaptured]);

  return (
    <div ref={containerRef} className="flex-1 rounded-lg border border-slate-200 relative overflow-hidden min-h-96">
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-1">
        <div
          className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${
            currentPlan?.calibration.pixelsPerMeter
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-amber-300 bg-amber-50 text-amber-700"
          }`}
        >
          {currentPlan?.calibration.pixelsPerMeter
            ? `Kalibrierung aktiv (${currentPlan.calibration.pixelsPerMeter.toFixed(2)} px/m)`
            : "Ohne Kalibrierung: manuelle Planungswerte aktiv"}
        </div>
        {isPlacementModeActive && (
          <div className="inline-flex items-center rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
            Platzierungsmodus aktiv
          </div>
        )}
      </div>
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        onWheel={handleWheel}
        onClick={handleStageClick}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        draggable={!isMeasuring && !draggingCamera && !draggingRangeHandle}
        x={viewState.position.x}
        y={viewState.position.y}
        scaleX={viewState.zoomLevel}
        scaleY={viewState.zoomLevel}
        onDragEnd={handleStageDragEnd}
      >
        <Layer listening={false}>
          {currentPlan && (
            <KonvaImage
              image={currentPlan.image}
              x={0}
              y={0}
              width={currentPlan.width}
              height={currentPlan.height}
            />
          )}
        </Layer>

        <Layer listening={false}>
          {currentPlan && (
            <Rect
              x={0}
              y={0}
              width={currentPlan.width}
              height={currentPlan.height}
              stroke="#3b82f6"
              strokeWidth={1}
            />
          )}
          {measurePoints.length >= 1 && (
            <Circle x={measurePoints[0].x} y={measurePoints[0].y} radius={5} fill="#0ea5e9" />
          )}
          {measurePoints.length >= 2 && (
            <>
              <Line
                points={[
                  measurePoints[0].x,
                  measurePoints[0].y,
                  measurePoints[1].x,
                  measurePoints[1].y,
                ]}
                stroke="#0ea5e9"
                strokeWidth={2}
              />
              <Circle x={measurePoints[1].x} y={measurePoints[1].y} radius={5} fill="#0ea5e9" />
            </>
          )}
        </Layer>

        <Layer>
          {placedTowers.map((tower) => {
            const towerTemplate = templateById.get(tower.templateId);
            if (!towerTemplate) {
              return null;
            }

            return (
              <TowerNode
                key={tower.id}
                tower={tower}
                template={towerTemplate}
                pixelsPerMeter={currentPlan?.calibration.pixelsPerMeter ?? null}
                dayNightMode={dayNightMode}
                isSelected={selectedTowerId === tower.id}
                selectedCamera={selectedCamera}
                onMoveTower={onMoveTower}
                onRotateTower={onRotateTower}
                onSelectCamera={onSelectCamera}
                onStartCameraRotationDrag={(towerId, slotId) => {
                  onSelectCamera({ towerId, slotId });
                  onSelectTower(towerId);
                  setDraggingCamera({ towerId, slotId });
                }}
                onStartCameraRangeDrag={(towerId, slotId, rangeKey) => {
                  onSelectCamera({ towerId, slotId });
                  onSelectTower(towerId);
                  setDraggingRangeHandle({ towerId, slotId, rangeKey });
                }}
                onSelectTower={onSelectTower}
              />
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}

function TowerNode({
  tower,
  template,
  pixelsPerMeter,
  dayNightMode: _dayNightMode,
  isSelected,
  selectedCamera,
  onMoveTower,
  onRotateTower,
  onSelectCamera,
  onStartCameraRotationDrag,
  onStartCameraRangeDrag,
  onSelectTower,
}: {
  tower: PlannerPlacedTower;
  template: TowerTemplate;
  pixelsPerMeter: number | null;
  dayNightMode: DayNightMode;
  isSelected: boolean;
  selectedCamera: PlannerSelectedCamera | null;
  onMoveTower: (towerId: string, x: number, y: number) => void;
  onRotateTower: (towerId: string, rotationDeg: number) => void;
  onSelectCamera: (selectedCamera: PlannerSelectedCamera | null) => void;
  onStartCameraRotationDrag: (towerId: string, slotId: string) => void;
  onStartCameraRangeDrag: (
    towerId: string,
    slotId: string,
    rangeKey: "alarmRangeMeters" | "detectionRangeMeters" | "observationRangeMeters"
  ) => void;
  onSelectTower: (towerId: string) => void;
}) {
  const towerSize = 28;
  const effectivePixelsPerMeter = pixelsPerMeter ?? MANUAL_RANGE_SCALE;
  const activeCameraCount = template.cameraSlots.reduce((count, slot) => {
    const cameraConfiguration = getPlacedCameraConfiguration(tower, slot);
    return cameraConfiguration.active && cameraConfiguration.cameraType !== "none"
      ? count + 1
      : count;
  }, 0);

  const handleDragEnd = (event: { target: { x: () => number; y: () => number } }) => {
    onMoveTower(tower.id, event.target.x(), event.target.y());
  };

  const handleRotateClick = () => {
    const next = (tower.rotationDeg + 15) % 360;
    onRotateTower(tower.id, next);
  };

  const handleSelect = (event: { evt: { cancelBubble: boolean } }) => {
    event.evt.cancelBubble = true;
    onSelectTower(tower.id);
  };

  return (
    <Group
      name="tower-node"
      x={tower.x}
      y={tower.y}
      rotation={tower.rotationDeg}
      draggable
      onClick={handleSelect}
      onDragEnd={handleDragEnd}
    >
      {template.cameraSlots.map((slot) => {
          const cameraConfiguration = getPlacedCameraConfiguration(tower, slot);
          if (!cameraConfiguration.active) {
            return null;
          }

          if (cameraConfiguration.cameraType === "none") {
            return null;
          }

          const centerAngleDeg = normalizeAngle(
            getSlotDefaultRotationDeg(slot) + (cameraConfiguration.customRotationDeg ?? 0)
          );
          const isCameraSelected =
            selectedCamera?.towerId === tower.id && selectedCamera.slotId === slot.slotId;
          const fieldOfViewDeg = cameraConfiguration.fieldOfViewDeg ?? 45;
          const alarmRangeMeters = cameraConfiguration.alarmRangeMeters ?? 0;
          const detectionRangeMeters = cameraConfiguration.detectionRangeMeters ?? alarmRangeMeters;
          const observationRangeMeters = cameraConfiguration.observationRangeMeters ?? detectionRangeMeters;
          const baseRadians = ((centerAngleDeg - 90) * Math.PI) / 180;
          const alarmHandleDistancePx = Math.max(alarmRangeMeters * effectivePixelsPerMeter, towerSize / 2 + 24);
          const detectionHandleDistancePx = Math.max(
            detectionRangeMeters * effectivePixelsPerMeter,
            towerSize / 2 + 32
          );
          const observationHandleDistancePx = Math.max(
            observationRangeMeters * effectivePixelsPerMeter,
            towerSize / 2 + 40
          );

          const observationGeometry = getCameraSectorGeometry({
            origin: { x: 0, y: 0 },
            centerAngleDeg,
            fovDeg: fieldOfViewDeg,
            rangeMeters: observationRangeMeters,
            pixelsPerMeter: effectivePixelsPerMeter,
          });

          const detectionGeometry = getCameraSectorGeometry({
            origin: { x: 0, y: 0 },
            centerAngleDeg,
            fovDeg: fieldOfViewDeg,
            rangeMeters: detectionRangeMeters,
            pixelsPerMeter: effectivePixelsPerMeter,
          });

          const alarmGeometry = getCameraSectorGeometry({
            origin: { x: 0, y: 0 },
            centerAngleDeg,
            fovDeg: fieldOfViewDeg,
            rangeMeters: alarmRangeMeters,
            pixelsPerMeter: effectivePixelsPerMeter,
          });

          return (
            <Group
              key={`${tower.id}-${slot.slotId}`}
              name="camera-target"
              onClick={(event) => {
                event.cancelBubble = true;
                onSelectTower(tower.id);
                onSelectCamera({ towerId: tower.id, slotId: slot.slotId });
              }}
              onMouseDown={(event) => {
                event.cancelBubble = true;
                onStartCameraRotationDrag(tower.id, slot.slotId);
              }}
            >
              <Line
                points={observationGeometry.points}
                closed
                fill={isCameraSelected ? "rgba(34, 197, 94, 0.32)" : "rgba(34, 197, 94, 0.24)"}
                stroke={isCameraSelected ? "rgba(21, 128, 61, 1)" : "rgba(21, 128, 61, 0.72)"}
                strokeWidth={isCameraSelected ? 3.25 : 2.25}
              />
              <Line
                points={detectionGeometry.points}
                closed
                fill={isCameraSelected ? "rgba(250, 204, 21, 0.34)" : "rgba(250, 204, 21, 0.26)"}
                stroke={isCameraSelected ? "rgba(202, 138, 4, 1)" : "rgba(202, 138, 4, 0.78)"}
                strokeWidth={isCameraSelected ? 3.5 : 2.5}
              />
              <Line
                points={alarmGeometry.points}
                closed
                fill={isCameraSelected ? "rgba(239, 68, 68, 0.42)" : "rgba(239, 68, 68, 0.32)"}
                stroke={isCameraSelected ? "rgba(220, 38, 38, 1)" : "rgba(185, 28, 28, 0.84)"}
                strokeWidth={isCameraSelected ? 3.75 : 2.75}
              />
              {isCameraSelected && (
                <>
                  <Circle
                    x={Math.cos(baseRadians) * observationHandleDistancePx}
                    y={Math.sin(baseRadians) * observationHandleDistancePx}
                    radius={8}
                    fill="rgba(34, 197, 94, 0.95)"
                    stroke="#ffffff"
                    strokeWidth={2}
                    name="camera-target"
                    onMouseDown={(event) => {
                      event.cancelBubble = true;
                      onStartCameraRangeDrag(tower.id, slot.slotId, "observationRangeMeters");
                    }}
                  />
                  <Circle
                    x={Math.cos(baseRadians) * detectionHandleDistancePx}
                    y={Math.sin(baseRadians) * detectionHandleDistancePx}
                    radius={8}
                    fill="rgba(250, 204, 21, 0.95)"
                    stroke="#ffffff"
                    strokeWidth={2}
                    name="camera-target"
                    onMouseDown={(event) => {
                      event.cancelBubble = true;
                      onStartCameraRangeDrag(tower.id, slot.slotId, "detectionRangeMeters");
                    }}
                  />
                  <Circle
                    x={Math.cos(baseRadians) * alarmHandleDistancePx}
                    y={Math.sin(baseRadians) * alarmHandleDistancePx}
                    radius={8}
                    fill="rgba(239, 68, 68, 0.95)"
                    stroke="#ffffff"
                    strokeWidth={2}
                    name="camera-target"
                    onMouseDown={(event) => {
                      event.cancelBubble = true;
                      onStartCameraRangeDrag(tower.id, slot.slotId, "alarmRangeMeters");
                    }}
                  />
                </>
              )}
            </Group>
          );
        })}

      <Circle
        name="tower-node"
        x={0}
        y={-30}
        radius={9}
        fill={isSelected ? "#1e3a8a" : "#0f172a"}
        stroke={isSelected ? "#22d3ee" : "#38bdf8"}
        strokeWidth={1}
        onClick={handleRotateClick}
      />
      <Text
        x={-4}
        y={-35}
        text="R"
        fill="#e2e8f0"
        fontSize={10}
        listening={false}
      />

      <Line
        points={[0, 0, 0, -22]}
        stroke="#1e3a8a"
        strokeWidth={2}
      />

      {template.cameraSlots.map((slot) => {
        const cameraConfiguration = getPlacedCameraConfiguration(tower, slot);
        if (!cameraConfiguration.active || cameraConfiguration.cameraType === "none") {
          return null;
        }

        const markerRotationDeg = normalizeAngle(
          getSlotDefaultRotationDeg(slot) + (cameraConfiguration.customRotationDeg ?? 0)
        );
        const radians = ((markerRotationDeg - 90) * Math.PI) / 180;
        const isCameraSelected =
          selectedCamera?.towerId === tower.id && selectedCamera.slotId === slot.slotId;
        const anchorRadius = towerSize / 2 + 3;
        const handleRadius = isCameraSelected ? 10 : 8;
        const handleDistance = towerSize / 2 + 16 + (isCameraSelected ? 3 : 0);
        const anchorX = Math.cos(radians) * anchorRadius;
        const anchorY = Math.sin(radians) * anchorRadius;
        const handleX = Math.cos(radians) * handleDistance;
        const handleY = Math.sin(radians) * handleDistance;
        const markerColor = getCameraMarkerColor(cameraConfiguration.cameraType, cameraConfiguration.active);
        const markerToken = getCameraMarkerToken(cameraConfiguration.cameraType);

        return (
          <Group
            key={`${tower.id}-${slot.slotId}`}
            name="camera-target"
            onClick={(event) => {
              event.cancelBubble = true;
              onSelectTower(tower.id);
              onSelectCamera({ towerId: tower.id, slotId: slot.slotId });
            }}
            onMouseDown={(event) => {
              event.cancelBubble = true;
              onStartCameraRotationDrag(tower.id, slot.slotId);
            }}
          >
            <Line
              points={[anchorX, anchorY, handleX, handleY]}
              stroke={isCameraSelected ? markerColor : `${markerColor}CC`}
              strokeWidth={isCameraSelected ? 2.5 : 1.75}
            />
            <Circle
              x={anchorX}
              y={anchorY}
              radius={3.5}
              fill={markerColor}
              stroke="#ffffff"
              strokeWidth={1}
            />
            <Circle
              x={handleX}
              y={handleY}
              radius={handleRadius + 6}
              fill="rgba(255,255,255,0.01)"
            />
            <Circle
              x={handleX}
              y={handleY}
              radius={handleRadius}
              fill={isCameraSelected ? markerColor : "#ffffff"}
              stroke={markerColor}
              strokeWidth={isCameraSelected ? 3 : 2}
            />
            <Text
              x={handleX - 4}
              y={handleY - 4.5}
              text={markerToken}
              fontSize={9}
              fontStyle="bold"
              fill={isCameraSelected ? "#ffffff" : markerColor}
              listening={false}
            />
          </Group>
        );
      })}

      <Circle
        x={0}
        y={0}
        radius={towerSize / 2}
        fill={isSelected ? "#0f172a" : "#1d4ed8"}
        stroke={isSelected ? "#22d3ee" : "#eff6ff"}
        strokeWidth={isSelected ? 3 : 2}
        name="tower-node"
      />
      {isSelected && (
        <Circle
          x={0}
          y={0}
          radius={towerSize / 2 + 6}
          stroke="#22d3ee"
          strokeWidth={1.5}
          dash={[4, 3]}
          listening={false}
        />
      )}
      {activeCameraCount > 0 && (
        <Group listening={false}>
          <Circle
            x={towerSize / 2 + 10}
            y={-towerSize / 2 - 6}
            radius={9}
            fill="#ffffff"
            stroke="#0f172a"
            strokeWidth={1.5}
          />
          <Text
            x={towerSize / 2 + 5.5}
            y={-towerSize / 2 - 10.5}
            text={String(activeCameraCount)}
            fontSize={10}
            fontStyle="bold"
            fill="#0f172a"
          />
        </Group>
      )}
      <Text
        x={-24}
        y={18}
        text={tower.displayName}
        fontSize={11}
        fill="#0f172a"
        listening={false}
      />
    </Group>
  );
}

function getCameraMarkerColor(cameraType: TowerSlotCameraType, active: boolean): string {
  if (!active || cameraType === "none") {
    return "#94a3b8";
  }

  switch (cameraType) {
    case "ptz":
      return "#2563eb";
    case "bullet":
      return "#0f766e";
    case "dome":
      return "#7c3aed";
    case "thermal":
      return "#b91c1c";
    default:
      return "#2563eb";
  }
}

function getCameraMarkerToken(cameraType: TowerSlotCameraType): string {
  switch (cameraType) {
    case "ptz":
      return "P";
    case "bullet":
      return "B";
    case "dome":
      return "D";
    case "thermal":
      return "T";
    default:
      return "?";
  }
}

function normalizeAngle(angleDeg: number): number {
  let next = angleDeg % 360;
  if (next < 0) {
    next += 360;
  }
  return next;
}

function normalizeSignedDeg(angleDeg: number): number {
  let next = angleDeg % 360;
  if (next > 180) {
    next -= 360;
  }
  if (next < -180) {
    next += 360;
  }
  return next;
}

function getSlotDefaultRotationDeg(slot: TowerTemplate["cameraSlots"][number]): number {
  return slot.defaultRotationDeg ?? slot.defaultAzimuthDeg;
}

function resolveSlotCameraType(slot: TowerTemplate["cameraSlots"][number]): TowerSlotCameraType {
  if (slot.cameraType) {
    return slot.cameraType;
  }

  const legacyModel = slot.defaultCameraModelId?.toLowerCase() ?? "";
  if (legacyModel.includes("thermal")) {
    return "thermal";
  }
  if (legacyModel.includes("bullet")) {
    return "bullet";
  }
  if (legacyModel.includes("dome")) {
    return "dome";
  }
  if (legacyModel.includes("ptz")) {
    return "ptz";
  }

  return "none";
}

function getPlacedCameraConfiguration(
  tower: PlannerPlacedTower,
  slot: TowerTemplate["cameraSlots"][number]
) : PlannerPlacedTowerCameraConfiguration {
  const configured = tower.cameraConfigurations.find((entry) => entry.slotId === slot.slotId);
  return normalizePlannerCameraConfiguration(
    configured ?? {
      slotId: slot.slotId,
      cameraType: resolveSlotCameraType(slot),
      active: slot.isActive !== false,
      customRotationDeg: 0,
    }
  );
}

interface PlannerNodeTarget {
  getStage: () => import("konva/lib/Stage").Stage | null;
  hasName: (name: string) => boolean;
  getParent: () => PlannerNodeTarget | null;
}

function hasTowerTarget(target: PlannerNodeTarget): boolean {
  if (target.hasName("tower-node")) {
    return true;
  }

  const parent = target.getParent();
  if (!parent) {
    return false;
  }

  return hasTowerTarget(parent);
}

function hasCameraTarget(target: PlannerNodeTarget): boolean {
  if (target.hasName("camera-target")) {
    return true;
  }

  const parent = target.getParent();
  if (!parent) {
    return false;
  }

  return hasCameraTarget(parent);
}
