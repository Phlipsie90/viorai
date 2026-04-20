"use client";

import type { PlannerPlacedTower } from "./types";

interface PlacedTowersSidebarProps {
  towers: Array<
    PlannerPlacedTower & {
      templateLabel: string;
      cameraCount: number;
    }
  >;
  selectedTowerId: string | null;
  onSelectTower: (towerId: string) => void;
  onRenameTower: (towerId: string, displayName: string) => void;
  onDeleteTower: (towerId: string) => void;
}

export default function PlacedTowersSidebar({
  towers,
  selectedTowerId,
  onSelectTower,
  onRenameTower,
  onDeleteTower,
}: PlacedTowersSidebarProps) {
  return (
    <aside className="w-72 shrink-0 bg-white rounded-lg border border-slate-200 p-4 flex flex-col gap-3">
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Platzierte Einheiten</p>
        <p className="text-xs text-slate-500 mt-1">Gesamt: {towers.length}</p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {towers.length === 0 && (
          <p className="text-sm text-slate-500">Noch keine Einheiten gesetzt.</p>
        )}

        {towers.map((tower) => {
          const isSelected = selectedTowerId === tower.id;
          return (
            <div
              key={tower.id}
              onClick={() => onSelectTower(tower.id)}
              className={`rounded-md border p-2 cursor-pointer transition-colors ${
                isSelected
                  ? "border-cyan-400 bg-cyan-50"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <input
                value={tower.displayName}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onRenameTower(tower.id, event.target.value)}
                className="w-full text-sm font-semibold text-slate-800 border border-slate-300 rounded px-2 py-1"
              />
              <p className="text-xs text-slate-600 mt-2">{tower.templateLabel}</p>
              <p className="text-xs text-slate-500 mt-0.5">Kameras: {tower.cameraCount}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Pos: {Math.round(tower.x)} / {Math.round(tower.y)}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Rot: {Math.round(tower.rotationDeg)}°
              </p>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteTower(tower.id);
                }}
                className="mt-2 w-full px-2 py-1.5 rounded text-xs bg-red-50 text-red-700 hover:bg-red-100"
              >
                Löschen
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
