import { describe, expect, it } from "vitest";
import { makeConfig } from "../config.js";
import { depthShare, slopeField } from "../terrain/slope.js";
import { TerrainType, type TerrainData } from "../terrain/types.js";
import { accelerationOf, bodyFits, massOf, radiusOf, slopeFactor, terrainEffect, wadingFactor, type TerrainEffect } from "./movement.js";

/**
 * A terrain of 10 unit cells drawn as text: "~" deep water, "-" shallow water,
 * "." land. Land is at sea level, so it is flat.
 */
function drawn(picture: string[]): TerrainData {
  const codes: Record<string, TerrainType> = { "~": TerrainType.DeepWater, "-": TerrainType.ShallowWater, ".": TerrainType.Land };
  const cols = picture[0]!.length;
  const rows = picture.length;
  const cellSize = 10;
  const terrainType = Uint8Array.from(picture.join(""), (ch) => codes[ch]!);
  const levels = { sea: 0.5, shallow: 0.25, mountain: 2, peak: 1 };
  const elevation = Float32Array.from(terrainType, (t) => (t === TerrainType.DeepWater ? 0.1 : t === TerrainType.ShallowWater ? 0.375 : 0.5));
  const n = cols * rows;
  const grid = { cols, rows, cellSize, levels, peakHeight: 1000, lowlandFlatness: 0, elevation };
  return {
    ...grid,
    width: cols * cellSize,
    height: rows * cellSize,
    landformSize: 100,
    terrainType,
    temperature: new Float32Array(n),
    distanceToWater: new Float32Array(n),
    rainfall: new Float32Array(n),
    biome: new Uint8Array(n),
    ...slopeField(grid, terrainType),
  };
}

const effect = (): TerrainEffect => ({ wading: 1, slope: 1, grade: 0 });

describe("body scaling", () => {
  it("makes a size 1 critter 10 units across with mass 1", () => {
    expect(radiusOf(1)).toBe(5);
    expect(massOf(1)).toBe(1);
  });

  it("grows mass with the cube of size, and lowers acceleration as mass^(-1/3)", () => {
    expect(massOf(2)).toBe(8);
    const config = { acceleration: 120 };
    expect(accelerationOf(2, config)).toBeCloseTo(120 * Math.pow(massOf(2), -1 / 3), 10);
    expect(accelerationOf(0.5, config)).toBe(240);
  });
});

describe("wading", () => {
  it("is full speed at the shore and nothing at deep water, for every size", () => {
    for (const size of [0.25, 1, 4]) {
      expect(wadingFactor(0, size, 1)).toBe(1);
      expect(wadingFactor(1, size, 1)).toBe(0);
    }
  });

  it("lets bigger critters wade deeper water more easily", () => {
    expect(wadingFactor(0.5, 1, 1)).toBeCloseTo(0.5, 10);
    expect(wadingFactor(0.5, 2, 1)).toBeCloseTo(Math.SQRT1_2, 10);
    expect(wadingFactor(0.5, 0.5, 1)).toBeCloseTo(0.25, 10);
  });

  it("measures depth across the shallow band", () => {
    const terrain = drawn(["~-."]);
    expect(depthShare(terrain, 0)).toBe(1);
    expect(depthShare(terrain, 1)).toBeCloseTo(0.5, 6);
    expect(depthShare(terrain, 2)).toBe(0);
  });
});

describe("slope", () => {
  it("follows Tobler's hiking function: half speed up a 20% grade, 70% down it", () => {
    expect(slopeFactor(0.2, 3.5)).toBeCloseTo(Math.exp(-0.7), 10);
    expect(slopeFactor(-0.2, 3.5)).toBeCloseTo(Math.exp(-0.35), 10);
  });

  it("is never faster than flat ground", () => {
    expect(slopeFactor(0, 3.5)).toBe(1);
    expect(slopeFactor(-0.05, 3.5)).toBe(1);
  });

  it("is slower uphill than the same grade downhill", () => {
    for (const grade of [0.1, 0.3, 0.6, 1]) expect(slopeFactor(grade, 3.5)).toBeLessThan(slopeFactor(-grade, 3.5));
  });

  it("is measured from exact heights in feet per world unit, one-sided at the edges", () => {
    // Elevation rises 0.1 per column above sea level: 100 ft per 10 unit cell.
    const cols = 5;
    const rows = 3;
    const elevation = Float32Array.from({ length: cols * rows }, (_, i) => (i % cols) * 0.1);
    const grid = { cols, rows, cellSize: 10, levels: { sea: 0, shallow: -1, mountain: 2, peak: 1 }, peakHeight: 1000, lowlandFlatness: 0, elevation };
    const { slopeX, slopeY } = slopeField(grid, new Uint8Array(cols * rows).fill(TerrainType.Land));
    for (let i = 0; i < cols * rows; i++) {
      expect(slopeX[i]).toBeCloseTo(10, 4);
      expect(slopeY[i]).toBe(0);
    }
  });

  it("is flat on water", () => {
    const terrain = drawn(["--..", "--.."]);
    terrain.elevation[2] = terrain.elevation[3] = 0.9;
    const { slopeX } = slopeField(terrain, terrain.terrainType);
    expect(slopeX[0]).toBe(0);
    expect(slopeX[1]).toBe(0);
    expect(slopeX[2]).not.toBe(0);
  });

  it("is felt along the heading, neutral across, and steeper by size", () => {
    const terrain = drawn(["....", "...."]);
    terrain.slopeX.fill(40); // 10% at 400 ft per unit
    const config = { ...makeConfig(), mapScale: 400 };
    const east = terrainEffect(terrain, config, 15, 15, 1, 0, 1, effect());
    expect(east.grade).toBeCloseTo(0.1, 10);
    expect(east.slope).toBeCloseTo(slopeFactor(0.1, config.slopeSensitivity), 10);
    expect(terrainEffect(terrain, config, 15, 15, 0, 1, 1, effect()).slope).toBe(1);
    expect(terrainEffect(terrain, config, 15, 15, 1, 0, 2, effect()).grade).toBeCloseTo(0.2, 10);
    expect(terrainEffect(terrain, config, 15, 15, 1, 0, 2, effect()).slope).toBeLessThan(east.slope);
    expect(terrainEffect(terrain, { ...config, slopeSlowdown: false }, 15, 15, 1, 0, 2, effect()).slope).toBe(1);
  });
});

describe("bodyFits", () => {
  const terrain = drawn(["....~", "....~", "....~"]);

  it("keeps the whole body inside the world", () => {
    expect(bodyFits(terrain, 5, 15, 5)).toBe(true);
    expect(bodyFits(terrain, 4.9, 15, 5)).toBe(false);
    expect(bodyFits(terrain, 20, 25, 5)).toBe(true);
    expect(bodyFits(terrain, 20, 25.1, 5)).toBe(false);
  });

  it("keeps the whole body off deep water, touching allowed", () => {
    expect(bodyFits(terrain, 35, 15, 5)).toBe(true);
    expect(bodyFits(terrain, 35.1, 15, 5)).toBe(false);
    expect(bodyFits(terrain, 39, 15, 1)).toBe(true);
    expect(bodyFits(terrain, 41, 15, 1)).toBe(false);
  });

  it("lets bodies into shallow water", () => {
    expect(bodyFits(drawn(["---", "---", "---"]), 15, 15, 5)).toBe(true);
  });
});
