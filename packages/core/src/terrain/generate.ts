import type { WorldConfig } from "../config.js";
import { Rng } from "../rng.js";
import { Biome, classifyBiome } from "./biomes.js";
import { distanceToWater, generateRainfall, generateTemperature } from "./climate.js";
import { createFractalNoise, type FractalNoiseSettings } from "./noise.js";
import { classifyTerrain, isWater, type TerrainData, type TerrainLevels, type TerrainType } from "./types.js";

/**
 * Generates the terrain grid (docs/DESIGN.md §4.2.1): fractal elevation at each
 * cell center, terrain types from elevation thresholds chosen so each type covers
 * the share of the world its knob asks for, then the climate. Pure function of
 * the config.
 */
export function generateTerrain(config: WorldConfig): TerrainData {
  const cellSize = config.cellSize;
  const cols = Math.max(1, Math.ceil(config.width / cellSize));
  const rows = Math.max(1, Math.ceil(config.height / cellSize));
  const n = cols * rows;

  // Climate noise uses the same gentle settings as elevation, so it adds no bumps of its own.
  const noise: FractalNoiseSettings = {
    wavelength: config.landformSize,
    octaves: config.octaves,
    persistence: config.persistence,
    lacunarity: config.lacunarity,
  };
  const elevationNoise = createFractalNoise(Rng.derive(config.seed, "terrain"), noise);
  const elevation = new Float32Array(n);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      elevation[row * cols + col] = elevationNoise((col + 0.5) * cellSize, (row + 0.5) * cellSize);
    }
  }

  const levels = coverageLevels(elevation, config);
  const terrainType = new Uint8Array(n);
  for (let i = 0; i < n; i++) terrainType[i] = classifyTerrain(levels, elevation[i]!);

  const grid = { cols, rows, cellSize, levels, peakHeight: config.peakHeight, lowlandFlatness: config.lowlandFlatness, elevation };
  const temperature = generateTemperature(config, grid, noise);
  const distance = distanceToWater(cols, rows, cellSize, terrainType);
  const rainfall = generateRainfall(config, grid, noise, distance);
  // Each cell's biome comes from its own stored climate and nothing else (docs/DESIGN.md §4.2.1 step 8).
  const biome = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    biome[i] = isWater(terrainType[i] as TerrainType) ? Biome.None : classifyBiome(temperature[i]!, rainfall[i]!);
  }

  return {
    cols,
    rows,
    cellSize,
    width: config.width,
    height: config.height,
    levels,
    peakHeight: config.peakHeight,
    lowlandFlatness: config.lowlandFlatness,
    elevation,
    terrainType,
    temperature,
    distanceToWater: distance,
    rainfall,
    biome,
  };
}

/**
 * Elevation thresholds that give water, shallow water, and mountains their
 * coverage shares (docs/DESIGN.md §4.2.1 step 3). Coverage holds whatever the
 * noise settings, so tuning the noise never changes how much water there is.
 */
function coverageLevels(elevation: Float32Array, config: WorldConfig): TerrainLevels {
  const sorted = elevation.slice().sort();
  const n = sorted.length;
  // The elevation with exactly `count` cells below it.
  const withCellsBelow = (count: number) => (count >= n ? Infinity : sorted[count]!);
  const waterCells = Math.round((n * config.waterCoverage) / 100);
  const shallowCells = Math.round((waterCells * config.shallowWaterShare) / 100);
  const mountainCells = Math.round((n * config.mountainCoverage) / 100);
  return {
    sea: withCellsBelow(waterCells),
    shallow: withCellsBelow(waterCells - shallowCells),
    mountain: withCellsBelow(n - mountainCells),
    peak: sorted[n - 1]!,
  };
}
