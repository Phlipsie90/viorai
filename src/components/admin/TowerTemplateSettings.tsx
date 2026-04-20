"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import { towerTemplateRepository } from "@/features/tower-templates/repository";
import type {
  TenantTowerTemplate,
  TenantTowerTemplateComponentDraft,
  TenantTowerTemplateDraft,
  TenantTowerTemplateSlotDraft,
} from "@/features/tower-templates/types";
import type {
  TowerConnectivityType,
  TowerPowerType,
  TowerSlotCameraType,
  TowerStandardComponentType,
} from "@/types";

const CAMERA_TYPE_OPTIONS: Array<{ value: TowerSlotCameraType; label: string }> = [
  { value: "none", label: "Leer" },
  { value: "ptz", label: "PTZ" },
  { value: "bullet", label: "Bullet" },
  { value: "thermal", label: "Thermal" },
  { value: "dome", label: "Dome" },
];

const POWER_TYPE_OPTIONS: Array<{ value: TowerPowerType; label: string }> = [
  { value: "grid", label: "Netz" },
  { value: "battery", label: "Batterie" },
  { value: "efoy", label: "EFOY" },
  { value: "diesel", label: "Diesel" },
  { value: "solar", label: "Solar" },
  { value: "hybrid", label: "Hybrid" },
];

const CONNECTIVITY_OPTIONS: Array<{ value: TowerConnectivityType; label: string }> = [
  { value: "lte", label: "LTE" },
  { value: "5g", label: "5G" },
  { value: "wlan", label: "WLAN" },
  { value: "satellite", label: "Satellit" },
  { value: "lan", label: "LAN" },
];

const STANDARD_COMPONENT_OPTIONS: Array<{ value: TowerStandardComponentType; label: string }> = [
  { value: "led", label: "LED" },
  { value: "speaker", label: "Lautsprecher" },
  { value: "siren", label: "Sirene" },
];

function createEmptyTemplateDraft(): TenantTowerTemplateDraft {
  return {
    name: "",
    description: "",
    powerType: "grid",
    isActive: true,
    connectivity: [],
    components: [],
    slots: [
      {
        slotKey: "slot-1",
        slotOrder: 1,
        cameraType: "ptz",
        isActive: true,
      },
    ],
  };
}

function toDraft(template: TenantTowerTemplate): TenantTowerTemplateDraft {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    powerType: template.powerType,
    isActive: template.isActive,
    connectivity: template.connectivity.filter((entry) => entry.isActive).map((entry) => entry.type),
    components: template.components.map((component) => ({
      id: component.id,
      name: component.name,
      isActive: component.isActive,
    })),
    slots: template.slots.map((slot) => ({
      id: slot.id,
      slotKey: slot.slotKey,
      slotOrder: slot.slotOrder,
      cameraType: slot.cameraType,
      isActive: slot.isActive,
    })),
  };
}

function normalizeSlots(slots: TenantTowerTemplateSlotDraft[]): TenantTowerTemplateSlotDraft[] {
  return [...slots]
    .sort((a, b) => a.slotOrder - b.slotOrder)
    .map((slot, index) => ({
      ...slot,
      slotOrder: index + 1,
    }));
}

function getSlotIdentity(slot: TenantTowerTemplateSlotDraft): string {
  return slot.id ?? slot.slotKey;
}

function normalizeComponentName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const lower = trimmed.toLowerCase();
  if (lower === "led") {
    return "led";
  }
  if (lower === "lautsprecher" || lower === "speaker") {
    return "speaker";
  }
  if (lower === "sirene" || lower === "siren") {
    return "siren";
  }

  return trimmed;
}

function isStandardComponentName(value: string): value is TowerStandardComponentType {
  return value === "led" || value === "speaker" || value === "siren";
}

function getComponentLabel(componentName: string): string {
  if (componentName === "led") {
    return "LED";
  }
  if (componentName === "speaker") {
    return "Lautsprecher";
  }
  if (componentName === "siren") {
    return "Sirene";
  }
  return componentName;
}

function getPowerTypeLabel(powerType: TowerPowerType): string {
  switch (powerType) {
    case "grid":
      return "Netz";
    case "battery":
      return "Batterie";
    case "efoy":
      return "EFOY";
    case "diesel":
      return "Diesel";
    case "solar":
      return "Solar";
    case "hybrid":
      return "Hybrid";
    default:
      return "Nicht definiert";
  }
}

function getConnectivityLabel(type: TowerConnectivityType): string {
  switch (type) {
    case "lte":
      return "LTE";
    case "5g":
      return "5G";
    case "wlan":
      return "WLAN";
    case "satellite":
      return "Satellit";
    case "lan":
      return "LAN";
    default:
      return type;
  }
}

function getCameraTypeLabel(cameraType: TowerSlotCameraType): string {
  switch (cameraType) {
    case "ptz":
      return "PTZ";
    case "bullet":
      return "Bullet";
    case "thermal":
      return "Thermal";
    case "dome":
      return "Dome";
    default:
      return "Keine";
  }
}

function summarizeTemplateCameraTypes(
  draft: TenantTowerTemplateDraft
): Array<{ type: TowerSlotCameraType; count: number }> {
  const summary = new Map<TowerSlotCameraType, number>();

  for (const slot of draft.slots) {
    if (!slot.isActive || slot.cameraType === "none") {
      continue;
    }

    summary.set(slot.cameraType, (summary.get(slot.cameraType) ?? 0) + 1);
  }

  return Array.from(summary.entries()).map(([type, count]) => ({ type, count }));
}

function validateTemplateDraft(
  draft: TenantTowerTemplateDraft
): { error: string | null; warning: string | null } {
  if (!draft.name.trim()) {
    return { error: "Bitte einen Vorlagennamen angeben.", warning: null };
  }

  if (draft.slots.length === 0) {
    return { error: "Bitte mindestens einen Slot hinterlegen.", warning: null };
  }

  const slotOrders = new Set<number>();
  const slotKeys = new Set<string>();

  for (const slot of draft.slots) {
    if (!Number.isFinite(slot.slotOrder) || slot.slotOrder < 1) {
      return {
        error: "Slot-Reihenfolgen muessen ganze Zahlen groesser oder gleich 1 sein.",
        warning: null,
      };
    }

    if (slotOrders.has(slot.slotOrder)) {
      return {
        error: `Slot-Reihenfolge ${slot.slotOrder} ist mehrfach vorhanden.`,
        warning: null,
      };
    }
    slotOrders.add(slot.slotOrder);

    const slotKey = slot.slotKey.trim();
    if (!slotKey) {
      return {
        error: "Jeder Slot benoetigt einen Slot-Key.",
        warning: null,
      };
    }

    const normalizedSlotKey = slotKey.toLowerCase();
    if (slotKeys.has(normalizedSlotKey)) {
      return {
        error: `Slot-Key \"${slot.slotKey}\" ist mehrfach vorhanden.`,
        warning: null,
      };
    }
    slotKeys.add(normalizedSlotKey);
  }

  const hasRecommendedActiveSlot = draft.slots.some(
    (slot) => slot.isActive && slot.cameraType !== "none"
  );

  return {
    error: null,
    warning: hasRecommendedActiveSlot
      ? null
      : "Empfehlung: Mindestens ein aktiver Slot mit Kameratyp verbessert die Planungsqualitaet.",
  };
}

export default function TowerTemplateSettings() {
  const [drafts, setDrafts] = useState<TenantTowerTemplateDraft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingByTemplate, setIsSavingByTemplate] = useState<Record<string, boolean>>({});
  const [newComponentByTemplate, setNewComponentByTemplate] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasTemplates = drafts.length > 0;

  const loadTemplates = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const templates = await towerTemplateRepository.list();
      setDrafts(templates.map(toDraft));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Turmkonfigurationen konnten nicht geladen werden.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadTemplates();
  }, []);

  const templateIds = useMemo(() => {
    return drafts.map((draft, index) => draft.id ?? `new-${index}`);
  }, [drafts]);

  const setDraft = (index: number, nextDraft: TenantTowerTemplateDraft) => {
    setDrafts((prev) => prev.map((entry, i) => (i === index ? nextDraft : entry)));
  };

  const handleAddTemplate = () => {
    setMessage(null);
    setError(null);
    setDrafts((prev) => [...prev, createEmptyTemplateDraft()]);
  };

  const handleRemoveTemplate = async (index: number) => {
    const target = drafts[index];
    if (!target) {
      return;
    }

    setMessage(null);
    setError(null);

    if (!target.id) {
      setDrafts((prev) => prev.filter((_, i) => i !== index));
      return;
    }

    const key = target.id;
    setIsSavingByTemplate((prev) => ({ ...prev, [key]: true }));

    try {
      await towerTemplateRepository.remove(target.id);
      setDrafts((prev) => prev.filter((_, i) => i !== index));
      setMessage("Turmvorlage entfernt.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Vorlage konnte nicht entfernt werden.");
    } finally {
      setIsSavingByTemplate((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleAddSlot = (index: number) => {
    const target = drafts[index];
    if (!target) {
      return;
    }

    const nextOrder = target.slots.length + 1;
    setDraft(index, {
      ...target,
      slots: [
        ...target.slots,
        {
          slotKey: `slot-${nextOrder}`,
          slotOrder: nextOrder,
          cameraType: "ptz",
          isActive: true,
        },
      ],
    });
  };

  const handleUpdateSlot = (
    templateIndex: number,
    slotIdentity: string,
    patch: Partial<TenantTowerTemplateSlotDraft>
  ) => {
    const target = drafts[templateIndex];
    if (!target) {
      return;
    }

    const nextSlots = target.slots.map((slot) =>
      getSlotIdentity(slot) === slotIdentity
        ? {
            ...slot,
            ...patch,
          }
        : slot
    );

    setDraft(templateIndex, {
      ...target,
      slots: nextSlots,
    });
  };

  const handleRemoveSlot = (templateIndex: number, slotIdentity: string) => {
    const target = drafts[templateIndex];
    if (!target) {
      return;
    }

    const nextSlots = normalizeSlots(
      target.slots.filter((slot) => getSlotIdentity(slot) !== slotIdentity)
    );

    setDraft(templateIndex, {
      ...target,
      slots: nextSlots,
    });
  };

  const handleToggleConnectivity = (
    templateIndex: number,
    connectivityType: TowerConnectivityType,
    enabled: boolean
  ) => {
    const target = drafts[templateIndex];
    if (!target) {
      return;
    }

    const nextConnectivity = enabled
      ? Array.from(new Set([...target.connectivity, connectivityType]))
      : target.connectivity.filter((entry) => entry !== connectivityType);

    setDraft(templateIndex, {
      ...target,
      connectivity: nextConnectivity,
    });
  };

  const handleToggleStandardComponent = (
    templateIndex: number,
    componentType: TowerStandardComponentType,
    enabled: boolean
  ) => {
    const target = drafts[templateIndex];
    if (!target) {
      return;
    }

    const existingIndex = target.components.findIndex(
      (component) => normalizeComponentName(component.name) === componentType
    );

    let nextComponents: TenantTowerTemplateComponentDraft[];

    if (existingIndex >= 0) {
      nextComponents = target.components.map((component, index) =>
        index === existingIndex
          ? {
              ...component,
              name: componentType,
              isActive: enabled,
            }
          : component
      );
    } else {
      nextComponents = enabled
        ? [...target.components, { name: componentType, isActive: true }]
        : target.components;
    }

    setDraft(templateIndex, {
      ...target,
      components: nextComponents,
    });
  };

  const handleAddCustomComponent = (templateIndex: number, templateKey: string) => {
    const target = drafts[templateIndex];
    if (!target) {
      return;
    }

    const rawInput = newComponentByTemplate[templateKey] ?? "";
    const normalizedName = normalizeComponentName(rawInput);

    if (!normalizedName) {
      setError("Bitte einen Komponentennamen eingeben.");
      return;
    }

    if (isStandardComponentName(normalizedName)) {
      setError("Diese Komponente ist bereits als Standard-Komponente vorhanden.");
      return;
    }

    const existingIndex = target.components.findIndex(
      (component) => normalizeComponentName(component.name).toLowerCase() === normalizedName.toLowerCase()
    );

    const nextComponents = existingIndex >= 0
      ? target.components.map((component, index) =>
          index === existingIndex
            ? {
                ...component,
                name: normalizedName,
                isActive: true,
              }
            : component
        )
      : [...target.components, { name: normalizedName, isActive: true }];

    setDraft(templateIndex, {
      ...target,
      components: nextComponents,
    });

    setNewComponentByTemplate((prev) => ({ ...prev, [templateKey]: "" }));
    setError(null);
  };

  const handleToggleComponentActive = (
    templateIndex: number,
    componentIndex: number,
    isActive: boolean
  ) => {
    const target = drafts[templateIndex];
    if (!target) {
      return;
    }

    const nextComponents = target.components.map((component, index) =>
      index === componentIndex
        ? {
            ...component,
            isActive,
          }
        : component
    );

    setDraft(templateIndex, {
      ...target,
      components: nextComponents,
    });
  };

  const handleRemoveComponent = (templateIndex: number, componentIndex: number) => {
    const target = drafts[templateIndex];
    if (!target) {
      return;
    }

    const nextComponents = target.components.filter((_, index) => index !== componentIndex);

    setDraft(templateIndex, {
      ...target,
      components: nextComponents,
    });
  };

  const handleSaveTemplate = async (index: number) => {
    const target = drafts[index];
    if (!target) {
      return;
    }

    const validation = validateTemplateDraft(target);
    if (validation.error) {
      setMessage(null);
      setError(validation.error);
      return;
    }

    const key = target.id ?? `new-${index}`;
    setIsSavingByTemplate((prev) => ({ ...prev, [key]: true }));
    setMessage(null);
    setError(null);

    try {
      const savedTemplate = await towerTemplateRepository.save({
        ...target,
        slots: normalizeSlots(target.slots),
        components: target.components.map((component) => ({
          ...component,
          name: normalizeComponentName(component.name),
        })),
      });

      setDraft(index, toDraft(savedTemplate));
      setMessage(
        validation.warning
          ? `Turmvorlage gespeichert. ${validation.warning}`
          : "Turmvorlage gespeichert."
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Vorlage konnte nicht gespeichert werden.");
    } finally {
      setIsSavingByTemplate((prev) => ({ ...prev, [key]: false }));
    }
  };

  return (
    <section className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Turmkonfigurationen</h3>
          <p className="text-xs text-slate-500 mt-1">
            Tenantbezogene Turmtypen fuer den Videoturm-Planungsflow (Energie, Slots, Kommunikation, Komponenten).
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={handleAddTemplate}>
          Turmvorlage hinzufuegen
        </Button>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Lade Turmkonfigurationen...</p>}

      {!isLoading && !hasTemplates && (
        <p className="text-sm text-slate-500">Noch keine Turmvorlagen vorhanden.</p>
      )}

      {!isLoading && (
        <div className="space-y-4">
          {drafts.map((draft, templateIndex) => {
            const key = templateIds[templateIndex] ?? `new-${templateIndex}`;
            const isSaving = Boolean(isSavingByTemplate[key]);
            const customComponents = draft.components.filter(
              (component) => !isStandardComponentName(normalizeComponentName(component.name))
            );
            const templateWarning = validateTemplateDraft(draft).warning;
            const cameraTypeSummary = summarizeTemplateCameraTypes(draft);
            const activeConnectivityLabels = draft.connectivity.map((type) => getConnectivityLabel(type));
            const activeComponentLabels = draft.components
              .filter((component) => component.isActive)
              .map((component) => getComponentLabel(component.name));

            return (
              <div key={key} className="rounded-md border border-slate-200 p-4 space-y-4">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700">
                  <p className="font-semibold text-slate-800">{draft.name.trim() || "Neue Turmvorlage"}</p>
                  <p className="mt-1">Energieart: {getPowerTypeLabel(draft.powerType)}</p>
                  <p className="mt-1">
                    Aktive Kameras: {cameraTypeSummary.length > 0
                      ? cameraTypeSummary.map((entry) => `${getCameraTypeLabel(entry.type)} (${entry.count})`).join(", ")
                      : "Keine"}
                  </p>
                  <p className="mt-1">
                    Konnektivitaet: {activeConnectivityLabels.length > 0 ? activeConnectivityLabels.join(", ") : "Keine"}
                  </p>
                  <p className="mt-1">
                    Komponenten: {activeComponentLabels.length > 0 ? activeComponentLabels.join(", ") : "Keine"}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
                    <input
                      type="text"
                      value={draft.name}
                      onChange={(event) =>
                        setDraft(templateIndex, {
                          ...draft,
                          name: event.target.value,
                        })
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Energieart</label>
                    <select
                      value={draft.powerType}
                      onChange={(event) =>
                        setDraft(templateIndex, {
                          ...draft,
                          powerType: event.target.value as TowerPowerType,
                        })
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      {POWER_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Beschreibung</label>
                    <textarea
                      rows={2}
                      value={draft.description}
                      onChange={(event) =>
                        setDraft(templateIndex, {
                          ...draft,
                          description: event.target.value,
                        })
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={draft.isActive}
                        onChange={(event) =>
                          setDraft(templateIndex, {
                            ...draft,
                            isActive: event.target.checked,
                          })
                        }
                      />
                      Vorlage aktiv
                    </label>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-600 mb-2">Kommunikation</p>
                  <div className="flex flex-wrap gap-4">
                    {CONNECTIVITY_OPTIONS.map((option) => (
                      <label key={option.value} className="inline-flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={draft.connectivity.includes(option.value)}
                          onChange={(event) =>
                            handleToggleConnectivity(templateIndex, option.value, event.target.checked)
                          }
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-600 mb-2">Standard-Komponenten</p>
                  <div className="flex flex-wrap gap-4">
                    {STANDARD_COMPONENT_OPTIONS.map((option) => {
                      const normalized = normalizeComponentName(option.value);
                      const active = draft.components.some(
                        (component) => normalizeComponentName(component.name) === normalized && component.isActive
                      );

                      return (
                        <label key={option.value} className="inline-flex items-center gap-2 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={(event) =>
                              handleToggleStandardComponent(templateIndex, option.value, event.target.checked)
                            }
                          />
                          {option.label}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-600">Freie Komponenten</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Neue Komponente"
                      value={newComponentByTemplate[key] ?? ""}
                      onChange={(event) =>
                        setNewComponentByTemplate((prev) => ({
                          ...prev,
                          [key]: event.target.value,
                        }))
                      }
                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => handleAddCustomComponent(templateIndex, key)}
                    >
                      Hinzufuegen
                    </Button>
                  </div>

                  {customComponents.length === 0 && (
                    <p className="text-xs text-slate-500">Keine freien Komponenten vorhanden.</p>
                  )}

                  {customComponents.map((component) => {
                    const originalIndex = draft.components.findIndex((entry) => entry === component);

                    return (
                      <div
                        key={`${key}-${component.id ?? component.name}-${originalIndex}`}
                        className="flex items-center justify-between gap-3 rounded border border-slate-100 px-3 py-2"
                      >
                        <p className="text-xs text-slate-700">{getComponentLabel(component.name)}</p>
                        <div className="flex items-center gap-3">
                          <label className="inline-flex items-center gap-1 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={component.isActive}
                              onChange={(event) =>
                                handleToggleComponentActive(templateIndex, originalIndex, event.target.checked)
                              }
                            />
                            aktiv
                          </label>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveComponent(templateIndex, originalIndex)}
                          >
                            Loeschen
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-slate-600">Slots</p>
                    <Button type="button" size="sm" variant="ghost" onClick={() => handleAddSlot(templateIndex)}>
                      Slot hinzufuegen
                    </Button>
                  </div>

                  {draft.slots.length === 0 && (
                    <p className="text-xs text-slate-500">Keine Slots vorhanden.</p>
                  )}

                  {draft.slots
                    .slice()
                    .sort((a, b) => a.slotOrder - b.slotOrder)
                    .map((slot, slotIndex) => {
                      const slotIdentity = getSlotIdentity(slot);

                      return (
                        <div
                          key={`${key}-${slot.id ?? slot.slotKey}-${slotIndex}`}
                          className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end rounded border border-slate-100 p-2"
                        >
                          <div className="md:col-span-2">
                            <label className="block text-[11px] text-slate-500 mb-1">Reihenfolge</label>
                            <input
                              type="number"
                              min={1}
                              value={slot.slotOrder}
                              onChange={(event) =>
                                handleUpdateSlot(templateIndex, slotIdentity, {
                                  slotOrder: Math.max(1, Number(event.target.value) || 1),
                                })
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                            />
                          </div>

                          <div className="md:col-span-3">
                            <label className="block text-[11px] text-slate-500 mb-1">Slot-Key</label>
                            <input
                              type="text"
                              value={slot.slotKey}
                              onChange={(event) =>
                                handleUpdateSlot(templateIndex, slotIdentity, {
                                  slotKey: event.target.value,
                                })
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                            />
                          </div>

                          <div className="md:col-span-3">
                            <label className="block text-[11px] text-slate-500 mb-1">Kameratyp</label>
                            <select
                              value={slot.cameraType}
                              onChange={(event) =>
                                handleUpdateSlot(templateIndex, slotIdentity, {
                                  cameraType: event.target.value as TowerSlotCameraType,
                                })
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                            >
                              {CAMERA_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="md:col-span-2">
                            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={slot.isActive}
                                onChange={(event) =>
                                  handleUpdateSlot(templateIndex, slotIdentity, {
                                    isActive: event.target.checked,
                                  })
                                }
                              />
                              Aktiv
                            </label>
                          </div>

                          <div className="md:col-span-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="w-full"
                              onClick={() => handleRemoveSlot(templateIndex, slotIdentity)}
                            >
                              Entfernen
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                </div>

                {templateWarning && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    {templateWarning}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleSaveTemplate(templateIndex)}
                    disabled={isSaving}
                  >
                    {isSaving ? "Speichern..." : "Vorlage speichern"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleRemoveTemplate(templateIndex)}
                    disabled={isSaving}
                  >
                    Vorlage loeschen
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {message && <p className="text-sm text-green-700">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
