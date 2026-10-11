/**
 * The knob registry. Every tunable world parameter is declared here exactly once,
 * with its default, range, and description. WorldConfig, DEFAULT_CONFIG, config
 * validation, and the web settings panel are all derived from this table, so
 * adding a knob is a single entry (docs/DESIGN.md principle 3).
 */

/** Groups shown as sections in the settings panel, in display order. */
export const KNOB_GROUPS = ["World", "Terrain", "Water", "Climate", "Simulation"] as const;
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

/** Default landform size, tuned for the default world size. */
const LANDFORM_DEFAULT = 800;

export const KNOBS = {
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
    description: "World width in world units.",
    applies: "new-world",
    featured: true,
    default: 2000,
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
    default: 2000,
    min: 100,
    max: 10000,
    step: 10,
    integer: true,
    unit: "u",
  },

  // ---------------- Terrain (docs/DESIGN.md §4.2) ----------------
  cellSize: {
    kind: "number",
    label: "Terrain resolution",
    group: "Terrain",
    description:
      "Spacing between terrain samples. Terrain is blended smoothly between samples. Smaller spacing gives finer detail but takes longer to generate. Raised automatically if the world would exceed 4 million samples.",
    applies: "new-world",
    default: 5,
    min: 2,
    max: 50,
    step: 1,
    integer: true,
    unit: "u",
  },
  elevationFeatureSize: {
    kind: "number",
    label: "Landform size",
    group: "Terrain",
    description: "Approximate size of the largest landforms: continents, basins, and ranges.",
    applies: "new-world",
    featured: true,
    default: LANDFORM_DEFAULT,
    min: 50,
    max: 5000,
    step: 10,
    unit: "u",
  },
  elevationOctaves: {
    kind: "number",
    label: "Detail layers",
    group: "Terrain",
    description: "Number of noise layers stacked into the elevation. More layers add finer detail to coastlines and hills.",
    applies: "new-world",
    default: 4,
    min: 1,
    max: 8,
    step: 1,
    integer: true,
  },
  elevationPersistence: {
    kind: "number",
    label: "Detail strength",
    group: "Terrain",
    description: "How strongly each finer layer of detail contributes, relative to the layer before it. Higher is rougher.",
    applies: "new-world",
    default: 0.4,
    min: 0.1,
    max: 0.9,
    step: 0.01,
  },
  elevationLacunarity: {
    kind: "number",
    label: "Detail scaling",
    group: "Terrain",
    description: "How much finer each layer of detail is than the layer before it.",
    applies: "new-world",
    default: 2,
    min: 1.5,
    max: 3,
    step: 0.05,
  },
  lowlandFlatness: {
    kind: "number",
    label: "Lowland flatness",
    group: "Terrain",
    description: "Flattens land near sea level into plains and steepens high ground into peaks. Does not change where water or mountains are.",
    applies: "new-world",
    default: 0.6,
    min: 0,
    max: 1,
    step: 0.01,
  },
  erosionAmount: {
    kind: "number",
    label: "Rain erosion",
    group: "Terrain",
    description:
      "Simulated raindrops per terrain sample. Rain carves valleys and gullies and smooths slopes. 0 turns erosion off. Higher takes longer to generate.",
    applies: "new-world",
    default: 4,
    min: 0,
    max: 10,
    step: 0.5,
  },
  edgeFalloff: {
    kind: "number",
    label: "Edge falloff",
    group: "Terrain",
    description: "Pushes land near the walls down into ocean. At 1 the world becomes an island surrounded by water.",
    applies: "new-world",
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
  },
  waterCoverage: {
    kind: "number",
    label: "Water coverage",
    group: "Water",
    description: "Share of the world below sea level. Lakes and rivers come on top of this, usually another 5 to 15%.",
    applies: "new-world",
    featured: true,
    default: 15,
    min: 0,
    max: 90,
    step: 1,
    unit: "%",
  },
  shallowWaterShare: {
    kind: "number",
    label: "Shallow water share",
    group: "Water",
    description: "Share of the water, the shallowest part, that is shallow: passable, slow, and drinkable.",
    applies: "new-world",
    default: 30,
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
  },
  mountainCoverage: {
    kind: "number",
    label: "Mountain coverage",
    group: "Terrain",
    description: "Share of the land, the highest part, that is mountains.",
    applies: "new-world",
    default: 15,
    min: 0,
    max: 80,
    step: 1,
    unit: "%",
  },

  lakeMinDepth: {
    kind: "number",
    label: "Lake depth threshold",
    group: "Water",
    description:
      "How deep a basin must be, as a share of the world's height range, before rain fills it into a lake. Lower makes more, smaller lakes.",
    applies: "new-world",
    default: 0.01,
    min: 0,
    max: 0.2,
    step: 0.001,
  },
  riverSourceArea: {
    kind: "number",
    label: "River source area",
    group: "Water",
    description: "Land area that must drain through a point before a river forms there. Lower makes more, longer rivers.",
    applies: "new-world",
    default: 20000,
    min: 1000,
    max: 500000,
    step: 1000,
    unit: "u²",
  },
  riverWidth: {
    kind: "number",
    label: "River width",
    group: "Water",
    description: "Scales how wide rivers grow as they collect water downstream.",
    applies: "new-world",
    default: 1,
    min: 0.2,
    max: 5,
    step: 0.05,
  },
  deepRiverWidth: {
    kind: "number",
    label: "Deep river width",
    group: "Water",
    description: "Rivers at least this wide are deep and cannot be crossed. Narrower rivers are shallow streams: drinkable and wadeable.",
    applies: "new-world",
    default: 8,
    min: 1,
    max: 100,
    step: 0.5,
    unit: "u",
  },

  // ---------------- Climate (docs/DESIGN.md §4.2.1) ----------------
  equatorTemperature: {
    kind: "number",
    label: "Equator temperature",
    group: "Climate",
    description: "Sea-level temperature along the middle of the world.",
    applies: "new-world",
    default: 86,
    min: -20,
    max: 130,
    step: 1,
    unit: "°F",
  },
  poleTemperature: {
    kind: "number",
    label: "Pole temperature",
    group: "Climate",
    description: "Sea-level temperature along the top and bottom edges.",
    applies: "new-world",
    default: 5,
    min: -60,
    max: 80,
    step: 1,
    unit: "°F",
  },
  elevationCooling: {
    kind: "number",
    label: "Elevation cooling",
    group: "Climate",
    description: "How much colder the highest peak is than sea level at the same latitude.",
    applies: "new-world",
    default: 45,
    min: 0,
    max: 120,
    step: 1,
    unit: "°F",
  },
  temperatureVariation: {
    kind: "number",
    label: "Temperature variation",
    group: "Climate",
    description: "Strength of local temperature variation, on top of latitude and elevation.",
    applies: "new-world",
    default: 7,
    min: 0,
    max: 40,
    step: 1,
    unit: "°F",
  },
  temperatureFeatureSize: {
    kind: "number",
    label: "Temperature pattern size",
    group: "Climate",
    description: "Approximate size of warm and cool patches in the local temperature variation.",
    applies: "new-world",
    default: 400,
    min: 50,
    max: 5000,
    step: 10,
    unit: "u",
  },
  moistureFeatureSize: {
    kind: "number",
    label: "Moisture pattern size",
    group: "Climate",
    description: "Approximate size of wet and dry regions.",
    applies: "new-world",
    default: 400,
    min: 50,
    max: 5000,
    step: 10,
    unit: "u",
  },
  moistureOctaves: {
    kind: "number",
    label: "Moisture detail layers",
    group: "Climate",
    description: "Number of noise layers stacked into moisture. More layers give more ragged biome borders.",
    applies: "new-world",
    default: 4,
    min: 1,
    max: 8,
    step: 1,
    integer: true,
  },
  waterMoistureBoost: {
    kind: "number",
    label: "Moisture near water",
    group: "Climate",
    description: "Extra moisture right next to water. It fades to nothing over the moisture range below.",
    applies: "new-world",
    default: 0.35,
    min: 0,
    max: 2,
    step: 0.01,
  },
  waterMoistureRange: {
    kind: "number",
    label: "Moisture range from water",
    group: "Climate",
    description: "Distance from water over which the extra moisture fades to nothing.",
    applies: "new-world",
    default: 80,
    min: 0,
    max: 1000,
    step: 5,
    unit: "u",
  },
  coldThreshold: {
    kind: "number",
    label: "Cold below",
    group: "Climate",
    description: "Cells colder than this are cold biomes: tundra and taiga.",
    applies: "new-world",
    default: 41,
    min: -40,
    max: 100,
    step: 1,
    unit: "°F",
  },
  hotThreshold: {
    kind: "number",
    label: "Hot from",
    group: "Climate",
    description: "Cells at or above this temperature are hot biomes: desert, savanna, and rainforest.",
    applies: "new-world",
    default: 68,
    min: -20,
    max: 120,
    step: 1,
    unit: "°F",
  },
  dryCoverage: {
    kind: "number",
    label: "Dry coverage",
    group: "Climate",
    description: "Share of the land, the driest part, that is dry biomes.",
    applies: "new-world",
    default: 33,
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
  },
  wetCoverage: {
    kind: "number",
    label: "Wet coverage",
    group: "Climate",
    description: "Share of the land, the wettest part, that is wet biomes. Where it overlaps dry coverage, wet wins.",
    applies: "new-world",
    default: 33,
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
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
