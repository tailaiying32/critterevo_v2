import { riverWidthAt } from "./rivers.js";
import { Biome, classifyBiome, classifyTerrain, isWater, TerrainType, type TerrainData } from "./types.js";

/**
 * Point queries on the continuous terrain field (docs/DESIGN.md §4.2).
 *
 * Values are blended bilinearly between the four nearest samples. Beyond the
 * outermost samples the edge values extend outward. The GPU terrain shader
 * implements the same math, so the screen shows exactly what these return.
 * Arithmetic only, so results are identical on every engine.
 */
export function sampleField(terrain: TerrainData, field: ArrayLike<number>, x: number, y: number): number {
  const { cols, rows, cellSize } = terrain;
  const gx = x / cellSize - 0.5;
  const gy = y / cellSize - 0.5;
  const fx0 = Math.floor(gx);
  const fy0 = Math.floor(gy);
  const tx = gx - fx0;
  const ty = gy - fy0;
  const c0 = clamp(fx0, cols - 1);
  const c1 = clamp(fx0 + 1, cols - 1);
  const r0 = clamp(fy0, rows - 1);
  const r1 = clamp(fy0 + 1, rows - 1);
  const a = field[r0 * cols + c0]!;
  const b = field[r0 * cols + c1]!;
  const c = field[r1 * cols + c0]!;
  const d = field[r1 * cols + c1]!;
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

function clamp(i: number, max: number): number {
  return i < 0 ? 0 : i > max ? max : i;
}

export function elevationAt(terrain: TerrainData, x: number, y: number): number {
  return sampleField(terrain, terrain.elevation, x, y);
}

/** °F. */
export function temperatureAt(terrain: TerrainData, x: number, y: number): number {
  return sampleField(terrain, terrain.temperature, x, y);
}

export function moistureAt(terrain: TerrainData, x: number, y: number): number {
  return sampleField(terrain, terrain.moisture, x, y);
}

/** Approximate distance to water in world units. Infinity if the world has no water. */
export function waterDistanceAt(terrain: TerrainData, x: number, y: number): number {
  return sampleField(terrain, terrain.waterDistance, x, y);
}

/** Signed water depth: positive in seas and lakes, negative on land. Rivers are not included. */
export function waterLevelAt(terrain: TerrainData, x: number, y: number): number {
  return sampleField(terrain, terrain.water, x, y);
}

/** Width of the river at the point, or 0 if there is none. */
export function riverWidthAtPoint(terrain: TerrainData, x: number, y: number): number {
  return riverWidthAt(terrain.rivers, terrain.width, terrain.height, x, y);
}

export function terrainTypeAt(terrain: TerrainData, x: number, y: number): TerrainType {
  const type = classifyTerrain(terrain.levels, elevationAt(terrain, x, y), waterLevelAt(terrain, x, y));
  if (isWater(type)) return type;
  const river = riverWidthAtPoint(terrain, x, y);
  if (river > 0) return river >= terrain.levels.deepRiverWidth ? TerrainType.DeepWater : TerrainType.ShallowWater;
  return type;
}

export function biomeAt(terrain: TerrainData, x: number, y: number): Biome {
  if (isWater(terrainTypeAt(terrain, x, y))) return Biome.None;
  return classifyBiome(terrain.levels, temperatureAt(terrain, x, y), moistureAt(terrain, x, y));
}

/** 0 on land. For water, 0 at the shore to 1 at the deepest point of the world. Rivers report their own depth. */
export function waterDepthAt(terrain: TerrainData, x: number, y: number): number {
  const level = waterLevelAt(terrain, x, y);
  if (level > 0) return terrain.levels.maxDepth > 0 ? level / terrain.levels.maxDepth : 0;
  const river = riverWidthAtPoint(terrain, x, y);
  return river > 0 ? Math.min(1, river / (2 * terrain.levels.deepRiverWidth)) : 0;
}

/** 0 at sea level to 1 at the highest peak. 0 below sea level. */
export function heightAboveSeaAt(terrain: TerrainData, x: number, y: number): number {
  const e = elevationAt(terrain, x, y);
  const sea = Math.min(terrain.levels.sea, 1);
  return e >= sea && sea < 1 ? (e - sea) / (1 - sea) : 0;
}
