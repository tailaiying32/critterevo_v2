import type { ControllerKind, CritterInfo, CritterTraits, DeathRecord, Snapshot, StatsRows, TerrainData, WorldConfig } from "@critter-evo/core";

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
  | { type: "brush"; brush: Brush }
  /** Selects the critter nearest a point, within tolerance of its edge, or clears the selection if there is none. */
  | { type: "pick"; x: number; y: number; tolerance: number }
  | { type: "deselect" }
  /** Spawn tool: adds a critter if its body fits there, and selects it. */
  | { type: "spawn"; x: number; y: number; traits: CritterTraits; controller: ControllerKind }
  | { type: "setController"; id: number; controller: ControllerKind }
  | { type: "removeCritter"; id: number }
  /**
   * Keyboard controller: the keys held, as turn −1 to 1 and thrust 0 to 1. Any
   * input puts the selected critter under keyboard control.
   */
  | { type: "drive"; turn: number; thrust: number };

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
      /** Its plant and critter buffers are transferred, not copied. */
      snapshot: Snapshot;
      /** The selected critter, or null if none is selected or it has died. */
      selected: CritterInfo | null;
      /** How the selected critter died, if it has. It stays selected until something else is picked. */
      death: DeathRecord | null;
      running: boolean;
      /** Ticks actually simulated per wall-clock second, measured in the worker. */
      measuredTps: number;
      /** Fingerprint of the full world state. Refreshed a few times a second while running. */
      stateHash: string;
      /** Stats rows recorded since the last frame, or null if there are none. */
      stats: StatsRows | null;
    };
