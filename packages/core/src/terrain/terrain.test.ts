import { describe, expect, it } from "vitest";
import { makeConfig, type WorldConfig } from "../config.js";
import { generateTerrain } from "./generate.js";
import { Biome, classifyBiome } from "./biomes.js";
import { distanceToWater, seaLevelTemperatureAt } from "./climate.js";
import { biomeAt, cellIndexAt, distanceToWaterAt, elevationAt, heightAt, rainfallAt, temperatureAt, terrainTypeAt } from "./lookup.js";
import { countSpecks } from "./specks.js";
import { classifyTerrain, heightOf, isWater, TerrainType, type TerrainData } from "./types.js";

/** A smaller world than the default, with landforms sized to it, so tests stay fast and varied. */
const small = (overrides: Partial<WorldConfig> = {}) =>
  generateTerrain(makeConfig({ width: 800, height: 600, landformSize: 400, ...overrides }));

function shareOf(terrain: TerrainData, match: (type: TerrainType) => boolean): number {
  let count = 0;
  for (const type of terrain.terrainType) if (match(type as TerrainType)) count++;
  return (100 * count) / terrain.terrainType.length;
}

describe("generateTerrain", () => {
  it("covers the world with a grid of cells", () => {
    const terrain = small({ width: 803, cellSize: 5 });
    expect(terrain.cols).toBe(161);
    expect(terrain.rows).toBe(120);
    expect(terrain.elevation.length).toBe(161 * 120);
    expect(terrain.terrainType.length).toBe(161 * 120);
  });

  it("gives the same grid for the same seed and different grids for different seeds", () => {
    const a = small({ seed: 7 });
    const b = small({ seed: 7 });
    const c = small({ seed: 8 });
    expect(a.elevation).toEqual(b.elevation);
    expect(a.terrainType).toEqual(b.terrainType);
    expect(a.elevation).not.toEqual(c.elevation);
  });

  it("keeps elevation between 0 and 1", () => {
    const terrain = small({ octaves: 8, persistence: 0.9 });
    for (const e of terrain.elevation) {
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
  });

  it("matches the coverage knobs, whatever the noise settings", () => {
    for (const noise of [{}, { octaves: 1 }, { persistence: 0.8, octaves: 6 }, { landformSize: 100 }]) {
      for (const seed of [1, 2]) {
        const terrain = small({ seed, waterCoverage: 35, shallowWaterShare: 40, mountainCoverage: 12, ...noise });
        expect(shareOf(terrain, isWater)).toBeCloseTo(35, 1);
        expect(shareOf(terrain, (t) => t === TerrainType.ShallowWater)).toBeCloseTo(35 * 0.4, 1);
        expect(shareOf(terrain, (t) => t === TerrainType.Mountain)).toBeCloseTo(12, 1);
      }
    }
  });

  it("handles coverage at the extremes", () => {
    const dry = small({ waterCoverage: 0, mountainCoverage: 0 });
    expect(shareOf(dry, (t) => t === TerrainType.Land)).toBe(100);
    const flooded = small({ waterCoverage: 100, mountainCoverage: 50 });
    expect(shareOf(flooded, isWater)).toBe(100);
    const allShallow = small({ shallowWaterShare: 100 });
    expect(shareOf(allShallow, (t) => t === TerrainType.DeepWater)).toBe(0);
  });

  it("classifies every cell from its own elevation", () => {
    const terrain = small();
    terrain.elevation.forEach((e, i) => expect(terrain.terrainType[i]).toBe(classifyTerrain(terrain.levels, e)));
  });

  it("orders the types by elevation: deep water, shallow water, land, mountain", () => {
    const { levels } = small();
    expect(levels.shallow).toBeLessThanOrEqual(levels.sea);
    expect(levels.sea).toBeLessThan(levels.mountain);
    expect(levels.mountain).toBeLessThanOrEqual(levels.peak);
  });

  it("changing cell size changes detail, not the shape of the world", () => {
    const fine = small({ cellSize: 4 });
    const coarse = small({ cellSize: 8 });
    let same = 0;
    let total = 0;
    for (let y = 4; y < 600; y += 8) {
      for (let x = 4; x < 800; x += 8) {
        if (terrainTypeAt(fine, x, y) === terrainTypeAt(coarse, x, y)) same++;
        total++;
      }
    }
    expect(same / total).toBeGreaterThan(0.9);
  });
});

describe("height", () => {
  it("puts the highest cell at exactly the peak height and water at 0", () => {
    const terrain = small({ peakHeight: 9000 });
    let highest = 0;
    terrain.elevation.forEach((e, i) => {
      const h = heightOf(terrain, e);
      if (isWater(terrain.terrainType[i] as TerrainType)) expect(h).toBe(0);
      else expect(h).toBeGreaterThanOrEqual(0);
      highest = Math.max(highest, h);
    });
    expect(highest).toBe(9000);
  });

  it("rises in a straight line with elevation when lowland flatness is 0", () => {
    const terrain = small({ lowlandFlatness: 0 });
    const { sea, peak } = terrain.levels;
    const low = heightOf(terrain, sea + (peak - sea) * 0.25);
    const high = heightOf(terrain, sea + (peak - sea) * 0.75);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeCloseTo(terrain.peakHeight * 0.75, 6);
  });

  it("keeps lowlands low with lowland flatness, without moving the coast or the peak", () => {
    const flat = small({ lowlandFlatness: 0.7, peakHeight: 12000 });
    const { sea, peak } = flat.levels;
    const at = (u: number) => heightOf(flat, sea + (peak - sea) * u);
    expect(at(0)).toBe(0);
    expect(at(1)).toBeCloseTo(12000, 6);
    expect(at(0.25)).toBeCloseTo(12000 * (0.25 + 0.7 * (0.25 ** 3 - 0.25)), 6);
    expect(at(0.5)).toBeCloseTo(2850, 6);
    for (let u = 0; u < 1; u += 0.01) expect(at(u + 0.01)).toBeGreaterThanOrEqual(at(u));
    // Only feet change: the land itself is the same.
    expect(flat.terrainType).toEqual(small({ lowlandFlatness: 0, peakHeight: 12000 }).terrainType);
  });

  it("makes typical land much lower than a straight line does", () => {
    const median = (terrain: TerrainData) => {
      const heights = [...terrain.elevation].filter((e) => e >= terrain.levels.sea).map((e) => heightOf(terrain, e));
      return heights.sort((a, b) => a - b)[heights.length >> 1]!;
    };
    expect(median(small({ lowlandFlatness: 0.7 }))).toBeLessThan(0.6 * median(small({ lowlandFlatness: 0 })));
  });

  it("is 0 everywhere when the whole world is water", () => {
    const terrain = small({ waterCoverage: 100 });
    for (const e of terrain.elevation) expect(heightOf(terrain, e)).toBe(0);
  });
});

describe("temperature", () => {
  const still = { temperatureNoise: 0 };
  const cell = (terrain: TerrainData, col: number, row: number) => row * terrain.cols + col;

  it("is one sea-level temperature everywhere by default, so only height sets the climate", () => {
    const terrain = small({ ...still, seaLevelTemperature: 84 });
    terrain.elevation.forEach((e, i) => {
      expect(terrain.temperature[i]).toBeCloseTo(84 - (3.6 * heightOf(terrain, e)) / 1000, 3);
    });
  });

  it("cools sea level toward the top and bottom edges with latitude cooling", () => {
    const config = makeConfig({ width: 400, height: 1000, cellSize: 10, seaLevelTemperature: 80, latitudeCooling: 70 });
    expect(seaLevelTemperatureAt(config, 500)).toBe(80);
    expect(seaLevelTemperatureAt(config, 0)).toBe(10);
    expect(seaLevelTemperatureAt(config, 1000)).toBe(10);
    expect(seaLevelTemperatureAt(config, 250)).toBeCloseTo(80 - 70 * 0.25, 10);
    for (let y = 500; y < 1000; y += 50) expect(seaLevelTemperatureAt(config, y + 50)).toBeLessThan(seaLevelTemperatureAt(config, y));
    expect(seaLevelTemperatureAt(makeConfig({ seaLevelTemperature: 80 }), 0)).toBe(80);
  });

  it("cools with height by exactly the lapse rate", () => {
    const terrain = small({ ...still, lapseRate: 4, seaLevelTemperature: 70, latitudeCooling: 30 });
    const config = makeConfig({ width: 800, height: 600, seaLevelTemperature: 70, latitudeCooling: 30 });
    const row = 30;
    const base = seaLevelTemperatureAt(config, (row + 0.5) * terrain.cellSize);
    for (let col = 0; col < terrain.cols; col++) {
      const i = cell(terrain, col, row);
      const expected = base - (4 * heightOf(terrain, terrain.elevation[i]!)) / 1000;
      expect(terrain.temperature[i]).toBeCloseTo(expected, 3);
    }
  });

  it("puts the peak exactly lapse rate × peak height below sea level", () => {
    const terrain = small({ ...still, lapseRate: 3.6, peakHeight: 24000, seaLevelTemperature: 84 });
    const peak = terrain.elevation.indexOf(terrain.levels.peak);
    expect(terrain.temperature[peak]).toBeCloseTo(84 - 86.4, 3);
  });

  it("does not depend on height when the lapse rate is 0", () => {
    const terrain = small({ ...still, lapseRate: 0, latitudeCooling: 40 });
    for (let row = 0; row < terrain.rows; row += 7) {
      const first = terrain.temperature[cell(terrain, 0, row)];
      for (let col = 1; col < terrain.cols; col++) expect(terrain.temperature[cell(terrain, col, row)]).toBe(first);
    }
  });

  it("gives water sea-level temperature", () => {
    const terrain = small({ ...still, seaLevelTemperature: 84 });
    terrain.terrainType.forEach((type, i) => {
      if (isWater(type as TerrainType)) expect(terrain.temperature[i]).toBeCloseTo(84, 3);
    });
  });

  it("keeps variation within the knob", () => {
    const flat = small({ lapseRate: 0, temperatureNoise: 0 });
    const varied = small({ lapseRate: 0, temperatureNoise: 6 });
    let moved = 0;
    varied.temperature.forEach((t, i) => {
      const delta = Math.abs(t - flat.temperature[i]!);
      expect(delta).toBeLessThanOrEqual(6 + 1e-3);
      moved = Math.max(moved, delta);
    });
    expect(moved).toBeGreaterThan(1);
  });

  it("never changes the land when climate knobs change", () => {
    const a = small();
    const b = small({ seaLevelTemperature: 50, latitudeCooling: 60, temperatureNoise: 20, lapseRate: 8 });
    expect(b.elevation).toEqual(a.elevation);
    expect(b.terrainType).toEqual(a.terrainType);
    expect(b.temperature).not.toEqual(a.temperature);
  });
});

describe("distance to water", () => {
  it("measures straight and diagonal steps between cell centers", () => {
    const terrain = drawn(["~....", ".....", "....."]);
    const d = distanceToWater(terrain.cols, terrain.rows, 10, terrain.terrainType);
    const at = (col: number, row: number) => d[row * terrain.cols + col]!;
    expect(at(0, 0)).toBe(0);
    expect(at(1, 0)).toBeCloseTo(10, 4);
    expect(at(4, 0)).toBeCloseTo(40, 4);
    expect(at(1, 1)).toBeCloseTo(10 * Math.SQRT2, 4);
    expect(at(2, 2)).toBeCloseTo(20 * Math.SQRT2, 4);
    expect(at(4, 2)).toBeCloseTo(20 * Math.SQRT2 + 20, 4);
  });

  it("finds the nearest of several bodies of water", () => {
    const terrain = drawn(["~.......-"]);
    const d = distanceToWater(terrain.cols, terrain.rows, 10, terrain.terrainType);
    expect([...d]).toEqual([0, 10, 20, 30, 40, 30, 20, 10, 0]);
  });

  it("is infinite everywhere when there is no water", () => {
    const terrain = small({ waterCoverage: 0 });
    expect(terrain.distanceToWater.every((v) => v === Infinity)).toBe(true);
  });
});

describe("rainfall", () => {
  const dry = { shoreRain: 0 };

  it("spreads evenly from the driest to the wettest value at skew 0, whatever the noise settings", () => {
    for (const noise of [{}, { persistence: 0.8, octaves: 6 }, { landformSize: 100 }]) {
      const terrain = small({ ...dry, rainfallSkew: 0, driestRainfall: 5, wettestRainfall: 120, ...noise });
      const sorted = terrain.rainfall.slice().sort();
      expect(sorted[0]).toBe(5);
      expect(sorted[sorted.length - 1]).toBe(120);
      expect(sorted[Math.floor(sorted.length / 2)]).toBeCloseTo(62.5, 1);
      expect(sorted[Math.floor(sorted.length / 4)]).toBeCloseTo(33.75, 1);
    }
  });

  it("makes most places moderate to dry at skew 1, keeping the driest and wettest values", () => {
    const terrain = small({ ...dry, rainfallSkew: 1, driestRainfall: 5, wettestRainfall: 120 });
    const sorted = terrain.rainfall.slice().sort();
    const at = (q: number) => sorted[Math.floor((sorted.length - 1) * q)]!;
    expect(at(0)).toBe(5);
    expect(at(1)).toBe(120);
    expect(at(0.5)).toBeCloseTo(5 + 115 * 0.25, 1);
    expect(at(0.25)).toBeCloseTo(5 + 115 * 0.0625, 1);
    expect(at(0.9)).toBeCloseTo(5 + 115 * 0.81, 1);
  });

  it("makes land far from water drier with inland drying, keeping the driest and wettest values", () => {
    const meanBy = (terrain: TerrainData, near: boolean) => {
      let total = 0;
      let count = 0;
      terrain.rainfall.forEach((r, i) => {
        const d = terrain.distanceToWater[i]!;
        if (d === 0 || (near ? d > 30 : d < 200)) return;
        total += r;
        count++;
      });
      return total / count;
    };
    const drying = small({ ...dry, driestRainfall: 5, wettestRainfall: 120, inlandDrying: 0.5, inlandDryingRange: 200 });
    const none = small({ ...dry, inlandDrying: 0 });
    expect(meanBy(drying, false)).toBeLessThan(meanBy(drying, true) - 15);
    expect(meanBy(drying, false)).toBeLessThan(meanBy(none, false));
    const sorted = drying.rainfall.slice().sort();
    expect(sorted[0]).toBe(5);
    expect(sorted[sorted.length - 1]).toBe(120);
  });

  it("adds rain near water, fading to nothing at the shore rain range", () => {
    const without = small(dry);
    const withRain = small({ shoreRain: 30, shoreRainRange: 150 });
    let boosted = 0;
    withRain.rainfall.forEach((r, i) => {
      const expected = 30 * Math.max(0, 1 - withRain.distanceToWater[i]! / 150);
      expect(r - without.rainfall[i]!).toBeCloseTo(expected, 3);
      if (expected > 0 && !isWater(withRain.terrainType[i] as TerrainType)) boosted++;
    });
    expect(boosted).toBeGreaterThan(0);
  });

  it("never changes the land or the temperature when rainfall knobs change", () => {
    const a = small();
    const b = small({ driestRainfall: 40, wettestRainfall: 300, shoreRain: 100, shoreRainRange: 500 });
    expect(b.elevation).toEqual(a.elevation);
    expect(b.temperature).toEqual(a.temperature);
    expect(b.rainfall).not.toEqual(a.rainfall);
  });
});

describe("biomes", () => {
  it("puts known climates in the right biome", () => {
    expect(classifyBiome(80, 120)).toBe(Biome.Rainforest);
    expect(classifyBiome(80, 50)).toBe(Biome.Savanna);
    expect(classifyBiome(80, 10)).toBe(Biome.Desert);
    expect(classifyBiome(55, 15)).toBe(Biome.Grassland);
    expect(classifyBiome(55, 60)).toBe(Biome.TemperateForest);
    expect(classifyBiome(55, 90)).toBe(Biome.TemperateRainforest);
    for (const rain of [0, 50, 300]) {
      expect(classifyBiome(35, rain)).toBe(Biome.Taiga);
      expect(classifyBiome(15, rain)).toBe(Biome.Tundra);
    }
  });

  it("follows the threshold table at the boundaries", () => {
    expect(classifyBiome(68, 50)).toBe(Biome.Savanna);
    expect(classifyBiome(67.9, 50)).toBe(Biome.TemperateForest);
    expect(classifyBiome(41, 50)).toBe(Biome.TemperateForest);
    expect(classifyBiome(40.9, 50)).toBe(Biome.Taiga);
    expect(classifyBiome(23, 50)).toBe(Biome.Taiga);
    expect(classifyBiome(22.9, 50)).toBe(Biome.Tundra);
    expect(classifyBiome(80, 20)).toBe(Biome.Savanna);
    expect(classifyBiome(80, 19.9)).toBe(Biome.Desert);
    expect(classifyBiome(80, 100)).toBe(Biome.Savanna);
    expect(classifyBiome(80, 100.1)).toBe(Biome.Rainforest);
    expect(classifyBiome(55, 40)).toBe(Biome.TemperateForest);
    expect(classifyBiome(55, 39.9)).toBe(Biome.Grassland);
    expect(classifyBiome(55, 80)).toBe(Biome.TemperateForest);
    expect(classifyBiome(55, 80.1)).toBe(Biome.TemperateRainforest);
  });

  it("gives every land and mountain cell the biome of its own climate, and water none", () => {
    for (const seed of [1, 2, 3]) {
      const terrain = small({ seed });
      let mountains = 0;
      terrain.terrainType.forEach((type, i) => {
        if (isWater(type as TerrainType)) return expect(terrain.biome[i]).toBe(Biome.None);
        expect(terrain.biome[i]).toBe(classifyBiome(terrain.temperature[i]!, terrain.rainfall[i]!));
        if (type === TerrainType.Mountain) mountains++;
      });
      expect(mountains).toBeGreaterThan(0);
    }
  });

  it("gives default worlds every biome, with none taking over", () => {
    const counts = new Array<number>(9).fill(0);
    for (let seed = 1; seed <= 5; seed++) for (const biome of generateTerrain(makeConfig({ seed })).biome) counts[biome]!++;
    const land = counts.reduce((a, b) => a + b, 0) - counts[Biome.None]!;
    for (let biome = 1; biome < counts.length; biome++) {
      expect(counts[biome]! / land).toBeGreaterThan(0.002);
      expect(counts[biome]! / land).toBeLessThan(0.5);
    }
  });

  it("makes the highest peak far colder than lowland at its latitude, and never tropical", () => {
    const terrain = small({ temperatureNoise: 0 });
    const peak = terrain.elevation.indexOf(terrain.levels.peak);
    const row = Math.floor(peak / terrain.cols);
    const peakBiome = terrain.biome[peak]!;
    const lowland = [...terrain.terrainType.subarray(row * terrain.cols, (row + 1) * terrain.cols)].findIndex(
      (type, col) => type === TerrainType.Land && heightOf(terrain, terrain.elevation[row * terrain.cols + col]!) < 1000,
    );
    expect(lowland).toBeGreaterThanOrEqual(0);
    expect(terrain.temperature[peak]).toBeLessThan(terrain.temperature[row * terrain.cols + lowland]! - 30);
    expect([Biome.Tundra, Biome.Taiga, Biome.Grassland, Biome.TemperateForest, Biome.TemperateRainforest]).toContain(peakBiome);
  });
});

describe("cell lookups", () => {
  const terrain = small({ cellSize: 10 });

  it("finds the cell that contains a point", () => {
    expect(cellIndexAt(terrain, 0, 0)).toBe(0);
    expect(cellIndexAt(terrain, 9.99, 9.99)).toBe(0);
    expect(cellIndexAt(terrain, 10, 0)).toBe(1);
    expect(cellIndexAt(terrain, 25, 31)).toBe(3 * terrain.cols + 2);
  });

  it("uses the nearest edge cell for points outside the grid", () => {
    expect(cellIndexAt(terrain, -50, -50)).toBe(0);
    expect(cellIndexAt(terrain, 1e6, 1e6)).toBe(terrain.cols * terrain.rows - 1);
  });

  it("reads each field from the containing cell", () => {
    const i = cellIndexAt(terrain, 123, 456);
    expect(terrainTypeAt(terrain, 123, 456)).toBe(terrain.terrainType[i]);
    expect(elevationAt(terrain, 123, 456)).toBe(terrain.elevation[i]);
    expect(heightAt(terrain, 123, 456)).toBe(heightOf(terrain, terrain.elevation[i]!));
    expect(temperatureAt(terrain, 123, 456)).toBe(terrain.temperature[i]);
    expect(rainfallAt(terrain, 123, 456)).toBe(terrain.rainfall[i]);
    expect(biomeAt(terrain, 123, 456)).toBe(terrain.biome[i]);
    expect(distanceToWaterAt(terrain, 123, 456)).toBe(terrain.distanceToWater[i]);
  });
});

/** A hand-drawn grid: ~ deep water, - shallow water, . land, ^ mountain. */
function drawn(picture: string[], cellSize = 10): TerrainData {
  const codes: Record<string, TerrainType> = {
    "~": TerrainType.DeepWater,
    "-": TerrainType.ShallowWater,
    ".": TerrainType.Land,
    "^": TerrainType.Mountain,
  };
  const cols = picture[0]!.length;
  const rows = picture.length;
  const terrainType = Uint8Array.from(picture.join(""), (ch) => codes[ch]!);
  const levels = { sea: 0.3, shallow: 0.2, mountain: 0.7, peak: 1 };
  const n = cols * rows;
  const flat = {
    elevation: new Float32Array(n),
    temperature: new Float32Array(n),
    distanceToWater: new Float32Array(n),
    rainfall: new Float32Array(n),
    biome: new Uint8Array(n),
  };
  const size = { cols, rows, cellSize, width: cols * cellSize, height: rows * cellSize };
  return { ...size, levels, landformSize: 100, peakHeight: 1000, lowlandFlatness: 0, terrainType, ...flat };
}

describe("countSpecks", () => {
  // Cells are 10 u, so with a 900 square unit limit a patch of 8 cells or fewer is a speck.
  it("finds no specks in a world of large patches", () => {
    const terrain = drawn(["....~~~~", "....~~~~", "....~~~~", "....~~~~"]);
    expect(countSpecks(terrain)).toEqual({ total: 0, byType: [0, 0, 0, 0] });
  });

  it("counts small patches by terrain type", () => {
    const terrain = drawn([".........~", ".^......~~", "......-.~~", "..........", "...^^....."]);
    expect(countSpecks(terrain).byType).toEqual([1, 1, 0, 2]);
  });

  it("treats cells touching at a corner as one patch", () => {
    const terrain = drawn(["^.........", ".^........", "..^.......", "..........", ".........."]);
    expect(countSpecks(terrain).byType[TerrainType.Mountain]).toBe(1);
  });

  it("does not count a patch exactly at the size limit", () => {
    const terrain = drawn(["^^^.......", "^^^.......", "^^^.......", "..........", ".........."]);
    expect(countSpecks(terrain).total).toBe(0);
    expect(countSpecks(terrain, 901).total).toBe(1);
  });

  it("finds few specks in default worlds", () => {
    let total = 0;
    for (let seed = 1; seed <= 5; seed++) total += countSpecks(generateTerrain(makeConfig({ seed }))).total;
    expect(total / 5).toBeLessThan(10);
  });
});
