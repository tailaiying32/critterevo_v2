/**
 * The knob registry. Every tunable world parameter is declared here exactly once,
 * with its default, range, and description. WorldConfig, DEFAULT_CONFIG, config
 * validation, and the web settings panel are all derived from this table, so
 * adding a knob is a single entry (docs/DESIGN.md principle 3).
 */

/** Groups shown as sections in the settings panel, in display order. */
export const KNOB_GROUPS = ["World", "Terrain", "Climate", "Plants", "Plant productivity", "Simulation"] as const;
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

/** A biome's plant productivity knob. The default is the real net primary productivity of the matching ecosystem. */
function productivity(biome: string, npp: number, ecosystem: string): NumberKnobSpec {
  return {
    kind: "number",
    label: biome,
    group: "Plant productivity",
    description: `Net primary productivity of ${biome.toLowerCase()}: plant growth per area per year. Plant density and regrowth speed both scale with its square root, so plant energy produced per area follows it. The default is the measured mean for ${ecosystem}. At 0, no plants grow there.`,
    applies: "live",
    default: npp,
    min: 0,
    max: 4000,
    step: 10,
    integer: true,
    unit: "g/m²/yr",
  };
}

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

  // ---------------- Plants (docs/DESIGN.md §5.1) ----------------
  startingPlants: {
    kind: "number",
    label: "Starting plants",
    group: "Plants",
    description: "Fully grown plants scattered over the land when the world is generated. From a few, patches spread outward until they fill the land.",
    applies: "new-world",
    featured: true,
    default: 2000,
    min: 0,
    max: 200000,
    step: 100,
    integer: true,
  },
  plantEnergy: {
    kind: "number",
    label: "Plant energy",
    group: "Plants",
    description: "Energy in a fully grown plant: the most food one plant can hold.",
    applies: "new-world",
    default: 100,
    min: 1,
    max: 1000,
    step: 1,
  },
  plantDensity: {
    kind: "number",
    label: "Plant density",
    group: "Plants",
    description:
      "How crowded the ground can get, in plants per 100 by 100 units, at 2,200 g/m²/yr, the productivity of rainforest. Less productive biomes allow fewer, by the square root of their productivity. A seed's chance of taking root falls as the plants around it near this density and is zero at it. Settled land ends up somewhat denser, since seeds take root more easily in gaps.",
    applies: "live",
    default: 40,
    min: 0,
    max: 500,
    step: 1,
    unit: "/100²u",
  },
  crowdingRadius: {
    kind: "number",
    label: "Crowding radius",
    group: "Plants",
    description: "How far around a seed the ground is checked for crowding. Larger values give a more even spread.",
    applies: "live",
    default: 20,
    min: 2,
    max: 100,
    step: 1,
    unit: "u",
  },
  regrowthTime: {
    kind: "number",
    label: "Regrowth time",
    group: "Plants",
    description:
      "Time for a rainforest plant to regrow from 10% to 90% of full energy. Less productive biomes take longer, by the square root of their productivity. Growth is logistic, so a plant grazed down low regrows slowly at first.",
    applies: "live",
    default: 60,
    min: 1,
    max: 3600,
    step: 1,
    unit: "s",
  },
  seedlingEnergy: {
    kind: "number",
    label: "Seedling energy",
    group: "Plants",
    description: "Energy a new seedling starts with, as a share of full energy.",
    applies: "live",
    default: 10,
    min: 1,
    max: 100,
    step: 1,
    unit: "%",
  },
  rootReserve: {
    kind: "number",
    label: "Root reserve",
    group: "Plants",
    description: "A plant grazed below this share of full energy dies. Overgrazing kills plants, so a stripped patch can only recover from its edges.",
    applies: "live",
    default: 10,
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
  },
  localSeeding: {
    kind: "boolean",
    label: "Local seeding",
    group: "Plants",
    description: "Mature plants drop seeds nearby, so patches spread outward.",
    applies: "live",
    featured: true,
    default: true,
  },
  seedingMaturity: {
    kind: "number",
    label: "Seeding maturity",
    group: "Plants",
    description: "Plants drop seeds only above this share of full energy, so heavily grazed plants stop spreading.",
    applies: "live",
    default: 50,
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
  },
  seedInterval: {
    kind: "number",
    label: "Seed interval",
    group: "Plants",
    description: "Average time between seeds from one mature plant.",
    applies: "live",
    default: 30,
    min: 1,
    max: 3600,
    step: 1,
    unit: "s",
  },
  seedRadius: {
    kind: "number",
    label: "Seed radius",
    group: "Plants",
    description: "How far from its parent a seed can land.",
    applies: "live",
    default: 30,
    min: 1,
    max: 500,
    step: 1,
    unit: "u",
  },
  longDistanceDispersal: {
    kind: "boolean",
    label: "Long-distance dispersal",
    group: "Plants",
    description: "Seeds land at random anywhere, standing in for wind and birds. Without it, a fully stripped region can never recover.",
    applies: "live",
    featured: true,
    default: true,
  },
  longDistanceRate: {
    kind: "number",
    label: "Long-distance seed rate",
    group: "Plants",
    description: "Seeds per second landing at random in each 1,000 by 1,000 unit area. Most land on water or crowded ground and fail.",
    applies: "live",
    default: 0.2,
    min: 0,
    max: 100,
    step: 0.05,
    unit: "/s",
  },
  plantAging: {
    kind: "boolean",
    label: "Plant lifespan",
    group: "Plants",
    description: "Plants age and die, so patches turn over even without grazing. When off, plants stop aging.",
    applies: "live",
    featured: true,
    default: true,
  },
  plantLifespan: {
    kind: "number",
    label: "Mean lifespan",
    group: "Plants",
    description: "Average age at which plants die. Each plant draws its own lifespan when it sprouts, from half to one and a half times this.",
    applies: "live",
    default: 600,
    min: 10,
    max: 36000,
    step: 10,
    unit: "s",
  },

  // ---------------- Plant productivity (docs/DESIGN.md §4.4) ----------------
  // Net primary productivity by biome, from Whittaker & Likens (1975).
  productivityTundra: productivity("Tundra", 140, "tundra and alpine"),
  productivityTaiga: productivity("Taiga", 800, "boreal forest"),
  productivityGrassland: productivity("Grassland", 600, "temperate grassland"),
  productivityTemperateForest: productivity("Temperate forest", 1200, "temperate deciduous forest"),
  productivityTemperateRainforest: productivity("Temperate rainforest", 1300, "temperate evergreen forest"),
  productivityDesert: productivity("Desert", 90, "desert and semidesert scrub"),
  productivitySavanna: productivity("Savanna", 900, "savanna"),
  productivityRainforest: productivity("Rainforest", 2200, "tropical rainforest"),

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
