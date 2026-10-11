import { Biome, TerrainType } from "@critter-evo/core";
import { describe, expect, it } from "vitest";
import {
  BIOME_COLORS,
  buildPalette,
  MiscColor,
  PALETTE_ROWS,
  PALETTE_WIDTH,
  PaletteRow,
  sampleStops,
  SNOW,
  TEMPERATURE_STOPS,
  TERRAIN_TYPE_COLORS,
} from "./terrainColors";

function texel(palette: Uint8Array, row: number, col: number): number[] {
  const p = (row * PALETTE_WIDTH + col) * 4;
  return [...palette.slice(p, p + 4)];
}

describe("buildPalette", () => {
  const palette = buildPalette();

  it("has one RGBA texel per palette cell", () => {
    expect(palette.length).toBe(PALETTE_WIDTH * PALETTE_ROWS * 4);
  });

  it("puts each biome and terrain type color at its id", () => {
    expect(texel(palette, PaletteRow.Biome, Biome.Desert)).toEqual([...BIOME_COLORS[Biome.Desert]!, 255]);
    expect(texel(palette, PaletteRow.TerrainType, TerrainType.Mountain)).toEqual([...TERRAIN_TYPE_COLORS[TerrainType.Mountain]!, 255]);
    expect(texel(palette, PaletteRow.Misc, MiscColor.Snow)).toEqual([...SNOW, 255]);
  });

  it("samples ramps from their first to last stop", () => {
    expect(texel(palette, PaletteRow.Temperature, 0).slice(0, 3)).toEqual([...TEMPERATURE_STOPS[0]!.color]);
    expect(texel(palette, PaletteRow.Temperature, PALETTE_WIDTH - 1).slice(0, 3)).toEqual([...TEMPERATURE_STOPS.at(-1)!.color]);
  });
});

describe("sampleStops", () => {
  it("clamps outside 0..1", () => {
    expect(sampleStops(TEMPERATURE_STOPS, -5)).toEqual(TEMPERATURE_STOPS[0]!.color);
    expect(sampleStops(TEMPERATURE_STOPS, 5)).toEqual(TEMPERATURE_STOPS.at(-1)!.color);
  });
});
