/**
 * Headless simulation runner. Runs the same core as the browser, with no rendering.
 *
 *   npm run sim -- --seed 42 --ticks 100000
 *   npm run sim -- --config my-world.json --ticks 0
 */
import {
  BIOME_NAMES,
  parseConfig,
  Simulation,
  TERRAIN_TYPE_NAMES,
  isWater,
  type TerrainData,
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

function printTerrainSummary(terrain: TerrainData): void {
  const n = terrain.cols * terrain.rows;
  console.log(`terrain     ${terrain.cols} x ${terrain.rows} samples, ${terrain.cellSize} u apart`);

  const typeCounts = new Array<number>(TERRAIN_TYPE_NAMES.length).fill(0);
  const biomeCounts = new Array<number>(BIOME_NAMES.length).fill(0);
  let minT = Infinity;
  let maxT = -Infinity;
  let land = 0;
  for (let i = 0; i < n; i++) {
    typeCounts[terrain.terrainType[i]!]!++;
    if (!isWater(terrain.terrainType[i]!)) {
      land++;
      biomeCounts[terrain.biome[i]!]!++;
    }
    minT = Math.min(minT, terrain.temperature[i]!);
    maxT = Math.max(maxT, terrain.temperature[i]!);
  }

  const pct = (count: number, total: number) => `${((100 * count) / Math.max(1, total)).toFixed(1).padStart(5)}%`;
  console.log(`temperature ${minT.toFixed(0)}°F to ${maxT.toFixed(0)}°F`);
  console.log("\nterrain type (share of samples)");
  TERRAIN_TYPE_NAMES.forEach((name, i) => console.log(`  ${name.padEnd(22)}${pct(typeCounts[i]!, n)}`));
  console.log("\nbiome (share of land samples)");
  BIOME_NAMES.forEach((name, i) => {
    if (i === 0) return;
    console.log(`  ${name.padEnd(22)}${pct(biomeCounts[i]!, land)}`);
  });
}
