export { generateTerrain } from "./generate.js";
export { RIVER_STRIDE } from "./rivers.js";
export {
  biomeAt,
  elevationAt,
  heightAboveSeaAt,
  moistureAt,
  riverWidthAtPoint,
  sampleField,
  temperatureAt,
  terrainTypeAt,
  waterDepthAt,
  waterDistanceAt,
  waterLevelAt,
} from "./sample.js";
export {
  Biome,
  BIOME_NAMES,
  BIOME_TABLE,
  classifyBiome,
  classifyTerrain,
  isWater,
  TERRAIN_TYPE_NAMES,
  TerrainType,
  type TerrainData,
  type TerrainLevels,
} from "./types.js";
