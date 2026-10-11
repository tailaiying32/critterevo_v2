import { Biome } from "./biomes.js";
import { heightOf, isWater, TerrainType, type TerrainData } from "./types.js";

/**
 * Map views of the terrain: pure functions from terrain to one RGBA pixel per
 * cell, shared by the web renderer and the CLI contact sheet so both draw the
 * same thing. Presentation only; nothing in the simulation reads these.
 *
 * The style is pixel art: each cell is one flat color, values come in steps
 * rather than smooth gradients, and relief shading has three levels. Steps keep
 * edges crisp, and small bumps in the terrain that don't cross a step vanish.
 */
export const TERRAIN_VIEWS = ["biome", "terrain", "elevation", "temperature", "rainfall"] as const;
export type TerrainView = (typeof TERRAIN_VIEWS)[number];

export const TERRAIN_VIEW_NAMES: Record<TerrainView, string> = {
  biome: "Biome",
  terrain: "Terrain type",
  elevation: "Elevation",
  temperature: "Temperature",
  rainfall: "Rainfall",
};

export type RGB = readonly [number, number, number];
/** A color ramp: colors at increasing data values, blended linearly between. */
export type Ramp = readonly (readonly [value: number, color: RGB])[];

/** Terrain type colors. Land and mountain are v1's (CritterEvo v1, WorldView.java). */
export const TERRAIN_TYPE_COLORS: Record<TerrainType, RGB> = {
  [TerrainType.DeepWater]: [33, 92, 163],
  [TerrainType.ShallowWater]: [76, 150, 220],
  [TerrainType.Land]: [137, 199, 42],
  [TerrainType.Mountain]: [103, 73, 35],
};

/**
 * Biome view colors. Each biome has its own lightness as well as hue, so biomes
 * whose climates touch (and so can share a border) stay distinct with color
 * vision deficiency, and against water. Checked pairwise with the dataviz
 * palette validator: every bordering pair clears ΔE 8 under protanopia and
 * deuteranopia and ΔE 15 with normal vision. Desert is sand-colored rather than
 * near-white, so with relief shading it doesn't read as snow.
 */
export const BIOME_COLORS: Record<Exclude<Biome, typeof Biome.None>, RGB> = {
  [Biome.Tundra]: hexColor("#dce7ea"),
  [Biome.Taiga]: hexColor("#14391e"),
  [Biome.Grassland]: hexColor("#8dc096"),
  [Biome.TemperateForest]: hexColor("#3a8f4c"),
  [Biome.TemperateRainforest]: hexColor("#00656e"),
  [Biome.Desert]: hexColor("#fee296"),
  [Biome.Savanna]: hexColor("#fd923e"),
  [Biome.Rainforest]: hexColor("#083900"),
};

/** Elevation colors for water by depth, 0 at sea level to 1 at the deepest cell. */
export const WATER_DEPTH_RAMP: Ramp = [
  [0, [128, 184, 226]],
  [1, [14, 38, 88]],
];
/** Elevation colors for land by height, 0 at sea level to 1 at the peak (hypsometric tints). */
export const LAND_HEIGHT_RAMP: Ramp = [
  [0, [78, 140, 74]],
  [0.3, [146, 180, 96]],
  [0.55, [206, 186, 122]],
  [0.75, [156, 116, 80]],
  [0.9, [186, 176, 170]],
  [1, [255, 255, 255]],
];
/**
 * Vertical exaggeration for relief shading, in world units per unit of elevation.
 * Fixed, so a smoother world really does look smoother.
 */
const RELIEF = 400;
/** Slopes whose light is within this of flat ground are drawn plain, so gentle bumps don't show. */
const FLAT_BAND = 0.1;

/**
 * Temperature colors, in °F: a diverging blue-red scale around freezing. Each arm
 * steps evenly in lightness with one hue; the red arm mirrors the blue arm's
 * lightness and chroma.
 */
export const TEMPERATURE_RAMP: Ramp = [
  [-28, [13, 54, 107]],
  [-16, [24, 79, 149]],
  [-4, [42, 120, 214]],
  [8, [109, 167, 236]],
  [20, [183, 211, 246]],
  [32, [240, 239, 236]],
  [44, [244, 194, 190]],
  [56, [228, 133, 126]],
  [68, [199, 72, 69]],
  [80, [137, 43, 42]],
  [92, [98, 27, 26]],
];
/** Rainfall colors, in inches per year: one hue from light (dry) to dark (wet). */
export const RAINFALL_RAMP: Ramp = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5",
  "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b",
].map((hex, k) => [k * 12.5, hexColor(hex)] as const);

/** Water in the climate views, kept dark and neutral so only land carries the scale. */
export const CLIMATE_WATER: RGB = [42, 48, 56];

/** One step of a stepped scale: values from `from` up to `to` are drawn in `color`. */
export interface ColorStep {
  from: number;
  to: number;
  color: RGB;
}

/** Equal steps from `from` to `to`, each colored by the ramp at its middle. */
function colorSteps(ramp: Ramp, from: number, to: number, count: number): readonly ColorStep[] {
  const size = (to - from) / count;
  return Array.from({ length: count }, (_, k) => {
    const lo = from + k * size;
    return { from: lo, to: lo + size, color: rampColor(ramp, lo + size / 2) };
  });
}

/** Land height as a fraction of the peak height, in 8 bands. */
export const LAND_HEIGHT_STEPS = colorSteps(LAND_HEIGHT_RAMP, 0, 1, 8);
/** Water depth as a fraction of the deepest cell, in 3 bands. */
export const WATER_DEPTH_STEPS = colorSteps(WATER_DEPTH_RAMP, 0, 1, 3);
/**
 * Temperature in 9°F steps starting at freezing, so the biome thresholds (23, 41,
 * and 68°F) fall on step edges and temperature bands line up with biome borders.
 */
export const TEMPERATURE_STEPS = colorSteps(TEMPERATURE_RAMP, -22, 95, 13);
/** Rainfall in 10 inch steps, so the biome thresholds (20, 40, 80, and 100 in) fall on step edges. */
export const RAINFALL_STEPS = colorSteps(RAINFALL_RAMP, 0, 150, 15);

/** The color of the step a value falls in. Values beyond the ends take the end steps. */
export function stepColor(steps: readonly ColorStep[], value: number): RGB {
  for (const step of steps) if (value < step.to) return step.color;
  return steps[steps.length - 1]!.color;
}

function hexColor(hex: string): RGB {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Color blended linearly along a ramp. Used to pick each step's color. */
export function rampColor(ramp: Ramp, value: number): RGB {
  if (value <= ramp[0]![0]) return ramp[0]![1];
  for (let k = 1; k < ramp.length; k++) {
    const [v1, c1] = ramp[k]!;
    if (value <= v1) {
      const [v0, c0] = ramp[k - 1]!;
      const f = (value - v0) / (v1 - v0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return ramp[ramp.length - 1]![1];
}

export interface ViewOptions {
  /**
   * Relief shading from the elevation field, lit from the northwest, laid over the
   * view's colors in three levels. Only for views in SHADED_VIEWS: in the
   * temperature and rainfall views lightness carries the value, and shading would
   * change what it says.
   */
  relief?: boolean;
}

/** Views that relief shading can be laid over. */
export const SHADED_VIEWS: readonly TerrainView[] = ["biome", "terrain", "elevation"];

/** Brightness factors for relief shading: lit, plain, shadow, and deep shadow on steep slopes. */
export const RELIEF_SHADES = { lit: 1.18, plain: 1, shadow: 0.8, deepShadow: 0.62 } as const;

/** RGBA pixels for a view: one pixel per cell, in the grid's row order. */
export function viewPixels(terrain: TerrainData, view: TerrainView, options: ViewOptions = {}): Uint8ClampedArray {
  const n = terrain.cols * terrain.rows;
  const pixels = new Uint8ClampedArray(n * 4);
  const color = cellColor(terrain, view);
  const shade = options.relief && SHADED_VIEWS.includes(view) ? reliefShade(terrain) : null;
  for (let i = 0; i < n; i++) {
    const c = color(i);
    const s = shade ? shade[i]! : 1;
    pixels[i * 4] = c[0] * s;
    pixels[i * 4 + 1] = c[1] * s;
    pixels[i * 4 + 2] = c[2] * s;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

function cellColor(terrain: TerrainData, view: TerrainView): (i: number) => RGB {
  switch (view) {
    case "biome":
      return (i) => {
        const biome = terrain.biome[i] as Biome;
        return biome === Biome.None ? TERRAIN_TYPE_COLORS[terrain.terrainType[i] as TerrainType] : BIOME_COLORS[biome];
      };
    case "terrain":
      return (i) => TERRAIN_TYPE_COLORS[terrain.terrainType[i] as TerrainType];
    case "elevation":
      return elevationColor(terrain);
    case "temperature":
      return climateColor(terrain, terrain.temperature, TEMPERATURE_STEPS);
    case "rainfall":
      return climateColor(terrain, terrain.rainfall, RAINFALL_STEPS);
  }
}

function climateColor(terrain: TerrainData, field: Float32Array, steps: readonly ColorStep[]): (i: number) => RGB {
  return (i) => (isWater(terrain.terrainType[i] as TerrainType) ? CLIMATE_WATER : stepColor(steps, field[i]!));
}

/** Elevation bands: water by depth, land by height from green lowlands to white peaks. */
function elevationColor(terrain: TerrainData): (i: number) => RGB {
  const { elevation, levels } = terrain;
  let lowest = Infinity;
  for (const e of elevation) lowest = Math.min(lowest, e);
  return (i) => {
    const e = elevation[i]!;
    return e < levels.sea
      ? stepColor(WATER_DEPTH_STEPS, (levels.sea - e) / Math.max(1e-9, levels.sea - lowest))
      : stepColor(LAND_HEIGHT_STEPS, heightOf(terrain, e) / (terrain.peakHeight || 1));
  };
}

/**
 * Brightness factor per cell for relief shading, lit from the northwest and
 * above, in RELIEF_SHADES levels. Slopes close to flat stay plain, so only real
 * hillsides are shaded. Land is shaded as it is shaped in feet, so flattened
 * lowlands look flat. Water is never shaded: its surface is flat.
 */
function reliefShade(terrain: TerrainData): Float32Array {
  const { cols, rows, cellSize, elevation, terrainType, levels } = terrain;
  const landScale = (levels.peak - levels.sea) / (terrain.peakHeight || 1);
  const surface = elevation.map((e) => (e < levels.sea ? levels.sea : levels.sea + heightOf(terrain, e) * landScale));
  const at = (col: number, row: number) =>
    surface[Math.min(rows - 1, Math.max(0, row)) * cols + Math.min(cols - 1, Math.max(0, col))]!;
  const shade = new Float32Array(cols * rows).fill(RELIEF_SHADES.plain);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (isWater(terrainType[i] as TerrainType)) continue;
      const dx = ((at(col + 1, row) - at(col - 1, row)) / (2 * cellSize)) * RELIEF;
      const dy = ((at(col, row + 1) - at(col, row - 1)) / (2 * cellSize)) * RELIEF;
      const light = (dx + dy + 1) / Math.sqrt(dx * dx + dy * dy + 1);
      if (light > 1 + FLAT_BAND) shade[i] = RELIEF_SHADES.lit;
      else if (light < 1 - 3 * FLAT_BAND) shade[i] = RELIEF_SHADES.deepShadow;
      else if (light < 1 - FLAT_BAND) shade[i] = RELIEF_SHADES.shadow;
    }
  }
  return shade;
}
