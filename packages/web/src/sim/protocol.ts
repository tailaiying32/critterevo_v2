import type { Snapshot, StatsRows, TerrainData, WorldConfig } from "@critter-evo/core";

/** Simulation speed: a target ticks per second, or as fast as the worker can go. */
export type Speed = number | "max";

/** A brush stroke at one point. Brushes are debug tools that change the world directly. */
export type Brush =
  /** Grazes plants within the radius down to at most a share of full energy. */
  | { kind: "graze"; x: number; y: number; radius: number; leave: number }
  /** Sows fully grown plants within the radius. */
  | { kind: "sow"; x: number; y: number; radius: number };

/** Commands the main thread sends to the simulation worker. */
export type ToWorker =
  | { type: "init"; config: WorldConfig }
  | { type: "play" }
  | { type: "pause" }
  | { type: "step"; ticks: number }
  | { type: "setSpeed"; speed: Speed }
  /** Changes live knobs in the running world. Other knobs are ignored. */
  | { type: "updateConfig"; changes: Partial<WorldConfig> }
  | { type: "brush"; brush: Brush };

/** Messages the worker sends back. The main thread never mutates sim state. */
export type FromWorker =
  | {
      /** Sent once per generated world, with the config actually in use (after clamping). */
      type: "world";
      config: WorldConfig;
      /** Static terrain, sent once per world. Its buffers are transferred, not copied. */
      terrain: TerrainData;
      /** Wall-clock time spent generating the world. */
      generationMs: number;
    }
  | {
      /** Sent when live knobs change, with the config now in use. */
      type: "config";
      config: WorldConfig;
    }
  | {
      type: "frame";
      /** Its plant buffers are transferred, not copied. */
      snapshot: Snapshot;
      running: boolean;
      /** Ticks actually simulated per wall-clock second, measured in the worker. */
      measuredTps: number;
      /** Fingerprint of the full world state. Refreshed a few times a second while running. */
      stateHash: string;
      /** Stats rows recorded since the last frame, or null if there are none. */
      stats: StatsRows | null;
    };
