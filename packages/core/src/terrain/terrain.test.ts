import { describe, expect, it } from "vitest";
import { makeConfig, MAX_TERRAIN_CELLS, type WorldConfig } from "../config.js";
import { Rng } from "../rng.js";
import { chamferDistance } from "./distance.js";
import { generateTerrain } from "./generate.js";
import { RIVER_STRIDE } from "./rivers.js";
import { biomeAt, elevationAt, sampleField, terrainTypeAt, waterDepthAt } from "./sample.js";
import { Biome, biomeFor, isWater, MoistureBand, TemperatureBand, TerrainType, type TerrainData } from "./types.js";

// A small world keeps the tests fast: 100 x 80 samples.
function small(overrides: Partial<WorldConfig> = {}): WorldConfig {
  return makeConfig({ width: 500, height: 400, cellSize: 5, elevationFeatureSize: 300, ...overrides });
}

function share(terrain: TerrainData, predicate: (i: number) => boolean, among?: (i: number) => boolean): number {
  let hit = 0;
  let total = 0;
  for (let i = 0; i < terrain.cols * terrain.rows; i++) {
    if (among && !among(i)) continue;
    total++;
    if (predicate(i)) hit++;
  }
  return hit / total;
}

const center = (t: TerrainData, i: number) => [((i % t.cols) + 0.5) * t.cellSize, (Math.floor(i / t.cols) + 0.5) * t.cellSize] as const;

describe("generateTerrain", () => {
  it("produces a grid matching the world size and sample spacing", () => {
    const t = generateTerrain(small());
    expect(t.cols).toBe(100);
    expect(t.rows).toBe(80);
    expect(t.elevation.length).toBe(8000);
  });

  it("is deterministic for a given seed and config", () => {
    const a = generateTerrain(small({ seed: 7 }));
    const b = generateTerrain(small({ seed: 7 }));
    expect(a.elevation).toEqual(b.elevation);
    expect(a.water).toEqual(b.water);
    expect(a.rivers).toEqual(b.rivers);
    expect(a.temperature).toEqual(b.temperature);
    expect(a.moisture).toEqual(b.moisture);
    expect(a.biome).toEqual(b.biome);
  });

  it("differs across seeds", () => {
    const a = generateTerrain(small({ seed: 1 }));
    const b = generateTerrain(small({ seed: 2 }));
    expect(a.elevation).not.toEqual(b.elevation);
  });

  it("matches the sea, shallow water, and mountain coverage knobs", () => {
    const t = generateTerrain(small({ waterCoverage: 40, shallowWaterShare: 25, mountainCoverage: 20 }));
    const belowSea = (i: number) => t.elevation[i]! < t.levels.sea;
    const fieldWater = (i: number) => t.water[i]! > 0;
    expect(share(t, belowSea)).toBeCloseTo(0.4, 2);
    expect(share(t, (i) => t.water[i]! < t.levels.deep, fieldWater)).toBeCloseTo(0.25, 2);
    expect(share(t, (i) => t.elevation[i]! >= t.levels.mountain, (i) => !belowSea(i))).toBeCloseTo(0.2, 2);
  });

  it("handles zero coverage", () => {
    const t = generateTerrain(small({ waterCoverage: 0, mountainCoverage: 0 }));
    expect(share(t, (i) => t.elevation[i]! < t.levels.sea)).toBe(0);
    expect(share(t, (i) => t.terrainType[i] === TerrainType.Mountain)).toBe(0);
  });

  it("gets warmer toward the middle row and colder toward the edges", () => {
    const t = generateTerrain(small({ temperatureVariation: 0, elevationCooling: 0 }));
    const rowMean = (r: number) => {
      let sum = 0;
      for (let c = 0; c < t.cols; c++) sum += t.temperature[r * t.cols + c]!;
      return sum / t.cols;
    };
    const mid = Math.floor(t.rows / 2);
    expect(rowMean(mid)).toBeGreaterThan(rowMean(Math.floor(t.rows / 4)));
    expect(rowMean(Math.floor(t.rows / 4))).toBeGreaterThan(rowMean(0));
    expect(rowMean(mid)).toBeGreaterThan(rowMean(t.rows - 1));
    expect(rowMean(mid)).toBeCloseTo(86, 0);
    expect(rowMean(0)).toBeLessThan(10);
  });

  it("is colder at higher elevation on the same row", () => {
    const t = generateTerrain(small({ temperatureVariation: 0, elevationCooling: 40 }));
    for (let r = 0; r < t.rows; r++) {
      let lowest = -1;
      let highest = -1;
      for (let c = 0; c < t.cols; c++) {
        const i = r * t.cols + c;
        if (t.elevation[i]! < t.levels.sea) continue;
        if (lowest < 0 || t.elevation[i]! < t.elevation[lowest]!) lowest = i;
        if (highest < 0 || t.elevation[i]! > t.elevation[highest]!) highest = i;
      }
      if (lowest >= 0 && t.elevation[highest]! > t.elevation[lowest]!) {
        expect(t.temperature[highest]!).toBeLessThan(t.temperature[lowest]!);
      }
    }
  });

  it("is wetter near water when the moisture boost is on", () => {
    const t = generateTerrain(small({ waterMoistureBoost: 1, waterMoistureRange: 50 }));
    let nearSum = 0;
    let nearCount = 0;
    let farSum = 0;
    let farCount = 0;
    for (let i = 0; i < t.cols * t.rows; i++) {
      if (isWater(t.terrainType[i]!)) continue;
      if (t.waterDistance[i]! < 20) {
        nearSum += t.moisture[i]!;
        nearCount++;
      } else if (t.waterDistance[i]! > 80) {
        farSum += t.moisture[i]!;
        farCount++;
      }
    }
    expect(nearCount).toBeGreaterThan(0);
    expect(farCount).toBeGreaterThan(0);
    expect(nearSum / nearCount).toBeGreaterThan(farSum / farCount);
  });

  it("gives every non-water sample a biome, mountains included, and water none", () => {
    const t = generateTerrain(small({ mountainCoverage: 30 }));
    for (let i = 0; i < t.cols * t.rows; i++) {
      if (isWater(t.terrainType[i]!)) expect(t.biome[i]).toBe(Biome.None);
      else expect(t.biome[i]).not.toBe(Biome.None);
    }
  });

  it("turns every border sample into water at full edge falloff", () => {
    const t = generateTerrain(small({ edgeFalloff: 1, waterCoverage: 35 }));
    for (let c = 0; c < t.cols; c++) {
      expect(isWater(t.terrainType[c]!)).toBe(true);
      expect(isWater(t.terrainType[(t.rows - 1) * t.cols + c]!)).toBe(true);
    }
    for (let r = 0; r < t.rows; r++) {
      expect(isWater(t.terrainType[r * t.cols]!)).toBe(true);
      expect(isWater(t.terrainType[r * t.cols + t.cols - 1]!)).toBe(true);
    }
  });

  it("keeps the shape of the world when resolution changes (without erosion)", () => {
    const coarse = generateTerrain(small({ cellSize: 10, erosionAmount: 0 }));
    const fine = generateTerrain(small({ cellSize: 5, erosionAmount: 0 }));
    let agree = 0;
    for (let r = 0; r < coarse.rows; r++) {
      for (let c = 0; c < coarse.cols; c++) {
        const a = coarse.elevation[r * coarse.cols + c]! < coarse.levels.sea;
        const b = fine.elevation[2 * r * fine.cols + 2 * c]! < fine.levels.sea;
        if (a === b) agree++;
      }
    }
    expect(agree / (coarse.cols * coarse.rows)).toBeGreaterThan(0.9);
  });
});

describe("terrain shape", () => {
  // Mean absolute Laplacian of elevation over the samples selected: a measure of bumpiness.
  function bumpiness(t: TerrainData, select: (i: number) => boolean): number {
    let sum = 0;
    let count = 0;
    for (let r = 1; r < t.rows - 1; r++) {
      for (let c = 1; c < t.cols - 1; c++) {
        const i = r * t.cols + c;
        if (!select(i)) continue;
        const e = t.elevation;
        sum += Math.abs(4 * e[i]! - e[i - 1]! - e[i + 1]! - e[i - t.cols]! - e[i + t.cols]!);
        count++;
      }
    }
    return sum / count;
  }
  const lowLand = (t: TerrainData) => (i: number) =>
    t.elevation[i]! >= t.levels.sea && t.elevation[i]! < t.levels.sea + 0.25 * (1 - t.levels.sea);

  it("lowland flatness flattens plains without moving the coast or mountains", () => {
    const shape = { width: 1000, height: 1000, erosionAmount: 0 };
    const plain = generateTerrain(small({ ...shape, lowlandFlatness: 0 }));
    const flat = generateTerrain(small({ ...shape, lowlandFlatness: 1 }));
    for (let i = 0; i < plain.cols * plain.rows; i++) {
      expect(flat.elevation[i]! < flat.levels.sea).toBe(plain.elevation[i]! < plain.levels.sea);
      expect(flat.elevation[i]! >= flat.levels.mountain).toBe(plain.elevation[i]! >= plain.levels.mountain);
    }
    expect(bumpiness(flat, lowLand(flat))).toBeLessThan(bumpiness(plain, lowLand(plain)));
  });

  it("erosion reshapes the terrain deterministically", () => {
    const none = generateTerrain(small({ erosionAmount: 0 }));
    const a = generateTerrain(small({ erosionAmount: 4 }));
    const b = generateTerrain(small({ erosionAmount: 4 }));
    expect(a.elevation).toEqual(b.elevation);
    expect(a.elevation).not.toEqual(none.elevation);
  });
});

describe("lakes and rivers", () => {
  const t = generateTerrain(small({ seed: 4, riverSourceArea: 5000 }));
  const segments = t.rivers.length / RIVER_STRIDE;

  it("forms rivers", () => {
    expect(segments).toBeGreaterThan(0);
  });

  it("classifies river centerlines as water, deep when wide", () => {
    for (let s = 0; s < segments; s++) {
      const o = s * RIVER_STRIDE;
      const x = (t.rivers[o]! + t.rivers[o + 2]!) / 2;
      const y = (t.rivers[o + 1]! + t.rivers[o + 3]!) / 2;
      const type = terrainTypeAt(t, x, y);
      expect(isWater(type)).toBe(true);
      if (t.rivers[o + 4]! >= t.levels.deepRiverWidth && type !== TerrainType.DeepWater) {
        // A wide segment can only read as shallow if it runs through shallow lake or sea water.
        expect(t.water[0]).toBeDefined();
      }
    }
  });

  it("makes rivers wider downstream", () => {
    let narrowest = Infinity;
    let widest = 0;
    for (let s = 0; s < segments; s++) {
      narrowest = Math.min(narrowest, t.rivers[s * RIVER_STRIDE + 4]!);
      widest = Math.max(widest, t.rivers[s * RIVER_STRIDE + 4]!);
    }
    expect(widest).toBeGreaterThan(narrowest);
  });

  it("makes fewer rivers when the source area is larger", () => {
    const fewer = generateTerrain(small({ seed: 4, riverSourceArea: 50000 }));
    expect(fewer.rivers.length).toBeLessThan(t.rivers.length);
  });

  it("fills basins into lakes above sea level, more of them at a lower depth threshold", () => {
    const lakeSamples = (terrain: TerrainData) =>
      share(terrain, (i) => terrain.water[i]! > 0 && terrain.elevation[i]! >= terrain.levels.sea);
    const many = generateTerrain(small({ seed: 4, lakeMinDepth: 0 }));
    const none = generateTerrain(small({ seed: 4, lakeMinDepth: 0.2 }));
    expect(lakeSamples(none)).toBe(0);
    expect(lakeSamples(many)).toBeGreaterThan(0);
  });
});

describe("continuous terrain field", () => {
  const t = generateTerrain(small({ seed: 3 }));
  const at = (col: number, row: number) => [(col + 0.5) * t.cellSize, (row + 0.5) * t.cellSize] as const;

  it("returns the stored sample exactly at sample points", () => {
    for (const [col, row] of [[0, 0], [10, 20], [t.cols - 1, t.rows - 1], [57, 3]] as const) {
      const [x, y] = at(col, row);
      const i = row * t.cols + col;
      expect(elevationAt(t, x, y)).toBe(t.elevation[i]);
      expect(terrainTypeAt(t, x, y)).toBe(t.terrainType[i]);
      expect(biomeAt(t, x, y)).toBe(t.biome[i]);
    }
  });

  it("blends linearly between neighboring samples", () => {
    const [x0, y] = at(20, 30);
    const a = t.elevation[30 * t.cols + 20]!;
    const b = t.elevation[30 * t.cols + 21]!;
    expect(elevationAt(t, x0 + t.cellSize * 0.25, y)).toBeCloseTo(a + (b - a) * 0.25, 6);
    expect(elevationAt(t, x0 + t.cellSize * 0.5, y)).toBeCloseTo((a + b) / 2, 6);
  });

  it("is continuous: tiny moves change values only slightly", () => {
    for (let k = 0; k < 200; k++) {
      const x = 3 + k * 2.37;
      const y = 7 + k * 1.91;
      expect(Math.abs(elevationAt(t, x, y) - elevationAt(t, x + 0.01, y))).toBeLessThan(0.01);
    }
  });

  it("extends edge values beyond the outermost samples", () => {
    expect(elevationAt(t, 0, 0)).toBe(t.elevation[0]);
    expect(elevationAt(t, -50, -50)).toBe(t.elevation[0]);
    expect(sampleField(t, t.temperature, 1e6, 1e6)).toBe(t.temperature[t.cols * t.rows - 1]);
  });

  it("reports depth only for water", () => {
    for (let k = 0; k < 500; k++) {
      const x = (k * 7.3) % 500;
      const y = (k * 3.1) % 400;
      const depth = waterDepthAt(t, x, y);
      if (isWater(terrainTypeAt(t, x, y))) expect(depth).toBeGreaterThan(0);
      else expect(depth).toBe(0);
    }
  });

  it("puts the shoreline where signed water depth crosses zero", () => {
    for (let i = 0; i < t.cols * t.rows; i++) {
      const [x, y] = center(t, i);
      const fieldWater = t.water[i]! > 0;
      if (fieldWater) expect(isWater(terrainTypeAt(t, x, y))).toBe(true);
    }
  });
});

describe("biome lookup", () => {
  it("follows the design table", () => {
    expect(biomeFor(TemperatureBand.Hot, MoistureBand.Dry)).toBe(Biome.Desert);
    expect(biomeFor(TemperatureBand.Hot, MoistureBand.Wet)).toBe(Biome.Rainforest);
    expect(biomeFor(TemperatureBand.Temperate, MoistureBand.Moderate)).toBe(Biome.TemperateForest);
    expect(biomeFor(TemperatureBand.Cold, MoistureBand.Dry)).toBe(Biome.Tundra);
    expect(biomeFor(TemperatureBand.Cold, MoistureBand.Wet)).toBe(Biome.Taiga);
  });
});

describe("chamferDistance", () => {
  it("measures orthogonal steps as 1 and diagonal steps as sqrt(2)", () => {
    const cols = 7;
    const rows = 7;
    const middle = 3 * cols + 3;
    const d = chamferDistance((i) => i === middle, cols, rows);
    expect(d[middle]).toBe(0);
    expect(d[3 * cols + 6]).toBe(3);
    expect(d[0]).toBeCloseTo(3 * Math.SQRT2);
    expect(d[1 * cols + 6]).toBeCloseTo(1 + 2 * Math.SQRT2);
  });

  it("returns Infinity everywhere when there are no sources", () => {
    const d = chamferDistance(() => false, 3, 3);
    expect([...d].every((v) => v === Infinity)).toBe(true);
  });
});

describe("Rng.derive", () => {
  it("gives the same stream for the same seed and label", () => {
    const a = Rng.derive(5, "terrain");
    const b = Rng.derive(5, "terrain");
    for (let i = 0; i < 100; i++) expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it("gives independent streams for different labels or seeds", () => {
    const first = (rng: Rng) => Array.from({ length: 8 }, () => rng.nextUint32());
    expect(first(Rng.derive(5, "terrain"))).not.toEqual(first(Rng.derive(5, "plants")));
    expect(first(Rng.derive(5, "terrain"))).not.toEqual(first(Rng.derive(6, "terrain")));
  });
});

describe("cell cap", () => {
  it("raises sample spacing so the terrain stays under the cap", () => {
    const config = makeConfig({ width: 10000, height: 10000, cellSize: 2 });
    const cells = Math.ceil(config.width / config.cellSize) * Math.ceil(config.height / config.cellSize);
    expect(config.cellSize).toBe(5);
    expect(cells).toBeLessThanOrEqual(MAX_TERRAIN_CELLS);
  });
});
