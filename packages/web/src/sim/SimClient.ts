import type { Snapshot, TerrainData, WorldConfig } from "@critter-evo/core";
import type { FromWorker, Speed, ToWorker } from "./protocol";

export interface SimStatus {
  snapshot: Snapshot | null;
  running: boolean;
  measuredTps: number;
  stateHash: string;
  /** Config of the world currently running, as clamped by the sim. */
  activeConfig: WorldConfig | null;
  /** Static terrain of the current world. */
  terrain: TerrainData | null;
  /** Wall-clock time the worker spent generating the current world. */
  generationMs: number;
  /** Increments each time a new world is generated. */
  worldId: number;
  /** True from asking for a new world until it arrives. */
  generating: boolean;
}

/**
 * Main-thread handle to the simulation worker. React components read status
 * through subscribe/getStatus (for useSyncExternalStore). The Pixi renderer
 * reads getStatus() directly each frame, so rendering never goes through React.
 */
export class SimClient {
  private readonly worker: Worker;
  private status: SimStatus = {
    snapshot: null,
    running: false,
    measuredTps: 0,
    stateHash: "",
    activeConfig: null,
    terrain: null,
    generationMs: 0,
    worldId: 0,
    generating: false,
  };
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const msg = event.data;
      switch (msg.type) {
        case "world":
          this.update({
            activeConfig: msg.config,
            terrain: msg.terrain,
            generationMs: msg.generationMs,
            worldId: this.status.worldId + 1,
            generating: false,
          });
          break;
        case "frame":
          this.update({
            snapshot: msg.snapshot,
            running: msg.running,
            measuredTps: msg.measuredTps,
            stateHash: msg.stateHash,
          });
          break;
      }
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getStatus = (): SimStatus => this.status;

  init(config: WorldConfig): void {
    this.update({ generating: true });
    this.send({ type: "init", config });
  }
  play(): void {
    this.send({ type: "play" });
  }
  pause(): void {
    this.send({ type: "pause" });
  }
  step(ticks = 1): void {
    this.send({ type: "step", ticks });
  }
  setSpeed(speed: Speed): void {
    this.send({ type: "setSpeed", speed });
  }

  dispose(): void {
    this.worker.terminate();
    this.listeners.clear();
  }

  private update(patch: Partial<SimStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener();
  }

  private send(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }
}
