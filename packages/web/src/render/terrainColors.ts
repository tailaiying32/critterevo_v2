import {
  Biome,
  BIOME_COLORS,
  BIOME_NAMES,
  TERRAIN_TYPE_COLORS,
  TERRAIN_TYPE_NAMES,
  TerrainType,
  type ColorStep,
  type RGB,
} from "@critter-evo/core";

export function cssColor(color: RGB): string {
  return `rgb(${color.map(Math.round).join(",")})`;
}

/** Where a value sits along a stepped scale, from 0 at its first step to 1 at its last. */
export function stepPosition(steps: readonly ColorStep[], value: number): number {
  const first = steps[0]!.from;
  const last = steps[steps.length - 1]!.to;
  return Math.min(1, Math.max(0, (value - first) / (last - first)));
}

/** CSS background for a stepped scale: one solid block per step, with hard edges. */
export function cssSteps(steps: readonly ColorStep[]): string {
  const at = (value: number) => `${(stepPosition(steps, value) * 100).toFixed(1)}%`;
  return `linear-gradient(to right, ${steps.map((s) => `${cssColor(s.color)} ${at(s.from)} ${at(s.to)}`).join(", ")})`;
}

/** Biomes from cold to hot and dry to wet, as in the Whittaker table, then water. */
export function biomeLegend(): { label: string; color: string }[] {
  const biomes = [
    Biome.Tundra,
    Biome.Taiga,
    Biome.Grassland,
    Biome.TemperateForest,
    Biome.TemperateRainforest,
    Biome.Desert,
    Biome.Savanna,
    Biome.Rainforest,
  ] as const;
  return [
    ...biomes.map((biome) => ({ label: BIOME_NAMES[biome]!, color: cssColor(BIOME_COLORS[biome]) })),
    ...[TerrainType.ShallowWater, TerrainType.DeepWater].map((type) => ({
      label: TERRAIN_TYPE_NAMES[type]!,
      color: cssColor(TERRAIN_TYPE_COLORS[type]),
    })),
  ];
}

export function terrainTypeLegend(): { label: string; color: string }[] {
  return [TerrainType.DeepWater, TerrainType.ShallowWater, TerrainType.Land, TerrainType.Mountain].map((type) => ({
    label: TERRAIN_TYPE_NAMES[type]!,
    color: cssColor(TERRAIN_TYPE_COLORS[type]),
  }));
}
