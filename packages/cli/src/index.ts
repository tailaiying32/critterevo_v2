/**
 * Headless simulation runner. Runs the same core as the browser, with no rendering.
 *
 *   npm run sim -- --seed 42 --ticks 100000
 *   npm run sim -- --config my-world.json --ticks 0
 */
import {
  Biome,
  BIOME_NAMES,
  countSpecks,
  heightOf,
  isWater,
  parseConfig,
  Simulation,
  SPECK_AREA,
  STATS_BIOMES,
  TERRAIN_TYPE_NAMES,
  type TerrainData,
  type TerrainType,
  type WorldConfig,
} from "@critter-evo/core";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    seed: { type: "string" },
    ticks: { type: "string", default: "10000" },
    config: { type: "string" },
  },
});

let config: Partial<WorldConfig> = {};
if (values.config) {
  try {
    const { config: parsed, warnings } = parseConfig(JSON.parse(readFileSync(values.config, "utf8")));
    for (const warning of warnings) console.warn(`warning: ${warning}`);
    config = parsed;
  } catch (err) {
    console.error(`Could not load config ${values.config}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
if (values.seed !== undefined) config = { ...config, seed: Number.parseInt(values.seed, 10) };

const ticks = Number.parseInt(values.ticks, 10);
if (!Number.isFinite(ticks) || ticks < 0 || (config.seed !== undefined && !Number.isFinite(config.seed))) {
  console.error("Usage: npm run sim -- [--seed <int>] [--config <file.json>] [--ticks <int>]");
  process.exit(1);
}

const generationStart = performance.now();
const sim = new Simulation(config);
const generationMs = performance.now() - generationStart;

const start = performance.now();
sim.stepMany(ticks);
const elapsedMs = performance.now() - start;

console.log(`seed        ${sim.config.seed}`);
console.log(`world       ${sim.config.width} x ${sim.config.height} u`);
console.log(`generation  ${generationMs.toFixed(1)} ms`);
console.log(`ticks       ${sim.tick.toLocaleString()}`);
console.log(`sim time    ${sim.time.toFixed(1)} s`);
console.log(`state hash  ${sim.stateHash()}`);
if (ticks > 0) {
  console.log(`wall time   ${elapsedMs.toFixed(1)} ms (${Math.round((ticks / elapsedMs) * 1000).toLocaleString()} tick/s)`);
}
console.log();
printTerrainSummary(sim.terrain);
console.log();
printPlantSummary(sim);
console.log();
printCritterSummary(sim);

function printTerrainSummary(terrain: TerrainData): void {
  const n = terrain.cols * terrain.rows;
  const { sea, shallow, mountain, peak } = terrain.levels;
  const level = (value: number) => (Number.isFinite(value) ? value.toFixed(3) : "none");
  console.log(`terrain     ${terrain.cols} x ${terrain.rows} cells, ${terrain.cellSize} u each`);
  console.log(`elevation   deep below ${level(shallow)}, sea level ${level(sea)}, mountains from ${level(mountain)}, peak ${level(peak)}`);
  const landHeights = [...terrain.elevation].filter((e) => e >= sea).map((e) => heightOf(terrain, e));
  landHeights.sort((a, b) => a - b);
  const median = landHeights.length ? Math.round(landHeights[landHeights.length >> 1]!).toLocaleString("en-US") : "–";
  console.log(`height      peak ${terrain.peakHeight.toLocaleString("en-US")} ft, median land ${median} ft`);
  const counts = new Array<number>(TERRAIN_TYPE_NAMES.length).fill(0);
  for (let i = 0; i < n; i++) counts[terrain.terrainType[i]!]!++;
  const specks = countSpecks(terrain);
  console.log("\nterrain type (share of cells, specks)");
  TERRAIN_TYPE_NAMES.forEach((name, i) =>
    console.log(`  ${name.padEnd(14)}${((100 * counts[i]!) / n).toFixed(1).padStart(5)}%${String(specks.byType[i]).padStart(6)}`),
  );
  console.log(`\nspecks      ${specks.total} (patches under ${SPECK_AREA} square units)`);

  const temperature = landStats(terrain, terrain.temperature);
  if (temperature) console.log(`temperature ${temperature} °F on land`);
  const rainfall = landStats(terrain, terrain.rainfall);
  if (rainfall) console.log(`rainfall    ${rainfall} in a year on land`);

  const biomes = new Array<number>(BIOME_NAMES.length).fill(0);
  for (const biome of terrain.biome) biomes[biome]!++;
  const land = n - biomes[Biome.None]!;
  if (land > 0) {
    console.log("\nbiome (share of land)");
    BIOME_NAMES.forEach((name, biome) => {
      if (biome !== Biome.None) console.log(`  ${name.padEnd(22)}${((100 * biomes[biome]!) / land).toFixed(1).padStart(5)}%`);
    });
  }
}

function printPlantSummary(sim: Simulation): void {
  const stats = sim.plants.stats();
  const mean = stats.count > 0 ? (stats.energy / stats.count / sim.config.plantEnergy) * 100 : 0;
  console.log(`plants      ${stats.count.toLocaleString("en-US")}, ${Math.round(stats.energy).toLocaleString("en-US")} energy (${mean.toFixed(0)}% of full on average)`);
  const cells = new Array<number>(BIOME_NAMES.length).fill(0);
  for (const biome of sim.terrain.biome) cells[biome]!++;
  const cellArea = sim.terrain.cellSize * sim.terrain.cellSize;
  console.log("\nplants by biome (count, per 100 by 100 units)");
  for (const biome of STATS_BIOMES) {
    const area = cells[biome]! * cellArea;
    const density = area > 0 ? ((stats.countByBiome[biome]! / area) * 10000).toFixed(1) : "–";
    console.log(`  ${BIOME_NAMES[biome]!.padEnd(22)}${String(stats.countByBiome[biome]).padStart(7)}${density.padStart(8)}`);
  }
}

function printCritterSummary(sim: Simulation): void {
  const { critters } = sim;
  const values = (field: Float64Array) => {
    const out: number[] = [];
    for (let i = 0; i < critters.slots; i++) if (critters.alive[i]) out.push(field[i]!);
    return out;
  };
  const range = (field: Float64Array, digits: number) => {
    const v = values(field);
    if (v.length === 0) return "–";
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    return `${Math.min(...v).toFixed(digits)} to ${Math.max(...v).toFixed(digits)}, mean ${mean.toFixed(digits)}`;
  };
  let totalSpeed = 0;
  let blocked = 0;
  for (let i = 0; i < critters.slots; i++) {
    if (!critters.alive[i]) continue;
    totalSpeed += Math.hypot(critters.vx[i]!, critters.vy[i]!);
    blocked += critters.blocked[i]!;
  }
  const meanSpeed = critters.count > 0 ? totalSpeed / critters.count : 0;
  console.log(`critters    ${critters.count.toLocaleString("en-US")}, moving at ${meanSpeed.toFixed(1)} u/s on average, ${blocked} against a wall`);
  if (critters.count === 0) return;
  console.log(`  size        ${range(critters.size, 2)}`);
  console.log(`  max speed   ${range(critters.maxSpeed, 1)} u/s`);
  console.log(`  turn rate   ${range(critters.turnRate, 0)} °/s`);
}

/** "min to max, mean x" of a field over land, or null if there is no land. */
function landStats(terrain: TerrainData, field: Float32Array): string | null {
  let min = Infinity;
  let max = -Infinity;
  let total = 0;
  let land = 0;
  field.forEach((v, i) => {
    if (isWater(terrain.terrainType[i] as TerrainType)) return;
    min = Math.min(min, v);
    max = Math.max(max, v);
    total += v;
    land++;
  });
  return land > 0 ? `${min.toFixed(1)} to ${max.toFixed(1)}, mean ${(total / land).toFixed(1)}` : null;
}
