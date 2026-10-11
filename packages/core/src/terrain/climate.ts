import type { WorldConfig } from "../config.js";
import { Rng } from "../rng.js";
import { createFractalNoise, type FractalNoiseSettings } from "./noise.js";
import { heightOf, isWater, type TerrainLevels, type TerrainType } from "./types.js";

/** The grid and land a climate field is computed over. */
export interface ClimateGrid {
  cols: number;
  rows: number;
  cellSize: number;
  levels: TerrainLevels;
  peakHeight: number;
  lowlandFlatness: number;
  elevation: Float32Array;
}

/**
 * Mean annual temperature at sea level on a row, in °F (docs/DESIGN.md §4.2.1
 * step 6). The sea-level temperature, minus latitude cooling × lat², where lat
 * is 0 on the middle row and 1 at the top and bottom edges. With latitude
 * cooling at 0 (the default) it is the same everywhere. A polynomial, not a
 * cosine, keeps it identical on every JavaScript engine.
 */
export function seaLevelTemperatureAt(config: WorldConfig, y: number): number {
  const half = config.height / 2;
  const lat = Math.min(1, Math.abs(y - half) / half);
  return config.seaLevelTemperature - config.latitudeCooling * lat * lat;
}

/**
 * Mean annual temperature of each cell in °F: the sea-level temperature, plus
 * noise of up to ± the temperature variation, minus the lapse rate times height
 * above sea level. Water is at height 0, so it has sea-level temperature.
 */
export function generateTemperature(config: WorldConfig, grid: ClimateGrid, noise: FractalNoiseSettings): Float32Array {
  const { cols, rows, cellSize, elevation } = grid;
  const variation = createFractalNoise(Rng.derive(config.seed, "temperature"), noise);
  const temperature = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    const y = (row + 0.5) * cellSize;
    const base = seaLevelTemperatureAt(config, y);
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const x = (col + 0.5) * cellSize;
      const wander = (2 * variation(x, y) - 1) * config.temperatureNoise;
      temperature[i] = base + wander - (config.lapseRate * heightOf(grid, elevation[i]!)) / 1000;
    }
  }
  return temperature;
}

/**
 * Distance from each cell to the nearest water cell, in world units
 * (docs/DESIGN.md §4.2.1 step 5). A two-pass chamfer transform: steps to the
 * eight neighbors cost one cell across or one cell diagonally, so distances are
 * close to straight-line. Infinity everywhere if there is no water.
 */
export function distanceToWater(cols: number, rows: number, cellSize: number, terrainType: Uint8Array): Float32Array {
  const straight = cellSize;
  const diagonal = cellSize * Math.SQRT2;
  const distance = new Float32Array(cols * rows);
  terrainType.forEach((type, i) => (distance[i] = isWater(type as TerrainType) ? 0 : Infinity));
  const relax = (i: number, col: number, row: number, step: number) => {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return;
    const through = distance[row * cols + col]! + step;
    if (through < distance[i]!) distance[i] = through;
  };
  // Forward pass from the top-left corner: neighbors above and to the left.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      relax(i, col - 1, row, straight);
      relax(i, col - 1, row - 1, diagonal);
      relax(i, col, row - 1, straight);
      relax(i, col + 1, row - 1, diagonal);
    }
  }
  // Backward pass from the bottom-right corner: neighbors below and to the right.
  for (let row = rows - 1; row >= 0; row--) {
    for (let col = cols - 1; col >= 0; col--) {
      const i = row * cols + col;
      relax(i, col + 1, row, straight);
      relax(i, col + 1, row + 1, diagonal);
      relax(i, col, row + 1, straight);
      relax(i, col - 1, row + 1, diagonal);
    }
  }
  return distance;
}

/**
 * Annual rainfall of each cell in inches (docs/DESIGN.md §4.2.1 step 7). Wetness
 * is moisture noise minus inland drying, which grows with distance from water up
 * to the inland drying range. Wetness is converted to rainfall by rank, so the
 * spread from the driest to the wettest knob holds whatever the noise settings. With r the rank as a fraction,
 * rainfall is driest + (wettest − driest) × (r + skew × (r² − r)): at skew 0 it
 * is spread evenly, and at skew 1 most land is moderate to dry and very wet
 * places are rare. Then extra rain near water is added, fading linearly to
 * nothing at the shore rain range.
 */
export function generateRainfall(
  config: WorldConfig,
  grid: Pick<ClimateGrid, "cols" | "rows" | "cellSize">,
  noise: FractalNoiseSettings,
  distance: Float32Array,
): Float32Array {
  const { cols, rows, cellSize } = grid;
  const n = cols * rows;
  const moistureNoise = createFractalNoise(Rng.derive(config.seed, "moisture"), noise);
  const moisture = new Float32Array(n);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const inland = Math.min(1, distance[i]! / config.inlandDryingRange);
      moisture[i] = moistureNoise((col + 0.5) * cellSize, (row + 0.5) * cellSize) - config.inlandDrying * inland;
    }
  }

  // Ties break by cell index, so the order is the same on every engine.
  const order = new Uint32Array(n).map((_, i) => i).sort((a, b) => moisture[a]! - moisture[b]! || a - b);
  const rainfall = new Float32Array(n);
  const span = config.wettestRainfall - config.driestRainfall;
  const skew = config.rainfallSkew;
  const range = config.shoreRainRange;
  order.forEach((cell, rank) => {
    const r = n > 1 ? rank / (n - 1) : 0;
    const spread = config.driestRainfall + span * (r + skew * (r * r - r));
    const shore = range > 0 ? Math.max(0, 1 - distance[cell]! / range) : distance[cell] === 0 ? 1 : 0;
    rainfall[cell] = spread + config.shoreRain * shore;
  });
  return rainfall;
}
