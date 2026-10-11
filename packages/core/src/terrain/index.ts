export { Biome, BIOME_NAMES, BIOME_THRESHOLDS, classifyBiome } from "./biomes.js";
export { distanceToWater, seaLevelTemperatureAt } from "./climate.js";
export { generateTerrain } from "./generate.js";
export { biomeAt, cellIndexAt, distanceToWaterAt, elevationAt, heightAt, rainfallAt, temperatureAt, terrainTypeAt } from "./lookup.js";
export { createFractalNoise, type FractalNoiseSettings } from "./noise.js";
export { countSpecks, SPECK_AREA, type SpeckCount } from "./specks.js";
export {
  classifyTerrain,
  heightOf,
  isWater,
  TERRAIN_TYPE_NAMES,
  TerrainType,
  type TerrainData,
  type TerrainLevels,
} from "./types.js";
export {
  BIOME_COLORS,
  CLIMATE_WATER,
  LAND_HEIGHT_RAMP,
  LAND_HEIGHT_STEPS,
  RAINFALL_RAMP,
  RAINFALL_STEPS,
  RELIEF_SHADES,
  rampColor,
  SHADED_VIEWS,
  stepColor,
  TEMPERATURE_STEPS,
  TEMPERATURE_RAMP,
  TERRAIN_TYPE_COLORS,
  TERRAIN_VIEW_NAMES,
  TERRAIN_VIEWS,
  viewPixels,
  WATER_DEPTH_RAMP,
  WATER_DEPTH_STEPS,
  type ColorStep,
  type Ramp,
  type RGB,
  type TerrainView,
  type ViewOptions,
} from "./views.js";
