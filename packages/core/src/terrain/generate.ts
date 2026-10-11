import type { WorldConfig } from "../config.js";
import { Rng } from "../rng.js";
import { chamferDistance, chamferNearest } from "./distance.js";
import { DEFAULT_EROSION, erode } from "./erosion.js";
import { flowAccumulation, priorityFlood } from "./hydrology.js";
import { createFractalNoise, createOctaveNoise } from "./noise.js";
import { traceRivers } from "./rivers.js";
import { biomeAt, terrainTypeAt } from "./sample.js";
import { type TerrainData, type TerrainLevels } from "./types.js";

/** Octaves used for the local temperature variation field. */
const TEMPERATURE_OCTAVES = 3;
/** Height of the tallest peak during erosion, in world units. Sets how steep slopes are to the raindrops. */
const EROSION_RELIEF = 125;
/** Upper bound on raindrops, so very large worlds still generate in reasonable time. */
const MAX_EROSION_DROPS = 2_500_000;
/** A pit must fill at least this many samples to become a lake. */
const MIN_LAKE_SAMPLES = 12;
/** Fill depth below which a sample is not part of a filled pit. */
const FILL_EPSILON = 1e-6;
/** River width in world units per world unit of sqrt(drainage area), at a river width knob of 1. */
const RIVER_WIDTH_PER_SQRT_AREA = 0.02;
/** Narrowest river, in world units. */
const MIN_RIVER_WIDTH = 1.5;

/**
 * Generates the terrain for a world (docs/DESIGN.md §4.2.1).
 *
 * Pure function of the config. Uses only arithmetic, Math.floor, Math.round, and
 * Math.sqrt, all of which are identical across JavaScript engines, so the same
 * seed produces the same terrain in every browser.
 */
export function generateTerrain(config: WorldConfig): TerrainData {
  const cellSize = config.cellSize;
  const cols = Math.max(1, Math.ceil(config.width / cellSize));
  const rows = Math.max(1, Math.ceil(config.height / cellSize));
  const n = cols * rows;
  const cellX = (i: number) => ((i % cols) + 0.5) * cellSize;
  const cellY = (i: number) => (Math.floor(i / cols) + 0.5) * cellSize;
  const isBorder = (i: number) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return c === 0 || r === 0 || c === cols - 1 || r === rows - 1;
  };

  // --- 1. Elevation: gentle fractal noise with optional edge falloff ---
  const noise = createOctaveNoise(Rng.derive(config.seed, "terrain.elevation"), {
    featureSize: config.elevationFeatureSize,
    octaves: config.elevationOctaves,
    persistence: config.elevationPersistence,
    lacunarity: config.elevationLacunarity,
  });
  let amplitudeSum = 0;
  for (let o = 0; o < noise.octaves; o++) amplitudeSum += noise.amplitude(o);
  let height: Float64Array = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = cellX(i);
    const y = cellY(i);
    let e = noise.sum(x, y, 0, noise.octaves) / amplitudeSum;
    if (config.edgeFalloff > 0) {
      // 0 at the center, 1 at the walls. The 4th power keeps the interior untouched.
      const nx = Math.abs((2 * x) / config.width - 1);
      const ny = Math.abs((2 * y) / config.height - 1);
      const edge = Math.min(1, Math.max(nx, ny));
      const edge2 = edge * edge;
      e -= 2 * config.edgeFalloff * edge2 * edge2;
    }
    height[i] = e;
  }
  height = normalize(height);

  // --- 2. Flatten lowlands: h -> h + flatness * (h^3 - h) on land height above sea level ---
  // Monotonic and fixed at sea level and the top, so it flattens plains and steepens peaks
  // without changing which ground is below sea level.
  if (config.lowlandFlatness > 0) {
    const sea = lowerThreshold(height, config.waterCoverage / 100);
    if (sea < 1) {
      for (let i = 0; i < n; i++) {
        const e = height[i]!;
        if (e < sea) continue;
        const h = (e - sea) / (1 - sea);
        height[i] = sea + (1 - sea) * (h + config.lowlandFlatness * (h * h * h - h));
      }
    }
  }

  // --- 3. Hydraulic erosion: simulated rain carves valleys and smooths slopes ---
  // Raindrops stop at lake basins found beforehand, so erosion builds deltas at
  // their shores instead of filling them with sediment.
  if (config.erosionAmount > 0 && cols > 2 && rows > 2) {
    const preSea = lowerThreshold(height, config.waterCoverage / 100);
    const preSeaTest = (i: number) => height[i]! < preSea;
    const preDrainage = priorityFlood(height, cols, rows, (i) => preSeaTest(i) || isBorder(i));
    const basins = findLakes(height, preDrainage.filled, cols, rows, preSeaTest, config.lakeMinDepth).lakeId;
    const stopAt = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (basins[i]! >= 0) stopAt[i] = 1;

    const relief = EROSION_RELIEF / cellSize; // in sample units
    for (let i = 0; i < n; i++) height[i] = height[i]! * relief;
    erode(
      height,
      cols,
      rows,
      Rng.derive(config.seed, "terrain.erosion"),
      { ...DEFAULT_EROSION, drops: Math.min(MAX_EROSION_DROPS, Math.round(config.erosionAmount * n)) },
      stopAt,
    );
    // Erosion leaves rills one sample wide, which notch coastlines into a sawtooth.
    // One light blur removes them and keeps the wider valleys.
    height = normalize(blur3x3(height, cols, rows));
  }

  // Stored as Float32, and every threshold below is computed from the stored values,
  // so point queries (which read the Float32 arrays) agree exactly with generation.
  const elevation = Float32Array.from(height);

  // --- 4. Sea level and mountains by coverage ---
  const sea = lowerThreshold(elevation, config.waterCoverage / 100);
  const aboveSea: number[] = [];
  for (let i = 0; i < n; i++) if (elevation[i]! >= sea) aboveSea.push(elevation[i]!);
  const mountain = upperThreshold(aboveSea, config.mountainCoverage / 100);

  // --- 5. Drainage: flood from the sea and the world's edge, where rivers can leave the map ---
  const isSea = (i: number) => elevation[i]! < sea;
  const drainage = priorityFlood(elevation, cols, rows, (i) => isSea(i) || isBorder(i));

  // --- 6. Lakes: filled pits that are deep and large enough ---
  const { lakeId, surfaces: lakeSurfaces } = findLakes(elevation, drainage.filled, cols, rows, isSea, config.lakeMinDepth);

  // --- 7. Signed water depth: surface of the nearest sea or lake, minus elevation ---
  const surfaceOf = (i: number) => (lakeId[i]! >= 0 ? lakeSurfaces[lakeId[i]!]! : sea);
  const nearest = chamferNearest((i) => isSea(i) || lakeId[i]! >= 0, surfaceOf, sea, cols, rows);
  const water = new Float32Array(n);
  for (let i = 0; i < n; i++) water[i] = nearest.value[i]! - elevation[i]!;

  const waterDepths: number[] = [];
  let maxDepth = 0;
  for (let i = 0; i < n; i++) {
    if (water[i]! > 0) {
      waterDepths.push(water[i]!);
      maxDepth = Math.max(maxDepth, water[i]!);
    }
  }
  // The shallowest share of water is shallow; the rest is deep.
  const deep = lowerThreshold(Float64Array.from(waterDepths), config.shallowWaterShare / 100);

  // --- 8. Rivers: wherever enough upstream area collects ---
  const flow = flowAccumulation(drainage, n);
  const riverThreshold = config.riverSourceArea / (cellSize * cellSize);
  const isWaterSample = (i: number) => water[i]! > 0;
  const isRiver = (i: number) => !isWaterSample(i) && flow[i]! >= riverThreshold;
  const widthAt = (i: number) =>
    Math.max(MIN_RIVER_WIDTH, config.riverWidth * RIVER_WIDTH_PER_SQRT_AREA * cellSize * Math.sqrt(flow[i]!));
  const rivers = traceRivers({
    cols,
    rows,
    cellSize,
    worldWidth: config.width,
    worldHeight: config.height,
    receiver: drainage.receiver,
    flow,
    isWater: isWaterSample,
    isRiver,
    widthAt,
  });

  // --- 9. Distance to any water, rivers included ---
  const distanceCells = chamferDistance((i) => isWaterSample(i) || isRiver(i), cols, rows);
  const waterDistance = new Float32Array(n);
  for (let i = 0; i < n; i++) waterDistance[i] = distanceCells[i]! * cellSize;

  // --- 10. Moisture: fractal noise plus a boost that fades with distance from water ---
  const moistureNoise = createFractalNoise(Rng.derive(config.seed, "terrain.moisture"), {
    featureSize: config.moistureFeatureSize,
    octaves: config.moistureOctaves,
    persistence: 0.5,
    lacunarity: 2,
  });
  const rawMoisture = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = moistureNoise(cellX(i), cellY(i));
    if (config.waterMoistureRange > 0) {
      const fade = 1 - waterDistance[i]! / config.waterMoistureRange;
      if (fade > 0) m += config.waterMoistureBoost * fade;
    }
    rawMoisture[i] = m;
  }
  const moisture = Float32Array.from(normalize(rawMoisture));

  // --- 11. Temperature (°F): latitude curve + noise - elevation cooling ---
  const temperatureNoise = createFractalNoise(Rng.derive(config.seed, "terrain.temperature"), {
    featureSize: config.temperatureFeatureSize,
    octaves: TEMPERATURE_OCTAVES,
    persistence: 0.5,
    lacunarity: 2,
  });
  const seaRef = Math.min(sea, 1);
  const temperature = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const lat = Math.abs((2 * (row + 0.5)) / rows - 1); // 0 at the middle row, 1 at the edges
    const warmth = 1 - lat * lat;
    let t = config.poleTemperature + (config.equatorTemperature - config.poleTemperature) * warmth;
    if (config.temperatureVariation > 0) t += config.temperatureVariation * temperatureNoise(cellX(i), cellY(i));
    const e = elevation[i]!;
    const heightAboveSea = e >= seaRef && seaRef < 1 ? (e - seaRef) / (1 - seaRef) : 0;
    t -= config.elevationCooling * heightAboveSea;
    temperature[i] = t;
  }

  // --- 12. Biome thresholds: moisture bands by coverage of land ---
  const landMoisture: number[] = [];
  for (let i = 0; i < n; i++) if (!isWaterSample(i)) landMoisture.push(moisture[i]!);
  const levels: TerrainLevels = {
    sea,
    deep,
    maxDepth,
    mountain,
    dry: lowerThreshold(Float64Array.from(landMoisture), config.dryCoverage / 100),
    wet: upperThreshold(landMoisture, config.wetCoverage / 100),
    cold: config.coldThreshold,
    hot: config.hotThreshold,
    deepRiverWidth: config.deepRiverWidth,
  };

  const terrain: TerrainData = {
    cols,
    rows,
    cellSize,
    width: config.width,
    height: config.height,
    levels,
    elevation,
    water,
    temperature,
    moisture,
    waterDistance,
    rivers,
    terrainType: new Uint8Array(n),
    biome: new Uint8Array(n),
  };

  // Per-sample classification for statistics, from the same point queries everything else uses.
  for (let i = 0; i < n; i++) {
    terrain.terrainType[i] = terrainTypeAt(terrain, cellX(i), cellY(i));
    terrain.biome[i] = biomeAt(terrain, cellX(i), cellY(i));
  }
  return terrain;
}

/**
 * Finds lakes: pits that the drainage flood filled, at least MIN_LAKE_SAMPLES in
 * size and at least minDepth deep below their spill level. Each lake's surface
 * is its spill level, the lowest elevation on its rim.
 */
function findLakes(
  elevation: ArrayLike<number>,
  filled: Float64Array,
  cols: number,
  rows: number,
  isSea: (i: number) => boolean,
  minDepth: number,
): { lakeId: Int32Array; surfaces: number[] } {
  const n = cols * rows;
  const lakeId = new Int32Array(n).fill(-1);
  const surfaces: number[] = [];
  const inPit = (i: number) => !isSea(i) && filled[i]! - elevation[i]! > FILL_EPSILON;
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const members: number[] = [];
  for (let start = 0; start < n; start++) {
    if (seen[start] || !inPit(start)) continue;
    members.length = 0;
    stack.push(start);
    seen[start] = 1;
    let spill = Infinity;
    let deepest = Infinity;
    while (stack.length > 0) {
      const i = stack.pop()!;
      members.push(i);
      deepest = Math.min(deepest, elevation[i]!);
      const c = i % cols;
      const r = Math.floor(i / cols);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dc === 0 && dr === 0) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const j = nr * cols + nc;
          if (inPit(j)) {
            if (!seen[j]) {
              seen[j] = 1;
              stack.push(j);
            }
          } else {
            spill = Math.min(spill, elevation[j]!);
          }
        }
      }
    }
    if (members.length >= MIN_LAKE_SAMPLES && Number.isFinite(spill) && spill - deepest >= minDepth) {
      const id = surfaces.length;
      surfaces.push(spill);
      for (const i of members) lakeId[i] = id;
    }
  }
  return { lakeId, surfaces };
}

/** One pass of a 3x3 binomial blur (weights 1-2-1), clamping at the edges. */
function blur3x3(values: Float64Array, cols: number, rows: number): Float64Array {
  const at = (c: number, r: number) =>
    values[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))]!;
  const out = new Float64Array(values.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out[r * cols + c] =
        (at(c - 1, r - 1) + 2 * at(c, r - 1) + at(c + 1, r - 1) +
          2 * at(c - 1, r) + 4 * at(c, r) + 2 * at(c + 1, r) +
          at(c - 1, r + 1) + 2 * at(c, r + 1) + at(c + 1, r + 1)) /
        16;
    }
  }
  return out;
}

/** Rescales values linearly to [0, 1]. A constant field becomes all zeros. */
function normalize(values: Float64Array): Float64Array {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const out = new Float64Array(values.length);
  if (range > 0) for (let i = 0; i < values.length; i++) out[i] = (values[i]! - min) / range;
  return out;
}

/**
 * Threshold T such that the given share of values are strictly below T.
 * share 0 selects nothing; share 1 selects everything.
 */
function lowerThreshold(values: ArrayLike<number>, share: number): number {
  const sorted = Float64Array.from(values).sort();
  const count = Math.round(Math.min(1, Math.max(0, share)) * sorted.length);
  return count >= sorted.length ? Infinity : sorted[count]!;
}

/**
 * Threshold T such that the given share of values are at or above T.
 * share 0 selects nothing; share 1 selects everything.
 */
function upperThreshold(values: ArrayLike<number>, share: number): number {
  const sorted = Float64Array.from(values).sort();
  const count = Math.round(Math.min(1, Math.max(0, share)) * sorted.length);
  return count === 0 ? Infinity : sorted[sorted.length - count]!;
}
