/** Terrain types (docs/DESIGN.md §4.3). Stored per cell as a Uint8. */
export const TerrainType = {
  DeepWater: 0,
  ShallowWater: 1,
  Land: 2,
  Mountain: 3,
} as const;
export type TerrainType = (typeof TerrainType)[keyof typeof TerrainType];

export const TERRAIN_TYPE_NAMES: readonly string[] = ["Deep water", "Shallow water", "Land", "Mountain"];

/** Elevation thresholds, found from the coverage knobs (docs/DESIGN.md §4.2.1 step 3). */
export interface TerrainLevels {
  /** Sea level: cells below this elevation are water. Infinity if the whole world is water. */
  sea: number;
  /** Water below this elevation is deep; from here up to sea level it is shallow. */
  shallow: number;
  /** Cells at or above this elevation are mountains, unless they are water. Infinity if there are none. */
  mountain: number;
  /** The highest elevation in the world. It sits at exactly the peak height. */
  peak: number;
}

/**
 * The terrain grid (docs/DESIGN.md §4.2). Cell (col, row) is at index
 * row * cols + col and covers world x from col * cellSize to (col + 1) * cellSize,
 * and likewise for y. Each cell holds one value per field, with no blending
 * between cells. Plain data with typed arrays, so it can be transferred to the
 * main thread and saved.
 */
export interface TerrainData {
  cols: number;
  rows: number;
  /** Width and height of a cell in world units. */
  cellSize: number;
  width: number;
  height: number;
  levels: TerrainLevels;
  /** Approximate size of the largest landforms, in world units (the landform size knob). */
  landformSize: number;
  /** Height of the highest cell, in feet above sea level. */
  peakHeight: number;
  /** How far land heights are bent toward sea level, 0 to 1 (docs/DESIGN.md §4.2.1 step 4). */
  lowlandFlatness: number;
  /** Elevation of each cell, 0 to 1. */
  elevation: Float32Array;
  /** Terrain type of each cell. */
  terrainType: Uint8Array;
  /** Mean annual temperature of each cell, in °F. */
  temperature: Float32Array;
  /** Distance from each cell to the nearest water cell, in world units. 0 for water; Infinity if there is none. */
  distanceToWater: Float32Array;
  /** Annual rainfall of each cell, in inches. The moisture field. */
  rainfall: Float32Array;
  /** Biome of each cell, from its own temperature and rainfall. Biome.None for water. */
  biome: Uint8Array;
}

export function classifyTerrain(levels: TerrainLevels, elevation: number): TerrainType {
  if (elevation < levels.shallow) return TerrainType.DeepWater;
  if (elevation < levels.sea) return TerrainType.ShallowWater;
  return elevation < levels.mountain ? TerrainType.Land : TerrainType.Mountain;
}

export function isWater(type: TerrainType): boolean {
  return type === TerrainType.DeepWater || type === TerrainType.ShallowWater;
}

/**
 * Height above sea level in feet for an elevation (docs/DESIGN.md §4.2.1 step 4).
 * With u the fraction of the way from sea level to the highest cell, height is
 * (u + flatness × (u³ − u)) × peak height: lowlands are pulled down toward sea
 * level while the coast stays at 0 and the highest cell stays at exactly the
 * peak height. Arithmetic only, and never decreasing for flatness up to 1.
 * Water is at 0.
 */
export function heightOf(terrain: Pick<TerrainData, "levels" | "peakHeight" | "lowlandFlatness">, elevation: number): number {
  const { sea, peak } = terrain.levels;
  if (elevation < sea || peak <= sea) return 0;
  const u = (elevation - sea) / (peak - sea);
  return (u + terrain.lowlandFlatness * (u * u * u - u)) * terrain.peakHeight;
}
