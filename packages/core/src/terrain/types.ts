/** Terrain types, stored per cell as a Uint8 (docs/DESIGN.md §4.3). */
export const TerrainType = {
  DeepWater: 0,
  ShallowWater: 1,
  Land: 2,
  Mountain: 3,
} as const;
export type TerrainType = (typeof TerrainType)[keyof typeof TerrainType];

export const TERRAIN_TYPE_NAMES: readonly string[] = ["Deep water", "Shallow water", "Land", "Mountain"];

export function isWater(type: number): boolean {
  return type === TerrainType.DeepWater || type === TerrainType.ShallowWater;
}

/** Biomes, stored per cell as a Uint8 (docs/DESIGN.md §4.4). Water cells are None. */
export const Biome = {
  None: 0,
  Desert: 1,
  Savanna: 2,
  Rainforest: 3,
  Grassland: 4,
  TemperateForest: 5,
  TemperateRainforest: 6,
  Tundra: 7,
  Taiga: 8,
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];

export const BIOME_NAMES: readonly string[] = [
  "None",
  "Desert",
  "Savanna",
  "Rainforest",
  "Grassland",
  "Temperate forest",
  "Temperate rainforest",
  "Tundra",
  "Taiga",
];

/** Band indices used by the biome lookup. */
export const TemperatureBand = { Cold: 0, Temperate: 1, Hot: 2 } as const;
export const MoistureBand = { Dry: 0, Moderate: 1, Wet: 2 } as const;

/**
 * Whittaker-style lookup: BIOME_TABLE[temperatureBand][moistureBand].
 * Exported so the GPU terrain shader can be generated from the same table.
 */
export const BIOME_TABLE: readonly (readonly Biome[])[] = [
  [Biome.Tundra, Biome.Taiga, Biome.Taiga],
  [Biome.Grassland, Biome.TemperateForest, Biome.TemperateRainforest],
  [Biome.Desert, Biome.Savanna, Biome.Rainforest],
];

export function biomeFor(temperatureBand: number, moistureBand: number): Biome {
  return BIOME_TABLE[temperatureBand]?.[moistureBand] ?? Biome.None;
}

/**
 * Thresholds that classify the continuous terrain field. Computed once per world
 * from the coverage knobs. A threshold of Infinity selects nothing.
 */
export interface TerrainLevels {
  /** Sea level: elevation below this is sea. */
  sea: number;
  /** Water at least this deep (signed water depth) is deep water. */
  deep: number;
  /** The deepest water in the world, for normalizing depth to 0..1. */
  maxDepth: number;
  /** Non-water at or above this elevation is mountain. */
  mountain: number;
  /** Moisture below this is dry. */
  dry: number;
  /** Moisture at or above this is wet. Wet wins over dry. */
  wet: number;
  /** Temperature (°F) below this is cold. */
  cold: number;
  /** Temperature (°F) at or above this is hot. */
  hot: number;
  /** Rivers at least this wide (world units) are deep water; narrower ones are shallow. */
  deepRiverWidth: number;
}

/**
 * The terrain: a continuous field stored as samples at cell centers
 * (docs/DESIGN.md §4.2), plus rivers stored as line segments. Values between
 * samples are blended bilinearly, and terrain type and biome at any point come
 * from classifying the blended values against `levels`, then checking rivers.
 * Plain data with typed arrays, so it can be transferred to the main thread and
 * saved. Sample (col, row) is at index row * cols + col and sits at world point
 * ((col + 0.5) * cellSize, (row + 0.5) * cellSize).
 */
export interface TerrainData {
  cols: number;
  rows: number;
  /** Spacing between samples in world units. */
  cellSize: number;
  /** World size, which bounds the rivers. */
  width: number;
  height: number;
  levels: TerrainLevels;
  /** 0 (lowest sample in the world) to 1 (highest). */
  elevation: Float32Array;
  /**
   * Signed water depth: the surface level of the nearest sea or lake minus the
   * elevation. Positive in water, negative on land, zero at the shoreline.
   */
  water: Float32Array;
  /** °F. */
  temperature: Float32Array;
  /** 0 (driest sample) to 1 (wettest). */
  moisture: Float32Array;
  /** Approximate distance to the nearest water (sea, lake, or river), in world units. Infinity if there is none. */
  waterDistance: Float32Array;
  /** River segments: x1, y1, x2, y2, width per segment (RIVER_STRIDE floats). */
  rivers: Float32Array;
  /** Terrain type at each sample point. Used for statistics; point queries use terrainTypeAt. */
  terrainType: Uint8Array;
  /** Biome at each sample point. Used for statistics; point queries use biomeAt. */
  biome: Uint8Array;
}

/** Terrain type from the continuous field alone, before rivers. */
export function classifyTerrain(levels: TerrainLevels, elevation: number, water: number): TerrainType {
  if (water > 0) return water >= levels.deep ? TerrainType.DeepWater : TerrainType.ShallowWater;
  return elevation >= levels.mountain ? TerrainType.Mountain : TerrainType.Land;
}

export function classifyBiome(levels: TerrainLevels, temperature: number, moisture: number): Biome {
  const tBand =
    temperature < levels.cold ? TemperatureBand.Cold : temperature >= levels.hot ? TemperatureBand.Hot : TemperatureBand.Temperate;
  const mBand = moisture >= levels.wet ? MoistureBand.Wet : moisture < levels.dry ? MoistureBand.Dry : MoistureBand.Moderate;
  return biomeFor(tBand, mBand);
}
