/**
 * Headless simulation runner. Runs the same core as the browser, with no rendering.
 *
 *   npm run sim -- --seed 42 --ticks 100000
 */
import { Simulation } from "@critter-evo/core";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "1" },
    ticks: { type: "string", default: "10000" },
  },
});

const seed = Number.parseInt(values.seed, 10);
const ticks = Number.parseInt(values.ticks, 10);
if (!Number.isFinite(seed) || !Number.isFinite(ticks) || ticks < 0) {
  console.error("Usage: npm run sim -- --seed <int> --ticks <int>");
  process.exit(1);
}

const sim = new Simulation({ seed });
const start = performance.now();
sim.stepMany(ticks);
const elapsedMs = performance.now() - start;

console.log(`seed        ${seed}`);
console.log(`ticks       ${sim.tick.toLocaleString()}`);
console.log(`sim time    ${sim.time.toFixed(1)} s`);
console.log(`state hash  ${sim.stateHash()}`);
console.log(`wall time   ${elapsedMs.toFixed(1)} ms (${Math.round((ticks / elapsedMs) * 1000).toLocaleString()} tick/s)`);
