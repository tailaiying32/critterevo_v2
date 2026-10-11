import { describe, expect, it } from "vitest";
import { makeConfig } from "../config.js";
import { Biome, BIOME_THRESHOLDS } from "./biomes.js";
import { generateTerrain } from "./generate.js";
import { isWater, TerrainType } from "./types.js";
import {
  BIOME_COLORS,
  CLIMATE_WATER,
  RAINFALL_STEPS,
  RELIEF_SHADES,
  SHADED_VIEWS,
  stepColor,
  TEMPERATURE_STEPS,
  TERRAIN_TYPE_COLORS,
  TERRAIN_VIEWS,
  viewPixels,
} from "./views.js";

const terrain = generateTerrain(makeConfig({ width: 600, height: 400, landformSize: 300 }));
const n = terrain.cols * terrain.rows;
const pixel = (pixels: Uint8ClampedArray, i: number) => [...pixels.subarray(i * 4, i * 4 + 4)];

describe("map views", () => {
  it("draws one opaque pixel per cell in every view", () => {
    for (const view of TERRAIN_VIEWS) {
      const pixels = viewPixels(terrain, view, { relief: true });
      expect(pixels.length).toBe(n * 4);
      for (let i = 0; i < n; i++) expect(pixels[i * 4 + 3]).toBe(255);
    }
  });

  it("colors each cell by its biome, and water by its terrain type", () => {
    const pixels = viewPixels(terrain, "biome");
    for (let i = 0; i < n; i++) {
      const biome = terrain.biome[i] as Biome;
      const color = biome === Biome.None ? TERRAIN_TYPE_COLORS[terrain.terrainType[i] as TerrainType] : BIOME_COLORS[biome];
      expect(pixel(pixels, i)).toEqual([...color, 255]);
    }
  });

  it("never shades the temperature or rainfall views, whose colors carry values", () => {
    for (const view of ["temperature", "rainfall"] as const) {
      expect(SHADED_VIEWS).not.toContain(view);
      expect(viewPixels(terrain, view, { relief: true })).toEqual(viewPixels(terrain, view));
    }
  });

  it("shades land but leaves the water surface flat in the biome view", () => {
    const flat = viewPixels(terrain, "biome");
    const shaded = viewPixels(terrain, "biome", { relief: true });
    let landChanged = 0;
    for (let i = 0; i < n; i++) {
      if (isWater(terrain.terrainType[i] as TerrainType)) expect(pixel(shaded, i)).toEqual(pixel(flat, i));
      else if (pixel(shaded, i).some((v, k) => v !== pixel(flat, i)[k])) landChanged++;
    }
    expect(landChanged).toBeGreaterThan(n / 4);
  });
});

describe("stepped colors", () => {
  const distinct = (pixels: Uint8ClampedArray) => new Set(Array.from({ length: n }, (_, i) => pixel(pixels, i).join(","))).size;
  // Pixel arrays round halves to even, so round expected colors the same way.
  const key = (c: readonly number[]) => [...Uint8ClampedArray.from(c), 255].join(",");

  it("draws temperature and rainfall only in their step colors, and water in one color", () => {
    for (const [view, steps] of [["temperature", TEMPERATURE_STEPS], ["rainfall", RAINFALL_STEPS]] as const) {
      const allowed = new Set([...steps.map((s) => key(s.color)), key(CLIMATE_WATER)]);
      const pixels = viewPixels(terrain, view);
      for (let i = 0; i < n; i++) expect(allowed.has(pixel(pixels, i).join(","))).toBe(true);
    }
  });

  it("puts every biome threshold on a step edge, so bands line up with biome borders", () => {
    const edges = (steps: typeof TEMPERATURE_STEPS) => steps.map((s) => s.from);
    const t = BIOME_THRESHOLDS;
    for (const threshold of [t.boreal, t.temperate, t.tropical]) expect(edges(TEMPERATURE_STEPS)).toContain(threshold);
    for (const threshold of [t.tropicalDry, t.temperateDry, t.temperateWet, t.tropicalWet]) expect(edges(RAINFALL_STEPS)).toContain(threshold);
    expect(stepColor(TEMPERATURE_STEPS, 22.9)).not.toEqual(stepColor(TEMPERATURE_STEPS, 23));
    expect(stepColor(TEMPERATURE_STEPS, 23)).toEqual(stepColor(TEMPERATURE_STEPS, 31.9));
  });

  it("uses the end steps for values beyond the scale", () => {
    expect(stepColor(TEMPERATURE_STEPS, -100)).toEqual(TEMPERATURE_STEPS[0]!.color);
    expect(stepColor(TEMPERATURE_STEPS, 200)).toEqual(TEMPERATURE_STEPS[TEMPERATURE_STEPS.length - 1]!.color);
  });

  it("shades in a few flat levels, not a gradient", () => {
    const shades = Object.values(RELIEF_SHADES).length;
    expect(distinct(viewPixels(terrain, "biome", { relief: true }))).toBeLessThanOrEqual(10 * shades);
    expect(distinct(viewPixels(terrain, "elevation", { relief: true }))).toBeLessThanOrEqual(8 * shades + 3);
  });
});
