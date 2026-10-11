import type { Snapshot, WorldConfig } from "@critter-evo/core";

/** Simulation speed: a target ticks per second, or as fast as the worker can go. */
export type Speed = number | "max";

/** Commands the main thread sends to the simulation worker. */
export type ToWorker =
  | { type: "init"; config: WorldConfig }
  | { type: "play" }
  | { type: "pause" }
  | { type: "step"; ticks: number }
  | { type: "setSpeed"; speed: Speed };

/** Messages the worker sends back. The main thread never mutates sim state. */
export type FromWorker =
  | {
      /** Sent once per generated world, with the config actually in use (after clamping). */
      type: "world";
      config: WorldConfig;
    }
  | {
      type: "frame";
      snapshot: Snapshot;
      running: boolean;
      /** Ticks actually simulated per wall-clock second, measured in the worker. */
      measuredTps: number;
      /** Fingerprint of the full world state. Refreshed a few times a second while running. */
      stateHash: string;
    };
