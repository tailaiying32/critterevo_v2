import { Biome, BIOME_NAMES, TERRAIN_TYPE_NAMES, TerrainType } from "@critter-evo/core";

/** What the terrain layer shows. */
export type TerrainView = "biome" | "elevation" | "temperature" | "moisture" | "terrain";

export const TERRAIN_VIEWS: { value: TerrainView; label: string; index: number }[] = [
  { value: "biome", label: "Biome", index: 0 },
  { value: "elevation", label: "Elevation", index: 1 },
  { value: "temperature", label: "Temperature", index: 2 },
  { value: "moisture", label: "Moisture", index: 3 },
  { value: "terrain", label: "Terrain type", index: 4 },
];

export type RGB = readonly [number, number, number];

function hex(color: number): RGB {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

export const BIOME_COLORS: Record<number, RGB> = {
  [Biome.None]: hex(0x2a5d8a),
  [Biome.Desert]: hex(0xd8c38c),
  [Biome.Savanna]: hex(0xbfae5a),
  [Biome.Rainforest]: hex(0x2e7a3a),
  [Biome.Grassland]: hex(0x9dbf6b),
  [Biome.TemperateForest]: hex(0x5f9a4b),
  [Biome.TemperateRainforest]: hex(0x3d7b5a),
  [Biome.Tundra]: hex(0xb4bcae),
  [Biome.Taiga]: hex(0x4f7462),
};

export const TERRAIN_TYPE_COLORS: Record<number, RGB> = {
  [TerrainType.DeepWater]: hex(0x1f4d78),
  [TerrainType.ShallowWater]: hex(0x4a8dbd),
  [TerrainType.Land]: hex(0x7fa45a),
  [TerrainType.Mountain]: hex(0x8a7f70),
};

export const ROCK: RGB = hex(0x8f8577);
export const SNOW: RGB = hex(0xeef1f4);

/** Fixed temperature scale for the temperature view, so worlds can be compared. */
export const TEMPERATURE_RANGE = { min: -20, max: 110 } as const;

export interface ColorStop {
  at: number;
  color: RGB;
}

/** Water from shore (0) to the deepest point (1). */
export const WATER_STOPS: ColorStop[] = [
  { at: 0, color: hex(0x5a9ccb) },
  { at: 1, color: hex(0x16395e) },
];

export const TEMPERATURE_STOPS: ColorStop[] = [
  { at: 0, color: hex(0x313695) },
  { at: 0.3, color: hex(0x74add1) },
  { at: 0.55, color: hex(0xf4f1e4) },
  { at: 0.78, color: hex(0xf46d43) },
  { at: 1, color: hex(0xa50026) },
];

export const MOISTURE_STOPS: ColorStop[] = [
  { at: 0, color: hex(0xa67c52) },
  { at: 0.4, color: hex(0xd9cf8f) },
  { at: 0.7, color: hex(0x6fae6a) },
  { at: 1, color: hex(0x2f6f9f) },
];

/** Land color by height above sea level. */
export const ELEVATION_STOPS: ColorStop[] = [
  { at: 0, color: hex(0x5b8a4a) },
  { at: 0.35, color: hex(0xc9b77a) },
  { at: 0.7, color: hex(0x8b6d4f) },
  { at: 1, color: hex(0xf0f0f0) },
];

export function sampleStops(stops: ColorStop[], t: number): RGB {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (x <= b.at) {
      const f = b.at === a.at ? 0 : (x - a.at) / (b.at - a.at);
      return mix(a.color, b.color, f);
    }
  }
  return stops[stops.length - 1]!.color;
}

export function mix(a: RGB, b: RGB, f: number): RGB {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** CSS gradient for a legend bar. */
export function cssGradient(stops: ColorStop[]): string {
  return `linear-gradient(to right, ${stops.map((s) => `rgb(${s.color.map(Math.round).join(",")}) ${s.at * 100}%`).join(", ")})`;
}

export function cssColor(color: RGB): string {
  return `rgb(${color.map(Math.round).join(",")})`;
}

// ---------------- Palette texture for the GPU terrain shader ----------------

export const PALETTE_WIDTH = 256;
/** Row of each color table in the palette texture. Must match the shader. */
export const PaletteRow = {
  Biome: 0,
  TerrainType: 1,
  Water: 2,
  Elevation: 3,
  Temperature: 4,
  Moisture: 5,
  Misc: 6,
} as const;
export const PALETTE_ROWS = 8;
/** Entries in the Misc row. */
export const MiscColor = { Rock: 0, Snow: 1 } as const;

/**
 * All terrain colors packed into one RGBA8 texture: categorical tables use
 * their index as the column, ramps are sampled at 256 steps.
 */
export function buildPalette(): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(new ArrayBuffer(PALETTE_WIDTH * PALETTE_ROWS * 4));
  const put = (row: number, col: number, color: RGB) => {
    const p = (row * PALETTE_WIDTH + col) * 4;
    data[p] = Math.round(color[0]);
    data[p + 1] = Math.round(color[1]);
    data[p + 2] = Math.round(color[2]);
    data[p + 3] = 255;
  };
  for (const [id, color] of Object.entries(BIOME_COLORS)) put(PaletteRow.Biome, Number(id), color);
  for (const [id, color] of Object.entries(TERRAIN_TYPE_COLORS)) put(PaletteRow.TerrainType, Number(id), color);
  const ramps: [number, ColorStop[]][] = [
    [PaletteRow.Water, WATER_STOPS],
    [PaletteRow.Elevation, ELEVATION_STOPS],
    [PaletteRow.Temperature, TEMPERATURE_STOPS],
    [PaletteRow.Moisture, MOISTURE_STOPS],
  ];
  for (const [row, stops] of ramps) {
    for (let i = 0; i < PALETTE_WIDTH; i++) put(row, i, sampleStops(stops, i / (PALETTE_WIDTH - 1)));
  }
  put(PaletteRow.Misc, MiscColor.Rock, ROCK);
  put(PaletteRow.Misc, MiscColor.Snow, SNOW);
  return data;
}

/** Legend entries for categorical views. */
export function categoricalLegend(view: TerrainView): { label: string; color: string }[] {
  if (view === "terrain") {
    return TERRAIN_TYPE_NAMES.map((label, i) => ({ label, color: cssColor(TERRAIN_TYPE_COLORS[i]!) }));
  }
  if (view === "biome") {
    return [
      ...BIOME_NAMES.slice(1).map((label, i) => ({ label, color: cssColor(BIOME_COLORS[i + 1]!) })),
      { label: "Water", color: cssColor(sampleStops(WATER_STOPS, 0.4)) },
      { label: "Snowy peaks", color: cssColor(mix(ROCK, SNOW, 0.6)) },
    ];
  }
  return [];
}
