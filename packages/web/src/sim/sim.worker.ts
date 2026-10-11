/**
 * Runs the simulation off the main thread so the UI never freezes
 * (docs/DESIGN.md §3.2). Uses a fixed-timestep accumulator: the sim always
 * advances in whole ticks of identical size, and the speed setting only
 * changes how many ticks run per wall-clock second.
 */
import { Simulation, type TerrainData } from "@critter-evo/core";
import type { FromWorker, Speed, ToWorker } from "./protocol";

// The project's tsconfig uses DOM types, so describe the worker scope we use.
const ctx = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

const FRAME_MS = 1000 / 60;
/** Max wall-clock time spent stepping per frame, so the worker stays responsive. */
const STEP_BUDGET_MS = 12;
/** How often to recompute the state hash while running. It gets costlier as the world grows. */
const HASH_INTERVAL_MS = 500;

let sim: Simulation | null = null;
let running = false;
let speed: Speed = 30;
let accumulator = 0;
let lastFrame = performance.now();
let dirty = true;

let tpsWindowStart = performance.now();
let tpsWindowTicks = 0;
let measuredTps = 0;

let stateHash = "";
let hashedAt = -Infinity;
let hashStale = true;

ctx.onmessage = (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      const start = performance.now();
      sim = new Simulation(msg.config);
      const generationMs = performance.now() - start;
      accumulator = 0;
      hashStale = true;
      dirty = true;
      // The sim keeps its own terrain, so send copies and transfer their buffers.
      const terrain = copyTerrain(sim.terrain);
      ctx.postMessage({ type: "world", config: sim.config, terrain, generationMs }, terrainBuffers(terrain));
      break;
    }
    case "play":
      running = true;
      lastFrame = performance.now();
      dirty = true;
      break;
    case "pause":
      running = false;
      hashStale = true;
      dirty = true;
      break;
    case "step":
      if (sim) {
        sim.stepMany(msg.ticks);
        hashStale = true;
        dirty = true;
      }
      break;
    case "setSpeed":
      speed = msg.speed;
      accumulator = 0;
      break;
  }
};

function copyTerrain(t: TerrainData): TerrainData {
  return {
    ...t,
    levels: { ...t.levels },
    elevation: t.elevation.slice(),
    water: t.water.slice(),
    temperature: t.temperature.slice(),
    moisture: t.moisture.slice(),
    waterDistance: t.waterDistance.slice(),
    rivers: t.rivers.slice(),
    terrainType: t.terrainType.slice(),
    biome: t.biome.slice(),
  };
}

function terrainBuffers(t: TerrainData): Transferable[] {
  return [t.elevation, t.water, t.temperature, t.moisture, t.waterDistance, t.rivers, t.terrainType, t.biome].map(
    (array) => array.buffer as ArrayBuffer,
  );
}

function frame(): void {
  const now = performance.now();
  const elapsedMs = now - lastFrame;
  lastFrame = now;

  if (sim && running) {
    const start = performance.now();
    let stepped = 0;
    if (speed === "max") {
      while (performance.now() - start < STEP_BUDGET_MS) {
        sim.step();
        stepped++;
      }
    } else {
      accumulator += (elapsedMs / 1000) * speed;
      while (accumulator >= 1 && performance.now() - start < STEP_BUDGET_MS) {
        sim.step();
        accumulator -= 1;
        stepped++;
      }
      // If the machine can't keep up, drop the backlog instead of spiraling.
      accumulator = Math.min(accumulator, Math.max(1, speed * 0.25));
    }
    tpsWindowTicks += stepped;
    if (stepped > 0) {
      hashStale = true;
      dirty = true;
    }
  }

  if (now - tpsWindowStart >= 1000) {
    measuredTps = (tpsWindowTicks * 1000) / (now - tpsWindowStart);
    tpsWindowStart = now;
    tpsWindowTicks = 0;
    dirty = true;
  }

  if (sim && hashStale && (!running || now - hashedAt >= HASH_INTERVAL_MS)) {
    stateHash = sim.stateHash();
    hashedAt = now;
    hashStale = false;
    dirty = true;
  }

  if (sim && dirty) {
    ctx.postMessage({ type: "frame", snapshot: sim.snapshot(), running, measuredTps, stateHash });
    dirty = false;
  }

  setTimeout(frame, FRAME_MS);
}

frame();
