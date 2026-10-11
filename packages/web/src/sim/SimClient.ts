import type { ControllerKind, CritterInfo, CritterTraits, Snapshot, StatsRows, TerrainData, WorldConfig } from "@critter-evo/core";
import type { Brush, FromWorker, Speed, ToWorker } from "./protocol";

export interface SimStatus {
  snapshot: Snapshot | null;
  /** The selected critter as of the latest frame, or null. */
  selected: CritterInfo | null;
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
  /** Increments whenever stats rows arrive. The rows themselves are in SimClient.stats. */
  statsVersion: number;
}

/** Stats recorded by the sim (docs/DESIGN.md §15), kept on the main thread for charts. */
export class StatsHistory {
  columns: readonly string[] = [];
  /** One array per column. */
  data: number[][] = [];
  /** Ticks between rows. */
  interval = 0;

  get length(): number {
    return this.data[0]?.length ?? 0;
  }

  column(name: string): number[] {
    const c = this.columns.indexOf(name);
    return c >= 0 ? this.data[c]! : [];
  }

  copy(): StatsHistory {
    const copy = new StatsHistory();
    copy.columns = this.columns;
    copy.data = this.data.map((column) => column.slice());
    copy.interval = this.interval;
    return copy;
  }

  /** Adds rows from the worker. Rows from the start replace everything, as after thinning or a new world. */
  apply(rows: StatsRows): void {
    if (rows.start === 0 || rows.start !== this.length) {
      this.columns = rows.columns;
      this.data = rows.columns.map(() => []);
    }
    rows.data.forEach((column, c) => {
      const target = this.data[c]!;
      for (const value of column) target.push(value);
    });
    this.interval = rows.interval;
  }
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
    selected: null,
    running: false,
    measuredTps: 0,
    stateHash: "",
    activeConfig: null,
    terrain: null,
    generationMs: 0,
    worldId: 0,
    generating: false,
    statsVersion: 0,
  };
  readonly stats = new StatsHistory();
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
            selected: null,
          });
          break;
        case "config":
          this.update({ activeConfig: msg.config });
          break;
        case "frame":
          if (msg.stats) this.stats.apply(msg.stats);
          this.update({
            snapshot: msg.snapshot,
            selected: msg.selected,
            running: msg.running,
            measuredTps: msg.measuredTps,
            stateHash: msg.stateHash,
            statsVersion: this.status.statsVersion + (msg.stats ? 1 : 0),
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
  /** Changes live knobs in the running world. */
  updateConfig(changes: Partial<WorldConfig>): void {
    this.send({ type: "updateConfig", changes });
  }
  brush(brush: Brush): void {
    this.send({ type: "brush", brush });
  }
  /** Selects the critter nearest a world point, within tolerance of its edge, or clears the selection. */
  pick(x: number, y: number, tolerance: number): void {
    this.send({ type: "pick", x, y, tolerance });
  }
  deselect(): void {
    this.send({ type: "deselect" });
  }
  spawn(x: number, y: number, traits: CritterTraits, controller: ControllerKind): void {
    this.send({ type: "spawn", x, y, traits, controller });
  }
  setController(id: number, controller: ControllerKind): void {
    this.send({ type: "setController", id, controller });
  }
  removeCritter(id: number): void {
    this.send({ type: "removeCritter", id });
  }
  /** Sets the keyboard controller's outputs from the keys held. */
  drive(turn: number, thrust: number): void {
    this.send({ type: "drive", turn, thrust });
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
