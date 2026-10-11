/**
 * Runs the simulation off the main thread so the UI never freezes
 * (docs/DESIGN.md §3.2). Uses a fixed-timestep accumulator: the sim always
 * advances in whole ticks of identical size, and the speed setting only
 * changes how many ticks run per wall-clock second.
 */
import { Simulation, type Snapshot, type StatsRows, type TerrainData } from "@critter-evo/core";
import type { Brush, FromWorker, Speed, ToWorker } from "./protocol";

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

/** Stats rows already sent: the recorder's epoch and row count when last sent. */
let statsEpochSent = -1;
let statsRowsSent = 0;

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
      statsEpochSent = -1;
      statsRowsSent = 0;
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
    case "updateConfig":
      if (sim) {
        const config = sim.updateConfig(msg.changes);
        ctx.postMessage({ type: "config", config });
        hashStale = true;
      }
      break;
    case "brush":
      if (sim) {
        applyBrush(sim, msg.brush);
        hashStale = true;
        dirty = true;
      }
      break;
  }
};

function applyBrush(sim: Simulation, brush: Brush): void {
  switch (brush.kind) {
    case "graze":
      sim.graze(brush.x, brush.y, brush.radius, brush.leave);
      break;
    case "sow":
      sim.sow(brush.x, brush.y, brush.radius);
      break;
  }
}

/** Stats rows the main thread hasn't seen yet: all of them if older rows were thinned since. */
function newStats(sim: Simulation): StatsRows | null {
  const { stats } = sim;
  if (stats.epoch === statsEpochSent && stats.length === statsRowsSent) return null;
  const rows = stats.rows(stats.epoch === statsEpochSent ? statsRowsSent : 0);
  statsEpochSent = stats.epoch;
  statsRowsSent = stats.length;
  return rows;
}

function frameBuffers(snapshot: Snapshot, stats: StatsRows | null): Transferable[] {
  const { plants } = snapshot;
  const buffers: ArrayBufferLike[] = [plants.x.buffer, plants.y.buffer, plants.energy.buffer];
  if (stats) buffers.push(...stats.data.map((column) => column.buffer));
  return buffers as Transferable[];
}

function copyTerrain(t: TerrainData): TerrainData {
  return {
    ...t,
    levels: { ...t.levels },
    elevation: t.elevation.slice(),
    terrainType: t.terrainType.slice(),
    temperature: t.temperature.slice(),
    distanceToWater: t.distanceToWater.slice(),
    rainfall: t.rainfall.slice(),
    biome: t.biome.slice(),
  };
}

function terrainBuffers(t: TerrainData): Transferable[] {
  const fields = [t.elevation, t.terrainType, t.temperature, t.distanceToWater, t.rainfall, t.biome];
  return fields.map((field) => field.buffer as ArrayBuffer);
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
    const snapshot = sim.snapshot();
    const stats = newStats(sim);
    ctx.postMessage({ type: "frame", snapshot, running, measuredTps, stateHash, stats }, frameBuffers(snapshot, stats));
    dirty = false;
  }

  setTimeout(frame, FRAME_MS);
}

frame();
