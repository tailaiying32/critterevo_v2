import { isWater } from "@critter-evo/core";
import { useMemo, useSyncExternalStore } from "react";
import {
  categoricalLegend,
  cssGradient,
  ELEVATION_STOPS,
  MOISTURE_STOPS,
  TEMPERATURE_RANGE,
  TEMPERATURE_STOPS,
  TERRAIN_VIEWS,
  type TerrainView,
} from "../render/terrainColors";
import type { SimClient } from "../sim/SimClient";

export function ViewControls({
  view,
  relief,
  onViewChange,
  onReliefChange,
}: {
  view: TerrainView;
  relief: boolean;
  onViewChange: (view: TerrainView) => void;
  onReliefChange: (relief: boolean) => void;
}) {
  return (
    <>
      <select value={view} onChange={(e) => onViewChange(e.target.value as TerrainView)} title="Terrain view">
        {TERRAIN_VIEWS.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
      <label className="toggle" title="Shade terrain by slope so ranges read as 3D">
        <input type="checkbox" checked={relief} onChange={(e) => onReliefChange(e.target.checked)} />
        Relief
      </label>
    </>
  );
}

/** Legend for the current terrain view. */
export function TerrainLegend({ client, view }: { client: SimClient; view: TerrainView }) {
  const status = useSyncExternalStore(client.subscribe, client.getStatus);
  const terrain = status.terrain;

  // The actual temperature range of this world, shown alongside the fixed color scale.
  const worldRange = useMemo(() => {
    if (!terrain) return null;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < terrain.temperature.length; i++) {
      if (isWater(terrain.terrainType[i]!)) continue;
      min = Math.min(min, terrain.temperature[i]!);
      max = Math.max(max, terrain.temperature[i]!);
    }
    return Number.isFinite(min) ? { min, max } : null;
  }, [terrain]);

  const items = categoricalLegend(view);

  return (
    <div className="legend">
      {items.length > 0 && (
        <ul className="legend-items">
          {items.map((item) => (
            <li key={item.label}>
              <span className="swatch" style={{ background: item.color }} />
              {item.label}
            </li>
          ))}
        </ul>
      )}
      {view === "temperature" && (
        <Gradient
          gradient={cssGradient(TEMPERATURE_STOPS)}
          left={`${TEMPERATURE_RANGE.min}°F`}
          right={`${TEMPERATURE_RANGE.max}°F`}
          note={worldRange ? `Land in this world: ${worldRange.min.toFixed(0)}°F to ${worldRange.max.toFixed(0)}°F` : undefined}
        />
      )}
      {view === "elevation" && <Gradient gradient={cssGradient(ELEVATION_STOPS)} left="Sea level" right="Highest peak" note="Water shaded by depth" />}
      {view === "moisture" && <Gradient gradient={cssGradient(MOISTURE_STOPS)} left="Driest" right="Wettest" />}
    </div>
  );
}

function Gradient({ gradient, left, right, note }: { gradient: string; left: string; right: string; note?: string | undefined }) {
  return (
    <div className="legend-gradient">
      <div className="bar" style={{ background: gradient }} />
      <div className="ends">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}
