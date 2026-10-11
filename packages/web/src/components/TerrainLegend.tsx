import {
  CLIMATE_WATER,
  isWater,
  LAND_HEIGHT_STEPS,
  RAINFALL_STEPS,
  TEMPERATURE_STEPS,
  WATER_DEPTH_STEPS,
  type ColorStep,
  type TerrainData,
  type TerrainType,
  type TerrainView,
} from "@critter-evo/core";
import { useMemo, useSyncExternalStore } from "react";
import { biomeLegend, cssColor, cssSteps, stepPosition, terrainTypeLegend } from "../render/terrainColors";
import type { SimClient } from "../sim/SimClient";

/** Legend for the current terrain view. */
export function TerrainLegend({ client, view }: { client: SimClient; view: TerrainView }) {
  // Select only the terrain, so the legend re-renders per world, not per frame.
  const terrain = useSyncExternalStore(client.subscribe, () => client.getStatus().terrain);
  return <div className="legend">{terrain && <LegendBody terrain={terrain} view={view} />}</div>;
}

function LegendBody({ terrain, view }: { terrain: TerrainData; view: TerrainView }) {
  const temperatureRange = useMemo(() => landRange(terrain, terrain.temperature), [terrain]);
  const rainfallRange = useMemo(() => landRange(terrain, terrain.rainfall), [terrain]);
  switch (view) {
    case "biome":
      return <Swatches items={biomeLegend()} />;
    case "terrain":
      return <Swatches items={terrainTypeLegend()} />;
    case "elevation":
      return (
        <>
          <StepBar
            title="Land height"
            steps={LAND_HEIGHT_STEPS}
            ticks={[
              [0, "sea level"],
              [1, `${terrain.peakHeight.toLocaleString("en-US")} ft`],
            ]}
          />
          <StepBar
            title="Water depth"
            steps={WATER_DEPTH_STEPS}
            ticks={[
              [0, "sea level"],
              [1, "deepest"],
            ]}
          />
        </>
      );
    case "temperature":
      return (
        <>
          <StepBar title="Mean annual temperature" steps={TEMPERATURE_STEPS} ticks={[-22, 32, 95].map((t) => [t, formatF(t)])} />
          {temperatureRange && (
            <p className="note">
              Land in this world: {formatF(temperatureRange.min)} to {formatF(temperatureRange.max)}
            </p>
          )}
          <Swatches items={[{ label: "Water", color: cssColor(CLIMATE_WATER) }]} />
        </>
      );
    case "rainfall":
      return (
        <>
          <StepBar title="Annual rainfall" steps={RAINFALL_STEPS} ticks={[0, 50, 100, 150].map((r) => [r, formatInches(r)])} />
          {rainfallRange && (
            <p className="note">
              Land in this world: {formatInches(rainfallRange.min)} to {formatInches(rainfallRange.max)}
            </p>
          )}
          <Swatches items={[{ label: "Water", color: cssColor(CLIMATE_WATER) }]} />
        </>
      );
  }
}

function Swatches({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="legend-items">
      {items.map((item) => (
        <li key={item.label}>
          <span className="swatch" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** A stepped color bar with labels at chosen values along it. */
function StepBar({ title, steps, ticks }: { title: string; steps: readonly ColorStep[]; ticks: [value: number, label: string][] }) {
  return (
    <div className="legend-gradient">
      <div className="title">{title}</div>
      <div className="bar" style={{ background: cssSteps(steps) }} />
      <div className="ticks">
        {ticks.map(([value, label]) => (
          <span key={label} style={{ left: `${stepPosition(steps, value) * 100}%` }}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatF(value: number): string {
  return `${Math.round(value)}°F`.replace("-", "−");
}

function formatInches(value: number): string {
  return `${Math.round(value)} in`;
}

/** Smallest and largest value of a field over land, or null if there is no land. */
function landRange(terrain: TerrainData, field: Float32Array): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  field.forEach((v, i) => {
    if (isWater(terrain.terrainType[i] as TerrainType)) return;
    min = Math.min(min, v);
    max = Math.max(max, v);
  });
  return Number.isFinite(min) ? { min, max } : null;
}
