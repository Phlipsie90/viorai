"use client";

import { getCalibrationStatusLabel } from "@/lib/calibration/calculator";
import type { TowerTemplate } from "@/types";
import type {
  DayNightMode,
  PlannerCalibration,
  PlannerPlacedTowerCameraConfiguration,
  PlannerSelectedCamera,
} from "./types";
import { getPlannerCameraZoneDefaults, normalizePlannerCameraConfiguration } from "./types";

interface PlannerToolbarProps {
  zoomLevel: number;
  planLabel: string;
  calibration: PlannerCalibration | null;
  scaleDenominatorInput: string;
  referenceMetersInput: string;
  measuredPixelDistance: number | null;
  isMeasuring: boolean;
  towerTemplates: TowerTemplate[];
  selectedTowerTemplateId: string | null;
  placedTowerCount: number;
  dayNightMode: DayNightMode;
  customerName: string;
  projectName: string;
  durationMonths: number;
  isPdfGenerating: boolean;
  isQuoteSaving: boolean;
  selectedTower: {
    id: string;
    displayName: string;
    x: number;
    y: number;
    rotationDeg: number;
    cameraConfigurations: PlannerPlacedTowerCameraConfiguration[];
    templateLabel: string;
  } | null;
  selectedCamera: PlannerSelectedCamera | null;
  selectedTowerTemplate: TowerTemplate | null;
  onResetView: () => void;
  onScaleDenominatorInputChange: (value: string) => void;
  onReferenceMetersInputChange: (value: string) => void;
  onApplyScale: () => void;
  onToggleMeasuring: () => void;
  onApplyReferenceDistance: () => void;
  onSelectTowerTemplate: (templateId: string) => void;
  onDayNightModeChange: (mode: DayNightMode) => void;
  onCustomerNameChange: (value: string) => void;
  onProjectNameChange: (value: string) => void;
  onDurationMonthsChange: (value: number) => void;
  onDownloadPdf: () => void;
  onSaveQuote: () => void;
  onRemoveSelectedTower: () => void;
  onSelectCamera: (towerId: string, slotId: string) => void;
  onSetTowerCameraCustomRotation: (towerId: string, slotId: string, customRotationDeg: number) => void;
  onSetTowerCameraActive: (towerId: string, slotId: string, active: boolean) => void;
  onUpdateTowerCameraConfiguration: (
    towerId: string,
    slotId: string,
    patch: Partial<PlannerPlacedTowerCameraConfiguration>
  ) => void;
  showOfferSection?: boolean;
}

export default function PlannerToolbar({
  zoomLevel,
  planLabel,
  calibration,
  scaleDenominatorInput,
  referenceMetersInput,
  measuredPixelDistance,
  isMeasuring,
  towerTemplates,
  selectedTowerTemplateId,
  placedTowerCount,
  dayNightMode,
  customerName,
  projectName,
  durationMonths,
  isPdfGenerating,
  isQuoteSaving,
  selectedTower,
  selectedCamera,
  selectedTowerTemplate,
  onResetView,
  onScaleDenominatorInputChange,
  onReferenceMetersInputChange,
  onApplyScale,
  onToggleMeasuring,
  onApplyReferenceDistance,
  onSelectTowerTemplate,
  onDayNightModeChange,
  onCustomerNameChange,
  onProjectNameChange,
  onDurationMonthsChange,
  onDownloadPdf,
  onSaveQuote,
  onRemoveSelectedTower,
  onSelectCamera,
  onSetTowerCameraCustomRotation,
  onSetTowerCameraActive,
  onUpdateTowerCameraConfiguration,
  showOfferSection = true,
}: PlannerToolbarProps) {
  const hasCalibration = Boolean(
    calibration?.pixelsPerMeter && Number.isFinite(calibration.pixelsPerMeter) && calibration.pixelsPerMeter > 0
  );

  return (
    <aside className="w-56 shrink-0 bg-white rounded-lg border border-slate-200 p-4 flex flex-col gap-4">
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Plan</p>
        <p className="text-xs text-slate-600 break-words">{planLabel}</p>
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Ansicht</p>
        <p className="text-sm text-slate-700">Zoom: {(zoomLevel * 100).toFixed(0)}%</p>
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Kalibrierung</p>
        <p className="text-sm text-slate-700">
          Status: {getCalibrationStatusLabel(calibration?.status ?? "not-calibrated")}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          px/m: {calibration?.pixelsPerMeter ? calibration.pixelsPerMeter.toFixed(2) : "-"}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block">
          Maßstab 1 : X
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={scaleDenominatorInput}
            onChange={(event) => onScaleDenominatorInputChange(event.target.value)}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={onApplyScale}
            className="px-2 py-1.5 text-xs rounded bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            Setzen
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <ToolButton
          label={isMeasuring ? "Messung läuft..." : "Strecke messen"}
          onClick={onToggleMeasuring}
          active={isMeasuring}
        />
        <p className="text-xs text-slate-600">
          Gemessen: {measuredPixelDistance ? `${measuredPixelDistance.toFixed(1)} px` : "-"}
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={referenceMetersInput}
            onChange={(event) => onReferenceMetersInputChange(event.target.value)}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            placeholder="Meter"
          />
          <button
            type="button"
            onClick={onApplyReferenceDistance}
            disabled={!measuredPixelDistance}
            className="px-2 py-1.5 text-xs rounded bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            Übernehmen
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Einheiten-Templates</p>
        <p className="text-xs text-slate-600">Platziert: {placedTowerCount}</p>
        <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
          {towerTemplates.map((template) => {
            const selected = selectedTowerTemplateId === template.id;
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => onSelectTowerTemplate(template.id)}
                className={`w-full text-left px-3 py-2 rounded text-sm border transition-colors ${
                  selected
                    ? "bg-blue-50 border-blue-300 text-blue-700"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <div className="font-medium">{template.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {countActiveTemplateCameras(template)} Kameras
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">
          {selectedTowerTemplateId
            ? "Template gewählt: Über Platzierungsmodus im Canvas setzen"
            : "Template wählen, dann im Canvas platzieren"}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Kameramodus</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onDayNightModeChange("day")}
            className={`flex-1 px-3 py-1.5 text-sm rounded border ${
              dayNightMode === "day"
                ? "bg-amber-50 border-amber-300 text-amber-700"
                : "bg-white border-slate-200 text-slate-600"
            }`}
          >
            Tag
          </button>
          <button
            type="button"
            onClick={() => onDayNightModeChange("night")}
            className={`flex-1 px-3 py-1.5 text-sm rounded border ${
              dayNightMode === "night"
                ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                : "bg-white border-slate-200 text-slate-600"
            }`}
          >
            Nacht
          </button>
        </div>
      </div>

      {showOfferSection && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Angebot</p>
          <input
            value={customerName}
            onChange={(event) => onCustomerNameChange(event.target.value)}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            placeholder="Kunde"
          />
          <input
            value={projectName}
            onChange={(event) => onProjectNameChange(event.target.value)}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            placeholder="Projekt"
          />
          <input
            type="number"
            min={1}
            value={durationMonths}
            onChange={(event) => onDurationMonthsChange(Math.max(1, Number(event.target.value) || 1))}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            placeholder="Laufzeit (Monate)"
          />
          <button
            type="button"
            onClick={onSaveQuote}
            disabled={isQuoteSaving}
            className="w-full px-3 py-2 rounded text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isQuoteSaving ? "Angebot wird gespeichert..." : "Angebot speichern"}
          </button>
          <button
            type="button"
            onClick={onDownloadPdf}
            disabled={isPdfGenerating}
            className="w-full px-3 py-2 rounded text-sm bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isPdfGenerating ? "PDF wird erstellt..." : "Angebot PDF herunterladen"}
          </button>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Auswahl</p>
        {selectedTower ? (
          <div className="space-y-1 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded p-2">
            <p className="font-semibold">{selectedTower.displayName}</p>
            <p>{selectedTower.templateLabel}</p>
            <p>Position: {Math.round(selectedTower.x)} / {Math.round(selectedTower.y)}</p>
            <p>Rotation: {Math.round(selectedTower.rotationDeg)}°</p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Keine Einheit ausgewählt.</p>
        )}
      </div>

      {selectedTower && selectedTowerTemplate && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Kamera-Richtung</p>
          <p
            className={`text-[11px] rounded border px-2 py-1 ${
              hasCalibration
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
          >
            {hasCalibration
              ? `Kalibrierung aktiv (${calibration?.pixelsPerMeter?.toFixed(2)} px/m). Reichweiten sind als Planungswerte nutzbar.`
              : "Ohne Kalibrierung werden Reichweiten als manuelle Planungswerte dargestellt."}
          </p>
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {selectedTowerTemplate.cameraSlots
              .filter((slot) => resolveSlotCameraType(slot) !== "none")
              .map((slot) => {
              const cameraConfiguration =
                selectedTower.cameraConfigurations.find((entry) => entry.slotId === slot.slotId) ?? null;
              const resolvedCameraType = cameraConfiguration?.cameraType ?? resolveSlotCameraType(slot);
              const normalizedCameraConfiguration = normalizePlannerCameraConfiguration(
                cameraConfiguration ?? {
                  slotId: slot.slotId,
                  cameraType: resolvedCameraType,
                  active: slot.isActive !== false,
                }
              );
              const cameraDefaults = getPlannerCameraZoneDefaults(resolvedCameraType);
              const customRotationDeg = normalizedCameraConfiguration.customRotationDeg ?? 0;
              const active = normalizedCameraConfiguration.active;
              const cameraTypeLabel = getCameraTypeLabel(resolvedCameraType);
              const isSelected =
                selectedCamera?.towerId === selectedTower.id && selectedCamera.slotId === slot.slotId;

              return (
                <div
                  key={slot.slotId}
                  className={`rounded border p-2 transition-colors ${
                    isSelected
                      ? "border-cyan-400 bg-cyan-50 shadow-sm"
                      : active
                        ? "border-slate-200 bg-slate-50"
                        : "border-slate-200 bg-slate-50 opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectCamera(selectedTower.id, slot.slotId)}
                      className="text-left"
                    >
                      <p className="text-xs font-semibold text-slate-700">{slot.slotId}</p>
                      <p className="text-[11px] text-slate-500">
                        {isSelected ? "Im Canvas aktiv" : "Im Canvas markieren"}
                      </p>
                    </button>
                    <span className="text-[11px] text-slate-500">{cameraTypeLabel}</span>
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(event) =>
                          onSetTowerCameraActive(selectedTower.id, slot.slotId, event.target.checked)
                        }
                      />
                      aktiv
                    </label>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-slate-500">Offset</span>
                    <input
                      type="number"
                      step={1}
                      value={customRotationDeg}
                      onChange={(event) => {
                        const nextValue = Number(event.target.value);
                        onSetTowerCameraCustomRotation(
                          selectedTower.id,
                          slot.slotId,
                          Number.isFinite(nextValue) ? nextValue : 0
                        );
                      }}
                      className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                    />
                    <span className="text-xs text-slate-500">°</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-xs text-slate-500 block mb-1">Öffnungswinkel</span>
                      <input
                        type="number"
                        min={5}
                        max={180}
                        step={1}
                        value={normalizedCameraConfiguration.fieldOfViewDeg ?? cameraDefaults.fieldOfViewDeg}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value);
                          onUpdateTowerCameraConfiguration(selectedTower.id, slot.slotId, {
                            fieldOfViewDeg: Number.isFinite(nextValue) ? nextValue : cameraDefaults.fieldOfViewDeg,
                          });
                        }}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                      />
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block mb-1">Alarm (Planungswert)</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={normalizedCameraConfiguration.alarmRangeMeters ?? cameraDefaults.alarmRangeMeters}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value);
                          onUpdateTowerCameraConfiguration(selectedTower.id, slot.slotId, {
                            alarmRangeMeters: Number.isFinite(nextValue) ? nextValue : cameraDefaults.alarmRangeMeters,
                          });
                        }}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                      />
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block mb-1">Erkennung (Planungswert)</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={normalizedCameraConfiguration.detectionRangeMeters ?? cameraDefaults.detectionRangeMeters}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value);
                          onUpdateTowerCameraConfiguration(selectedTower.id, slot.slotId, {
                            detectionRangeMeters: Number.isFinite(nextValue) ? nextValue : cameraDefaults.detectionRangeMeters,
                          });
                        }}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                      />
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block mb-1">Beobachtung (Planungswert)</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={normalizedCameraConfiguration.observationRangeMeters ?? cameraDefaults.observationRangeMeters}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value);
                          onUpdateTowerCameraConfiguration(selectedTower.id, slot.slotId, {
                            observationRangeMeters: Number.isFinite(nextValue) ? nextValue : cameraDefaults.observationRangeMeters,
                          });
                        }}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={onRemoveSelectedTower}
          disabled={!selectedTower}
          className="w-full px-3 py-2 rounded text-sm bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          Einheit entfernen
        </button>
      </div>

      <div>
        <ToolButton label="Reset View" onClick={onResetView} />
      </div>
    </aside>
  );
}

function ToolButton({
  label,
  active = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
        active
          ? "bg-blue-50 text-blue-700 font-medium"
          : "text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
}

function countActiveTemplateCameras(template: TowerTemplate): number {
  return template.cameraSlots.filter(
    (slot) => slot.isActive !== false && resolveSlotCameraType(slot) !== "none"
  ).length;
}

function resolveSlotCameraType(slot: TowerTemplate["cameraSlots"][number]) {
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

function getCameraTypeLabel(type: ReturnType<typeof resolveSlotCameraType>): string {
  switch (type) {
    case "ptz":
      return "PTZ";
    case "bullet":
      return "Bullet";
    case "dome":
      return "Dome";
    case "thermal":
      return "Thermal";
    default:
      return "Leer";
  }
}
