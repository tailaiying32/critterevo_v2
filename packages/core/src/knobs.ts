/**
 * The knob registry. Every tunable world parameter is declared here exactly once,
 * with its default, range, and description. WorldConfig, DEFAULT_CONFIG, config
 * validation, and the web settings panel are all derived from this table, so
 * adding a knob is a single entry (docs/DESIGN.md principle 3).
 */

/** Groups shown as sections in the settings panel, in display order. */
export const KNOB_GROUPS = ["World", "Terrain", "Climate", "Simulation"] as const;
export type KnobGroup = (typeof KNOB_GROUPS)[number];

/**
 * When a change takes effect.
 * - "new-world": only when a new world is generated.
 * - "live": immediately, while the simulation runs.
 */
export type KnobApplies = "new-world" | "live";

interface KnobBase {
  label: string;
  group: KnobGroup;
  description: string;
  applies: KnobApplies;
  /** Shown in the world page sidebar as well as the settings page. Keep this list short. */
  featured?: boolean;
}

export interface NumberKnobSpec extends KnobBase {
  kind: "number";
  default: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  unit?: string;
  /** "slider" shows a slider plus a text field; "input" shows only the field. Defaults to "slider". */
  control?: "slider" | "input";
}

export interface BooleanKnobSpec extends KnobBase {
  kind: "boolean";
  default: boolean;
}

export type KnobSpec = NumberKnobSpec | BooleanKnobSpec;

export type KnobValue<S extends KnobSpec> = S extends BooleanKnobSpec ? boolean : number;

export const KNOBS = {
  // ---------------- World ----------------
  seed: {
    kind: "number",
    label: "Seed",
    group: "World",
    description: "Seed for all randomness in the world. The same seed and settings always produce the same run.",
    applies: "new-world",
    featured: true,
    default: 1,
    min: 0,
    max: 4294967295,
    step: 1,
    integer: true,
    control: "input",
  },
  width: {
    kind: "number",
    label: "Width",
    group: "World",
    description: "World width in world units. A typical critter is about 10 units across.",
    applies: "new-world",
    featured: true,
    default: 3000,
    min: 100,
    max: 10000,
    step: 10,
    integer: true,
    unit: "u",
  },
  height: {
    kind: "number",
    label: "Height",
    group: "World",
    description: "World height in world units.",
    applies: "new-world",
    featured: true,
    default: 3000,
    min: 100,
    max: 10000,
    step: 10,
    integer: true,
    unit: "u",
  },
  cellSize: {
    kind: "number",
    label: "Terrain cell size",
    group: "World",
    description:
      "Size of a terrain cell, drawn as one pixel of the map. Each cell has one elevation, climate, and biome. The default is about one critter across. Smaller cells give finer detail without changing the shape of the world. Raised automatically if the world would exceed 4 million cells.",
    applies: "new-world",
    default: 10,
    min: 2,
    max: 50,
    step: 1,
    integer: true,
    unit: "u",
  },

  // ---------------- Terrain (docs/DESIGN.md §4.2) ----------------
  landformSize: {
    kind: "number",
    label: "Landform size",
    group: "Terrain",
    description: "Approximate size of the largest landforms: continents, seas, and ranges. It is the wavelength of the first octave of noise.",
    applies: "new-world",
    featured: true,
    default: 1350,
    min: 50,
    max: 5000,
    step: 10,
    unit: "u",
  },
  octaves: {
    kind: "number",
    label: "Octaves",
    group: "Terrain",
    description: "Layers of noise stacked into the terrain, each finer than the last. More octaves add finer detail to coastlines and hills.",
    applies: "new-world",
    default: 5,
    min: 1,
    max: 8,
    step: 1,
    integer: true,
  },
  persistence: {
    kind: "number",
    label: "Persistence",
    group: "Terrain",
    description:
      "Strength of each octave relative to the one before. Keep persistence × lacunarity below 1 for smooth land; at 1 or more, the finest bumps are as steep as the continents.",
    applies: "new-world",
    default: 0.3,
    min: 0.1,
    max: 0.9,
    step: 0.01,
  },
  lacunarity: {
    kind: "number",
    label: "Lacunarity",
    group: "Terrain",
    description: "How much finer each octave is than the one before.",
    applies: "new-world",
    default: 2,
    min: 1.5,
    max: 3,
    step: 0.05,
  },
  waterCoverage: {
    kind: "number",
    label: "Water coverage",
    group: "Terrain",
    description: "Share of the world, the lowest part, that is water.",
    applies: "new-world",
    featured: true,
    default: 30,
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
  },
  shallowWaterShare: {
    kind: "number",
    label: "Shallow share of water",
    group: "Terrain",
    description: "Share of the water, the part closest to sea level, that is shallow: passable, slow, and drinkable. The rest is deep and acts as a wall.",
    applies: "new-world",
    default: 25,
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
  },
  mountainCoverage: {
    kind: "number",
    label: "Mountain coverage",
    group: "Terrain",
    description: "Share of the world, the highest part, that is mountains. If water and mountain coverage add up to more than 100%, water wins.",
    applies: "new-world",
    default: 10,
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
  },

  // ---------------- Climate (docs/DESIGN.md §4.2) ----------------
  peakHeight: {
    kind: "number",
    label: "Peak height",
    group: "Climate",
    description: "Height of the tallest point in the world above sea level. Higher ground is colder.",
    applies: "new-world",
    default: 30000,
    min: 0,
    max: 40000,
    step: 100,
    integer: true,
    unit: "ft",
  },

  lowlandFlatness: {
    kind: "number",
    label: "Lowland flatness",
    group: "Climate",
    description:
      "How much of the land sits low. At 0, height rises evenly from the coast to the peak. Higher values keep lowlands low and peaks tall, so more land is warm. Changes height and temperature only, not the shape of the land.",
    applies: "new-world",
    default: 0.85,
    min: 0,
    max: 1,
    step: 0.05,
  },
  lapseRate: {
    kind: "number",
    label: "Lapse rate",
    group: "Climate",
    description: "How much colder it gets per 1,000 ft of height. Earth's average is 3.6°F.",
    applies: "new-world",
    default: 3.6,
    min: 0,
    max: 10,
    step: 0.1,
    unit: "°F",
  },
  seaLevelTemperature: {
    kind: "number",
    label: "Sea-level temperature",
    group: "Climate",
    description:
      "Mean annual temperature at sea level. Higher ground is colder by the lapse rate, so climate zones follow height, like the zones up a mountain.",
    applies: "new-world",
    default: 70,
    min: -20,
    max: 120,
    step: 1,
    unit: "°F",
  },
  latitudeCooling: {
    kind: "number",
    label: "Latitude cooling",
    group: "Climate",
    description:
      "How much colder sea level is at the top and bottom edges than across the middle, rising smoothly in between. At 0, sea level is the same temperature everywhere and only height sets the climate.",
    applies: "new-world",
    default: 0,
    min: 0,
    max: 120,
    step: 1,
    unit: "°F",
  },
  temperatureNoise: {
    kind: "number",
    label: "Temperature variation",
    group: "Climate",
    description: "How far local temperature can wander above or below its sea-level value, before cooling with height.",
    applies: "new-world",
    default: 5,
    min: 0,
    max: 30,
    step: 0.5,
    unit: "°F",
  },

  driestRainfall: {
    kind: "number",
    label: "Driest rainfall",
    group: "Climate",
    description: "Annual rainfall in the driest places, before the extra rain near water. Rainfall is spread evenly between the driest and wettest values.",
    applies: "new-world",
    default: 5,
    min: 0,
    max: 200,
    step: 1,
    unit: "in",
  },
  wettestRainfall: {
    kind: "number",
    label: "Wettest rainfall",
    group: "Climate",
    description: "Annual rainfall in the wettest places, before the extra rain near water.",
    applies: "new-world",
    default: 120,
    min: 0,
    max: 400,
    step: 1,
    unit: "in",
  },
  rainfallSkew: {
    kind: "number",
    label: "Rainfall skew",
    group: "Climate",
    description:
      "How rare wet places are. At 0, rainfall is spread evenly between the driest and wettest values. At 1, most land is moderate to dry and only a few places are very wet, as on Earth.",
    applies: "new-world",
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
  },
  shoreRain: {
    kind: "number",
    label: "Rain near water",
    group: "Climate",
    description: "Extra annual rainfall at the water's edge, fading to nothing at the shore rain range. Gives dry land greener coasts and lakeshores.",
    applies: "new-world",
    default: 40,
    min: 0,
    max: 200,
    step: 1,
    unit: "in",
  },
  shoreRainRange: {
    kind: "number",
    label: "Shore rain range",
    group: "Climate",
    description: "How far inland the extra rain near water reaches.",
    applies: "new-world",
    default: 150,
    min: 0,
    max: 2000,
    step: 10,
    unit: "u",
  },
  inlandDrying: {
    kind: "number",
    label: "Inland drying",
    group: "Climate",
    description:
      "How much drier land gets the farther it is from water, as on real continents. Moves deserts inland and keeps shores greener. Rainfall still spans the driest to wettest values.",
    applies: "new-world",
    default: 0.25,
    min: 0,
    max: 1,
    step: 0.05,
  },
  inlandDryingRange: {
    kind: "number",
    label: "Inland drying range",
    group: "Climate",
    description: "Distance from water at which inland drying reaches its full strength.",
    applies: "new-world",
    default: 300,
    min: 10,
    max: 2000,
    step: 10,
    unit: "u",
  },

  // ---------------- Simulation ----------------
  dt: {
    kind: "number",
    label: "Tick length",
    group: "Simulation",
    description: "Simulated seconds per tick. Smaller is more precise but slower to simulate.",
    applies: "new-world",
    default: 1 / 30,
    min: 0.005,
    max: 0.2,
    step: 0.001,
    unit: "s",
  },
} as const satisfies Record<string, KnobSpec>;

export type KnobKey = keyof typeof KNOBS;

/** All knobs as [key, spec] pairs, in declaration order. */
export function knobEntries(): [KnobKey, KnobSpec][] {
  return Object.entries(KNOBS) as [KnobKey, KnobSpec][];
}

/**
 * Coerces a value into a valid value for the knob: clamps numbers to range,
 * rounds integers, and falls back to the default for non-finite input.
 */
export function normalizeKnobValue(spec: KnobSpec, value: number | boolean): number | boolean {
  if (spec.kind === "boolean") return Boolean(value);
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return spec.default;
  const clamped = Math.min(spec.max, Math.max(spec.min, n));
  return spec.integer ? Math.round(clamped) : clamped;
}
