/**
 * Biomes (docs/DESIGN.md §4.4): a Whittaker lookup on a cell's own mean annual
 * temperature and rainfall. Stored per cell as a Uint8; water has none.
 */
export const Biome = {
  None: 0,
  Tundra: 1,
  Taiga: 2,
  Grassland: 3,
  TemperateForest: 4,
  TemperateRainforest: 5,
  Desert: 6,
  Savanna: 7,
  Rainforest: 8,
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];

export const BIOME_NAMES: readonly string[] = [
  "None",
  "Tundra",
  "Taiga",
  "Grassland",
  "Temperate forest",
  "Temperate rainforest",
  "Desert",
  "Savanna",
  "Rainforest",
];

/**
 * Whittaker's thresholds, converted to °F and inches of rain a year. Tundra and
 * taiga are set by temperature alone, as in reality, where the tree line is a
 * temperature limit.
 */
export const BIOME_THRESHOLDS = {
  /** Tropical at or above this (20°C). */
  tropical: 68,
  /** Temperate at or above this (5°C). */
  temperate: 41,
  /** Boreal at or above this (−5°C); polar below. */
  boreal: 23,
  /** Tropical: desert below this (50 cm). */
  tropicalDry: 20,
  /** Tropical: rainforest above this (250 cm). */
  tropicalWet: 100,
  /** Temperate: grassland below this (100 cm). */
  temperateDry: 40,
  /** Temperate: temperate rainforest above this (200 cm). */
  temperateWet: 80,
} as const;

export function classifyBiome(temperature: number, rainfall: number): Biome {
  const t = BIOME_THRESHOLDS;
  if (temperature < t.boreal) return Biome.Tundra;
  if (temperature < t.temperate) return Biome.Taiga;
  if (temperature < t.tropical) {
    if (rainfall < t.temperateDry) return Biome.Grassland;
    return rainfall > t.temperateWet ? Biome.TemperateRainforest : Biome.TemperateForest;
  }
  if (rainfall < t.tropicalDry) return Biome.Desert;
  return rainfall > t.tropicalWet ? Biome.Rainforest : Biome.Savanna;
}
